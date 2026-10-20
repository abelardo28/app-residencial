// Proveedor de datos conectado a la API (apps/api).
// La API es la fuente de verdad: valida, aplica las reglas y devuelve sólo lo que el rol puede ver.
// La APP pide su "vista" (/me/snapshot), ejecuta acciones por REST y se actualiza con avisos en tiempo real (SSE).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OPERATION_ROUTES, splitRoute } from '@residencial/shared';
import { StoreContext } from '../context';
import { useNotificationAlerts, useToasts, withErrorToast } from '../common';
import { API_BASE, createApiClient } from './client';

const EMPTY_ROOT = {
  platform: { company: { name: 'Residencial Cloud' }, residencias: [], plans: [], invoices: [], audit: [], outbox: [], staff: [] },
  tenants: {},
};
const ACTIVITY_PING_MS = 5 * 60e3; // la actividad del usuario mantiene viva la sesión (cierre por inactividad: 30 min)

const result = async (fn) => {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code, expired: e.code === 'mfa_expired' };
  }
};

export default function ApiProvider({ children }) {
  const [root, setRoot] = useState(EMPTY_ROOT);
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [authNotice, setAuthNotice] = useState('');
  const { toasts, toast } = useToasts();
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const endSession = useCallback((message = '') => {
    if (!sessionRef.current) return;
    sessionRef.current = null;
    setSession(null);
    setRoot(EMPTY_ROOT);
    setAuthNotice(message);
  }, []);

  const api = useMemo(() => createApiClient({ onSessionEnded: (e) => endSession(e.message) }), [endSession]);

  // Pide la vista del usuario. Si llegan varios avisos seguidos, se hace una sola petición extra.
  const inflight = useRef(null);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    inflight.current = (async () => {
      try {
        do {
          again.current = false;
          const data = await api.get('/me/snapshot');
          api.setCsrfToken(data.session.csrfToken);
          sessionRef.current = data.session;
          setSession(data.session);
          setRoot(data.root);
        } while (again.current);
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, [api]);

  // Al abrir la APP: si la cookie de sesión sigue vigente se recupera la sesión.
  useEffect(() => {
    api
      .get('/auth/session')
      .then((d) => (d.session ? refresh() : null))
      .catch(() => {})
      .finally(() => setBooting(false));
  }, [api, refresh]);

  // Avisos en tiempo real: la API sólo dice "cambió algo" y la APP vuelve a pedir su vista.
  const sessionKey = session ? `${session.kind}:${session.userId}` : null;
  useEffect(() => {
    if (!sessionKey || typeof EventSource === 'undefined') return;
    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    es.addEventListener('change', () => refresh().catch(() => {}));
    es.addEventListener('session-ended', (e) => {
      es.close();
      endSession(JSON.parse(e.data).message);
    });
    // Si la conexión se cae y no se recupera, se comprueba si la sesión sigue vigente.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) refresh().catch(() => {});
    };
    return () => es.close();
  }, [sessionKey, refresh, endSession]);

  // La actividad (toques, teclado) cuenta para el cierre por inactividad del servidor.
  useEffect(() => {
    if (!sessionKey) return;
    let last = Date.now();
    const onActivity = () => {
      if (Date.now() - last < ACTIVITY_PING_MS) return;
      last = Date.now();
      api.get('/auth/session').catch(() => {});
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [sessionKey, api]);

  const db = session?.kind === 'tenant' ? root.tenants[session.tenantId] || null : null;
  const userId = session?.userId || null;
  const me = db ? db.users.find((u) => u.id === userId) || null : null;
  const staffMe = session?.kind === 'platform' ? root.platform.staff.find((u) => u.id === userId) || null : null;
  useNotificationAlerts(db?.notifications, userId, toast);

  // ---------- Autenticación ----------
  const auth = useMemo(() => {
    const signIn = async (data) => {
      api.setCsrfToken(data.session.csrfToken);
      setAuthNotice('');
      await refresh();
    };
    return {
      login: (input) =>
        result(async () => {
          const data = await api.post('/auth/login', input);
          if (data.mfa) return { mfa: data.mfa };
          await signIn(data);
          return {};
        }),
      verifyMfa: (challengeId, code) => result(async () => signIn(await api.post('/auth/mfa', { challengeId, code }))),
      checkActivation: (input) => result(() => api.post('/auth/activation/check', input)),
      completeActivation: (input) => result(() => api.post('/auth/activation/complete', input)),
      async logout() {
        await api.post('/auth/logout').catch(() => {});
        api.setCsrfToken(null);
        sessionRef.current = null;
        setSession(null);
        setRoot(EMPTY_ROOT);
        setAuthNotice('');
      },
      clearNotice: () => setAuthNotice(''),
    };
  }, [api, refresh]);

  // Ejecuta una petición que modifica datos y luego actualiza la vista.
  const mutate = useCallback(
    async (fn) => {
      const value = await fn();
      await refresh().catch(() => {});
      return value;
    },
    [refresh],
  );

  // ---------- Acciones del residencial (generadas desde el contrato compartido) ----------
  const actions = useMemo(() => {
    const ops = Object.fromEntries(
      Object.entries(OPERATION_ROUTES).map(([name, route]) => [
        name,
        (...args) =>
          withErrorToast(toast, () =>
            mutate(async () => {
              const { path, body } = splitRoute(route, route.args(...args));
              return (await api.request(route.method, `/tenant${path}`, route.method === 'DELETE' ? undefined : body))?.result;
            }),
          ),
      ]),
    );
    return {
      ...ops,
      // Igual que las acciones pero sin aviso de error (la pantalla decide qué mostrar)
      call: (name, ...args) =>
        mutate(async () => {
          const route = OPERATION_ROUTES[name];
          const { path, body } = splitRoute(route, route.args(...args));
          return (await api.request(route.method, `/tenant${path}`, route.method === 'DELETE' ? undefined : body))?.result;
        }),
      logout: auth.logout,
      startEcartpay: (periods) =>
        withErrorToast(toast, async () => ({ ...(await api.post('/tenant/payments/ecartpay/checkout', { periods })), periods })),
      confirmEcartpay: (checkout) =>
        withErrorToast(toast, () => mutate(() => api.post(`/tenant/payments/ecartpay/${encodeURIComponent(checkout.id)}/confirm`))),
    };
  }, [api, auth, mutate, toast]);

  // ---------- Suscripción del residencial (administrador) ----------
  const subscription = useMemo(() => {
    const run = (fn) => withErrorToast(toast, () => mutate(fn));
    const id = encodeURIComponent;
    return {
      startCard: (invoiceId, saveCard) =>
        withErrorToast(toast, () => api.post(`/tenant/subscription/invoices/${id(invoiceId)}/checkout`, { saveCard })),
      confirmCard: (checkout) => run(() => api.post(`/tenant/subscription/checkouts/${id(checkout.id)}/confirm`)),
      submitTransfer: (invoiceId, data) => run(() => api.post(`/tenant/subscription/invoices/${id(invoiceId)}/transfer`, data)),
      setAutopay: (enabled) => run(() => api.put('/tenant/subscription/autopay', { enabled })),
      removeCard: () => run(() => api.delete('/tenant/subscription/card')),
    };
  }, [api, mutate, toast]);

  // ---------- Cuentas (administrador del residencial y empresa) ----------
  const accounts = useMemo(() => {
    const base = (tenantId, userId = '') =>
      `/tenants/${encodeURIComponent(tenantId)}/users${userId ? `/${encodeURIComponent(userId)}` : ''}`;
    return {
      invite: (tenantId, data) => mutate(() => api.post(base(tenantId), data)),
      resendInvite: (tenantId, userId) => mutate(() => api.post(`${base(tenantId, userId)}/invite`)),
      resetPassword: (tenantId, userId) => mutate(() => api.post(`${base(tenantId, userId)}/reset-password`)),
      setSuspended: (tenantId, userId, suspended) => mutate(() => api.post(`${base(tenantId, userId)}/suspension`, { suspended })),
      unlock: (tenantId, userId) => mutate(() => api.post(`${base(tenantId, userId)}/unlock`)),
      remove: (tenantId, userId) => mutate(() => api.delete(base(tenantId, userId))),
    };
  }, [api, mutate]);

  // ---------- Portal de empresa ----------
  const platform = useMemo(() => {
    const run = (fn) => withErrorToast(toast, () => mutate(fn));
    const id = encodeURIComponent;
    return {
      createResidencial: async (data) => (await mutate(() => api.post('/platform/residencias', data))).id,
      setResidencialStatus: (tenantId, status, reason = '') =>
        run(() => api.patch(`/platform/residencias/${id(tenantId)}/status`, { status, reason })),
      changePlan: (tenantId, plan) => run(() => api.patch(`/platform/residencias/${id(tenantId)}/plan`, { plan })),
      generateInvoices: async (period) => (await run(() => api.post('/platform/invoices/generate', { period }))).created,
      payInvoice: (invoiceId, data) => run(() => api.post(`/platform/invoices/${id(invoiceId)}/pay`, data)),
      cancelInvoice: (invoiceId) => run(() => api.post(`/platform/invoices/${id(invoiceId)}/cancel`)),
      remindInvoice: (invoiceId) => run(() => api.post(`/platform/invoices/${id(invoiceId)}/remind`)),
      approveTransfer: (invoiceId) => run(() => api.post(`/platform/invoices/${id(invoiceId)}/review/approve`)),
      rejectTransfer: (invoiceId, reason) => run(() => api.post(`/platform/invoices/${id(invoiceId)}/review/reject`, { reason })),
      suspendOverdue: async (days) => (await run(() => api.post('/platform/residencias/suspend-overdue', { days }))).suspended,
      updatePlan: (planId, data) => run(() => api.patch(`/platform/plans/${id(planId)}`, data)),
    };
  }, [api, mutate, toast]);

  // Simulador de WhatsApp (sólo en desarrollo: /dev/whatsapp responde como el asistente real)
  const whatsapp = useMemo(
    () => ({
      contacts: async () => (await api.get('/dev/whatsapp/contacts')).contacts,
      send: async (from, text) => {
        const out = await api.post('/dev/whatsapp', { from, text });
        if (sessionRef.current) refresh().catch(() => {});
        return out;
      },
    }),
    [api, refresh],
  );

  const value = useMemo(
    () => ({
      mode: 'api',
      api,
      root,
      db,
      me,
      staffMe,
      session,
      actions,
      auth,
      accounts,
      platform,
      subscription,
      whatsapp,
      authNotice,
      toast,
      toasts,
    }),
    [api, root, db, me, staffMe, session, actions, auth, accounts, platform, subscription, whatsapp, authNotice, toast, toasts],
  );
  if (booting) return <div className="boot">Cargando…</div>;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
