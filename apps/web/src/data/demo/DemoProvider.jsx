// Modo demo: simula el servidor dentro del navegador y guarda todo en localStorage.
// Sincroniza las pestañas abiertas (por ejemplo, residente en una y vigilante en otra).
// Las reglas de negocio son las mismas que usa la API (@residencial/shared); lo que aquí se simula
// es la autenticación, la base de datos y el envío de mensajes.
//
// Estructura: { platform: datos de la empresa (residencias, suscripciones, auditoría, buzón),
//               tenants: { [idResidencial]: datos de cada residencial } }
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  OPERATION_ROUTES,
  SECURITY,
  createTx,
  runOperation,
  DomainError,
  uid,
  nowIso,
  money,
  monthLabel,
  monthKey,
  passwordIssues,
  normEmail,
  validEmail,
  normPhone,
  maskEmail,
  maskPhone,
} from '@residencial/shared';
import { StoreContext } from '../context';
import { useNotificationAlerts, useToasts, withErrorToast } from '../common';
import { seedRoot } from './seedRoot';
import { demoSign } from './sign';
import { sha256, randomDigits, randomHex, verifyPassword, hashPassword, createInvite, safeEqual } from './crypto';
import { templates } from './messages';
import { KEY, SESSION, safe } from './storage';

const { MAX_LOGIN_ATTEMPTS, LOCK_MINUTES, MFA_MINUTES, MAX_CODE_ATTEMPTS, SESSION_HOURS, IDLE_MINUTES } = SECURITY;

// Revisa que los datos guardados tengan la forma esperada; si no, se regenera la demo.
const COLLECTIONS = [
  'units',
  'users',
  'passes',
  'accessLogs',
  'payments',
  'notices',
  'notifications',
  'reservations',
  'incidents',
  'packages',
  'polls',
  'expenses',
  'sos',
];
const validTenant = (t) => t?.settings && COLLECTIONS.every((c) => Array.isArray(t[c]));
function load() {
  try {
    const raw = safe.get('localStorage', KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.version === 2 && data.platform?.staff && Object.values(data.tenants || {}).every(validTenant)) return data;
    }
  } catch {
    /* datos corruptos: se regenera la demo */
  }
  return seedRoot();
}
function loadSession() {
  try {
    return JSON.parse(safe.get('sessionStorage', SESSION)) || null;
  } catch {
    return null;
  }
}

// ---------- Utilidades sobre el estado completo ----------
function findAccount(root, email, scope = 'any') {
  const e = normEmail(email);
  if (scope !== 'tenant') {
    const u = root.platform.staff.find((x) => normEmail(x.email) === e);
    if (u) return { scope: 'platform', tenantId: null, userId: u.id, user: u };
  }
  if (scope !== 'platform') {
    for (const [tenantId, t] of Object.entries(root.tenants)) {
      const u = t.users.find((x) => normEmail(x.email) === e);
      if (u) return { scope: 'tenant', tenantId, userId: u.id, user: u };
    }
  }
  return null;
}
const getAccount = (root, ref) =>
  ref.scope === 'platform'
    ? root.platform.staff.find((u) => u.id === ref.userId)
    : root.tenants[ref.tenantId]?.users.find((u) => u.id === ref.userId);
function patchAccount(root, ref, fn) {
  if (ref.scope === 'platform')
    return { ...root, platform: { ...root.platform, staff: root.platform.staff.map((u) => (u.id === ref.userId ? fn(u) : u)) } };
  const t = root.tenants[ref.tenantId];
  return { ...root, tenants: { ...root.tenants, [ref.tenantId]: { ...t, users: t.users.map((u) => (u.id === ref.userId ? fn(u) : u)) } } };
}
const patchAuth = (root, ref, ch) =>
  patchAccount(root, ref, (u) => ({ ...u, auth: { ...u.auth, ...(typeof ch === 'function' ? ch(u.auth) : ch) } }));
const pushPlatform = (root, key, items) => ({ ...root, platform: { ...root.platform, [key]: [...items, ...root.platform[key]] } });
const auditItem = (e) => ({ id: uid('au_'), at: nowIso(), severity: 'info', ...e });
const orgName = (root, ref) => (ref.scope === 'platform' ? root.platform.company.name : root.tenants[ref.tenantId]?.settings.name);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GENERIC_LOGIN_ERROR = 'Correo o contraseña incorrectos.';

export default function DemoProvider({ children }) {
  const [root, setRoot] = useState(load);
  const [session, setSessionState] = useState(loadSession);
  const [authNotice, setAuthNotice] = useState('');
  const { toasts, toast } = useToasts();
  const rootRef = useRef(root);
  rootRef.current = root;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const db = session?.kind === 'tenant' ? root.tenants[session.tenantId] || null : null;
  const dbRef = useRef(db);
  dbRef.current = db;
  const userId = session?.userId || null;
  const me = db ? db.users.find((u) => u.id === userId) || null : null;
  const staffMe = session?.kind === 'platform' ? root.platform.staff.find((u) => u.id === userId) || null : null;

  const setSession = useCallback((s) => {
    if (s) safe.set('sessionStorage', SESSION, JSON.stringify(s));
    else safe.remove('sessionStorage', SESSION);
    setSessionState(s);
  }, []);

  // Guarda cambios propios. Lo recibido de otra pestaña no se vuelve a escribir: si no, una pestaña
  // atrasada podría sobrescribir un cambio más reciente.
  const lastRaw = useRef(null);
  useEffect(() => {
    const raw = JSON.stringify(root);
    if (raw === lastRaw.current) return;
    lastRaw.current = raw;
    if (!safe.set('localStorage', KEY, raw)) console.warn('No se pudo guardar en el almacenamiento local (lleno o bloqueado).');
  }, [root]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== KEY || !e.newValue) return;
      lastRaw.current = e.newValue;
      setRoot(JSON.parse(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ---------- Validez de la sesión: caducidad, inactividad y cambios en la cuenta ----------
  const endSession = useCallback(
    (reason = '') => {
      setSession(null);
      setAuthNotice(reason);
    },
    [setSession],
  );
  useEffect(() => {
    if (!session) return;
    const check = () => {
      const s = sessionRef.current;
      if (!s) return;
      const r = rootRef.current;
      const acc = getAccount(r, { scope: s.kind === 'platform' ? 'platform' : 'tenant', tenantId: s.tenantId, userId: s.userId });
      const now = Date.now();
      if (now > new Date(s.expiresAt).getTime()) return endSession('Tu sesión expiró. Inicia sesión de nuevo.');
      if (now - new Date(s.lastActive).getTime() > IDLE_MINUTES * 60e3) return endSession('Cerramos tu sesión por inactividad.');
      if (!acc || acc.auth?.status !== 'active' || acc.auth.sessionVersion !== s.sv)
        return endSession('Tu sesión se cerró porque cambió el estado de tu cuenta.');
      if (s.kind === 'tenant' && r.platform.residencias.find((x) => x.id === s.tenantId)?.status !== 'active')
        return endSession('El acceso a este residencial está suspendido. Contacta a la administración.');
    };
    check();
    const iv = setInterval(check, 20000);
    return () => clearInterval(iv);
  }, [session, root, endSession]);

  // Registra actividad para el cierre por inactividad (como mucho una vez por minuto)
  useEffect(() => {
    if (!session) return;
    const onAct = () => {
      const s = sessionRef.current;
      if (s && Date.now() - new Date(s.lastActive).getTime() > 60e3) setSession({ ...s, lastActive: nowIso() });
    };
    window.addEventListener('pointerdown', onAct);
    window.addEventListener('keydown', onAct);
    return () => {
      window.removeEventListener('pointerdown', onAct);
      window.removeEventListener('keydown', onAct);
    };
  }, [session, setSession]);

  // Avisa (toast + notificación del sistema) cuando llega algo nuevo para el usuario activo.
  useNotificationAlerts(db?.notifications, userId, toast);

  // Ejecuta una operación compartida sobre el residencial de la sesión, con las mismas reglas que la API.
  // `trusted` simula lo que en la API verifica el servidor (por ejemplo, el cobro de Ecart Pay).
  const execute = useCallback((name, input, trusted = {}) => {
    const s = sessionRef.current;
    if (s?.kind !== 'tenant') throw new DomainError('Inicia sesión para continuar.', 401);
    const apply = (prev) => {
      const tenantId = s.tenantId;
      const t = createTx({ ...prev.tenants[tenantId] });
      const user = t.next.users.find((u) => u.id === s.userId);
      const value = runOperation(name, t, { user, sign: demoSign, trusted }, input);
      let next = { ...prev, tenants: { ...prev.tenants, [tenantId]: t.next } };
      if (t.side.audit.length)
        next = pushPlatform(
          next,
          'audit',
          t.side.audit.map((e) => auditItem({ tenantId, actor: user.name, ...e })),
        );
      if (t.side.outbox.length) next = pushPlatform(next, 'outbox', t.side.outbox);
      return { value, next };
    };
    const base = rootRef.current;
    const { value, next } = apply(base); // valida y calcula ya, para devolver el resultado o el error
    rootRef.current = next;
    setRoot((cur) => (cur === base ? next : apply(cur).next));
    return value;
  }, []);

  // ---------- Autenticación ----------
  const auth = useMemo(() => {
    const startSession = (acc) => {
      const now = nowIso();
      setRoot((r) => {
        let next = patchAuth(r, acc, { failed: 0, lockedUntil: null, lastLoginAt: now });
        return pushPlatform(next, 'audit', [
          auditItem({ tenantId: acc.tenantId, actor: acc.user.name, action: 'Inicio de sesión', target: acc.user.email }),
        ]);
      });
      setAuthNotice('');
      setSession({
        kind: acc.scope === 'platform' ? 'platform' : 'tenant',
        tenantId: acc.tenantId,
        userId: acc.userId,
        sv: acc.user.auth.sessionVersion,
        issuedAt: now,
        lastActive: now,
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString(),
      });
    };

    // Busca una invitación vigente por correo + token del enlace
    const findInvite = async (email, token) => {
      const acc = findAccount(rootRef.current, email);
      const inv = acc?.user.auth?.invite;
      if (!acc || !inv || !token) return null;
      if (!safeEqual(await sha256(token.trim()), inv.tokenHash)) return null;
      if (new Date(inv.expiresAt) < new Date()) return null;
      return acc;
    };
    const INVALID_LINK = 'El enlace no es válido, ya se usó o venció. Pide a tu administrador que te envíe uno nuevo.';

    return {
      async login({ email, password, scope }) {
        await wait(350); // tiempo de respuesta uniforme, exista o no la cuenta
        const r = rootRef.current;
        const acc = findAccount(r, email, scope);
        if (!acc) {
          setRoot((x) =>
            pushPlatform(x, 'audit', [
              auditItem({ actor: maskEmail(normEmail(email)), action: 'Intento de acceso con correo no registrado', severity: 'warn' }),
            ]),
          );
          return { ok: false, error: GENERIC_LOGIN_ERROR };
        }
        const a = acc.user.auth || {};
        if (a.lockedUntil && new Date(a.lockedUntil) > new Date()) {
          const min = Math.ceil((new Date(a.lockedUntil) - Date.now()) / 60e3);
          return { ok: false, error: `Por seguridad la cuenta está bloqueada. Intenta de nuevo en ${min} min.` };
        }
        const ok = a.hash ? await verifyPassword(password, a) : false;
        if (!ok) {
          const failed = (a.failed || 0) + 1;
          const lock = failed >= MAX_LOGIN_ATTEMPTS;
          setRoot((x) => {
            let next = patchAuth(
              x,
              acc,
              lock ? { failed: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60e3).toISOString() } : { failed },
            );
            next = pushPlatform(next, 'audit', [
              auditItem({
                tenantId: acc.tenantId,
                actor: acc.user.name,
                action: lock ? 'Cuenta bloqueada por intentos fallidos' : 'Contraseña incorrecta',
                target: acc.user.email,
                severity: lock ? 'danger' : 'warn',
              }),
            ]);
            if (lock) next = pushPlatform(next, 'outbox', templates.locked({ user: acc.user }));
            return next;
          });
          return { ok: false, error: lock ? `Demasiados intentos. Bloqueamos la cuenta ${LOCK_MINUTES} minutos.` : GENERIC_LOGIN_ERROR };
        }
        if (a.status === 'suspended') return { ok: false, error: 'Tu cuenta está suspendida. Contacta a tu administrador.' };
        if (a.status !== 'active') return { ok: false, error: GENERIC_LOGIN_ERROR };
        if (acc.scope === 'tenant') {
          const res = r.platform.residencias.find((x) => x.id === acc.tenantId);
          if (res?.status !== 'active')
            return { ok: false, error: `El acceso de ${res?.name || 'este residencial'} está suspendido. Contacta a la administración.` };
        }
        // Verificación en dos pasos para administradores y personal de la empresa
        if (acc.scope === 'platform' || acc.user.role === 'admin') {
          const code = randomDigits(6);
          const challengeId = randomHex(12);
          const codeHash = await sha256(`${challengeId}:${code}`);
          setRoot((x) => {
            const next = {
              ...x,
              platform: {
                ...x.platform,
                mfa: {
                  ...x.platform.mfa,
                  [challengeId]: {
                    ref: { scope: acc.scope, tenantId: acc.tenantId, userId: acc.userId },
                    codeHash,
                    attempts: 0,
                    expiresAt: new Date(Date.now() + MFA_MINUTES * 60e3).toISOString(),
                  },
                },
              },
            };
            return pushPlatform(next, 'outbox', templates.mfa({ user: acc.user, code }));
          });
          return { ok: true, mfa: { challengeId, phone: maskPhone(acc.user.phone), email: maskEmail(acc.user.email) } };
        }
        startSession(acc);
        return { ok: true };
      },

      async verifyMfa(challengeId, code) {
        const ch = rootRef.current.platform.mfa[challengeId];
        if (!ch || new Date(ch.expiresAt) < new Date())
          return { ok: false, expired: true, error: 'El código venció. Inicia sesión de nuevo.' };
        const good = safeEqual(await sha256(`${challengeId}:${code.trim()}`), ch.codeHash);
        if (!good) {
          const attempts = ch.attempts + 1;
          setRoot((x) => {
            const mfa = { ...x.platform.mfa };
            if (attempts >= MAX_CODE_ATTEMPTS) delete mfa[challengeId];
            else mfa[challengeId] = { ...ch, attempts };
            return { ...x, platform: { ...x.platform, mfa } };
          });
          return attempts >= MAX_CODE_ATTEMPTS
            ? { ok: false, expired: true, error: 'Demasiados intentos. Inicia sesión de nuevo.' }
            : { ok: false, error: `Código incorrecto. Te quedan ${MAX_CODE_ATTEMPTS - attempts} intentos.` };
        }
        setRoot((x) => {
          const mfa = { ...x.platform.mfa };
          delete mfa[challengeId];
          return { ...x, platform: { ...x.platform, mfa } };
        });
        const user = getAccount(rootRef.current, ch.ref);
        startSession({ ...ch.ref, user });
        return { ok: true };
      },

      // Paso 1 de la activación: valida el enlace (correo) y el código (WhatsApp)
      async checkActivation({ email, token, code }) {
        const acc = await findInvite(email, token);
        if (!acc) return { ok: false, error: INVALID_LINK };
        const inv = acc.user.auth.invite;
        if (code === undefined) return { ok: true, name: acc.user.name, purpose: inv.purpose, phone: maskPhone(acc.user.phone) };
        const good = safeEqual(await sha256(`${acc.userId}:${code.trim()}`), inv.codeHash);
        if (!good) {
          const attempts = inv.attempts + 1;
          const burn = attempts >= MAX_CODE_ATTEMPTS;
          setRoot((x) => {
            let next = patchAuth(x, acc, (au) => ({ invite: burn ? null : { ...au.invite, attempts } }));
            return pushPlatform(next, 'audit', [
              auditItem({
                tenantId: acc.tenantId,
                actor: acc.user.name,
                action: burn ? 'Invitación anulada por intentos fallidos' : 'Código de activación incorrecto',
                severity: 'warn',
              }),
            ]);
          });
          return {
            ok: false,
            error: burn
              ? 'Demasiados intentos. Por seguridad anulamos esta invitación; pide una nueva a tu administrador.'
              : `Código incorrecto. Te quedan ${MAX_CODE_ATTEMPTS - attempts} intentos.`,
          };
        }
        return { ok: true, name: acc.user.name, purpose: inv.purpose, user: { name: acc.user.name, email: acc.user.email } };
      },

      // Paso 2: crea la contraseña y activa la cuenta (la invitación queda inutilizada)
      async completeActivation({ email, token, code, password }) {
        const check = await this.checkActivation({ email, token, code });
        if (!check.ok) return check;
        const acc = findAccount(rootRef.current, email);
        const issues = passwordIssues(password, acc.user);
        if (issues.length) return { ok: false, error: 'La contraseña no cumple: ' + issues.join(', ').toLowerCase() };
        const h = await hashPassword(password);
        setRoot((x) => {
          let next = patchAuth(x, acc, (au) => ({
            status: 'active',
            ...h,
            invite: null,
            failed: 0,
            lockedUntil: null,
            sessionVersion: (au.sessionVersion || 0) + 1,
            passwordChangedAt: nowIso(),
          }));
          next = pushPlatform(next, 'outbox', templates.activated({ user: acc.user, org: orgName(x, acc) }));
          return pushPlatform(next, 'audit', [
            auditItem({
              tenantId: acc.tenantId,
              actor: acc.user.name,
              action: check.purpose === 'reset' ? 'Contraseña restablecida' : 'Cuenta activada',
              target: acc.user.email,
            }),
          ]);
        });
        return { ok: true, scope: acc.scope };
      },

      logout() {
        const s = sessionRef.current;
        if (s) {
          const acc = getAccount(rootRef.current, {
            scope: s.kind === 'platform' ? 'platform' : 'tenant',
            tenantId: s.tenantId,
            userId: s.userId,
          });
          setRoot((x) => pushPlatform(x, 'audit', [auditItem({ tenantId: s.tenantId, actor: acc?.name, action: 'Cierre de sesión' })]));
        }
        endSession('');
      },
      clearNotice() {
        setAuthNotice('');
      },
    };
  }, [setSession, endSession]);

  // ---------- Gestión de cuentas (la usan el administrador del residencial y la empresa) ----------
  const accounts = useMemo(() => {
    const actorName = () => {
      const s = sessionRef.current;
      const r = rootRef.current;
      if (!s) return 'Sistema';
      return s.kind === 'platform'
        ? r.platform.staff.find((u) => u.id === s.userId)?.name
        : r.tenants[s.tenantId]?.users.find((u) => u.id === s.userId)?.name;
    };
    // `known` permite invitar a un usuario recién creado que aún no está en rootRef
    const sendInvite = async (tenantId, userId, purpose, action, known) => {
      const user = known || rootRef.current.tenants[tenantId].users.find((u) => u.id === userId);
      const { secrets, invite } = await createInvite(userId, purpose);
      const ref = { scope: 'tenant', tenantId, userId };
      setRoot((x) => {
        let next = patchAuth(x, ref, (au) => ({
          invite,
          ...(purpose === 'reset' ? { status: 'reset', hash: null, salt: null, sessionVersion: (au.sessionVersion || 0) + 1 } : {}),
          failed: 0,
          lockedUntil: null,
        }));
        next = pushPlatform(next, 'outbox', templates.invite({ user, org: x.tenants[tenantId].settings.name, ...secrets, purpose }));
        return pushPlatform(next, 'audit', [auditItem({ tenantId, actor: actorName(), action, target: `${user.name} · ${user.email}` })]);
      });
    };
    return {
      // Crea la cuenta sin contraseña y envía la invitación por correo y WhatsApp.
      async invite(tenantId, data) {
        const email = normEmail(data.email);
        const phone = normPhone(data.phone);
        if (!data.name?.trim()) throw new Error('Escribe el nombre.');
        if (!validEmail(email)) throw new Error('El correo no es válido.');
        if (!phone) throw new Error('El WhatsApp debe tener 10 dígitos (o incluir lada internacional).');
        if (findAccount(rootRef.current, email)) throw new Error('Ya existe una cuenta con ese correo.');
        const id = uid('usr_');
        const user = {
          id,
          vehicles: [],
          ...data,
          name: data.name.trim(),
          email,
          phone,
          auth: { status: 'pending', failed: 0, lockedUntil: null, sessionVersion: 1 },
        };
        setRoot((x) => ({
          ...x,
          tenants: { ...x.tenants, [tenantId]: { ...x.tenants[tenantId], users: [user, ...x.tenants[tenantId].users] } },
        }));
        await sendInvite(tenantId, id, 'activate', 'Usuario creado e invitación enviada', user);
        return user;
      },
      resendInvite: (tenantId, userId) => sendInvite(tenantId, userId, 'activate', 'Invitación reenviada'),
      // Sólo un administrador puede restablecer: anula la contraseña, cierra sesiones y envía nuevo código.
      resetPassword: (tenantId, userId) => sendInvite(tenantId, userId, 'reset', 'Restablecimiento de contraseña'),
      async setSuspended(tenantId, userId, suspended) {
        const ref = { scope: 'tenant', tenantId, userId };
        setRoot((x) => {
          const u = getAccount(x, ref);
          let next = patchAuth(x, ref, (au) => ({
            status: suspended ? 'suspended' : au.hash ? 'active' : 'pending',
            sessionVersion: (au.sessionVersion || 0) + 1,
          }));
          return pushPlatform(next, 'audit', [
            auditItem({
              tenantId,
              actor: actorName(),
              action: suspended ? 'Cuenta suspendida' : 'Cuenta reactivada',
              target: u.name,
              severity: suspended ? 'warn' : 'info',
            }),
          ]);
        });
      },
      async unlock(tenantId, userId) {
        setRoot((x) => patchAuth(x, { scope: 'tenant', tenantId, userId }, { failed: 0, lockedUntil: null }));
      },
      async remove(tenantId, userId) {
        setRoot((x) => {
          const t = x.tenants[tenantId];
          const u = t.users.find((y) => y.id === userId);
          const next = { ...x, tenants: { ...x.tenants, [tenantId]: { ...t, users: t.users.filter((y) => y.id !== userId) } } };
          return pushPlatform(next, 'audit', [
            auditItem({ tenantId, actor: actorName(), action: 'Usuario eliminado', target: u?.name, severity: 'warn' }),
          ]);
        });
      },
      async update(tenantId, userId, data) {
        setRoot((x) => patchAccount(x, { scope: 'tenant', tenantId, userId }, (u) => ({ ...u, ...data })));
      },
    };
  }, []);

  // ---------- Operaciones de la empresa (portal) ----------
  const platform = useMemo(() => {
    const actor = () => rootRef.current.platform.staff.find((u) => u.id === sessionRef.current?.userId)?.name || 'Empresa';
    const audit = (x, e) => pushPlatform(x, 'audit', [auditItem({ actor: actor(), ...e })]);
    const planPrice = (x, planId) => x.platform.plans.find((p) => p.id === planId)?.price || 0;
    return {
      async createResidencial({ name, address, plan, unitCount, unitPrefix, monthlyFee, admin }) {
        if (!name?.trim()) throw new Error('Escribe el nombre del residencial.');
        const tenantId = uid('t_');
        const units = Array.from({ length: Math.max(1, Math.min(2000, Number(unitCount) || 1)) }, (_, i) => ({
          id: `u${i + 1}`,
          label: `${unitPrefix || 'Casa'} ${i + 1}`,
          street: '',
        }));
        const tenant = {
          version: 1,
          settings: {
            name: name.trim(),
            monthlyFee: Number(monthlyFee) || 0,
            dueDay: 10,
            lateFee: 0,
            bank: { name: '', clabe: '', holder: '' },
            amenities: [],
            generalProviders: ['Recolección de basura', 'Gas', 'Pipa de agua'],
          },
          units,
          users: [],
          passes: [],
          accessLogs: [],
          payments: [],
          notices: [],
          notifications: [],
          reservations: [],
          incidents: [],
          packages: [],
          polls: [],
          expenses: [],
          sos: [],
        };
        // Se valida el administrador antes de crear nada
        if (!validEmail(admin.email)) throw new Error('El correo del administrador no es válido.');
        if (!normPhone(admin.phone)) throw new Error('El WhatsApp del administrador no es válido.');
        if (findAccount(rootRef.current, admin.email)) throw new Error('Ya existe una cuenta con el correo del administrador.');
        const m = monthKey();
        setRoot((x) => {
          let next = { ...x, tenants: { ...x.tenants, [tenantId]: tenant } };
          next = pushPlatform(next, 'residencias', [
            { id: tenantId, name: name.trim(), address, plan, status: 'active', createdAt: nowIso(), contact: admin.name },
          ]);
          next = pushPlatform(next, 'invoices', [
            {
              id: uid('inv_'),
              tenantId,
              period: m,
              amount: planPrice(x, plan),
              status: 'pending',
              dueDate: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
              method: null,
              reference: '',
              paidAt: null,
              createdAt: nowIso(),
            },
          ]);
          return audit(next, { tenantId, action: 'Residencial creado', target: name.trim() });
        });
        await accounts.invite(tenantId, { name: admin.name, email: admin.email, phone: admin.phone, role: 'admin' });
        return tenantId;
      },
      async setResidencialStatus(tenantId, status, reason = '') {
        setRoot((x) => {
          const res = x.platform.residencias.find((r) => r.id === tenantId);
          let next = {
            ...x,
            platform: {
              ...x.platform,
              residencias: x.platform.residencias.map((r) =>
                r.id === tenantId ? { ...r, status, statusReason: reason, statusAt: nowIso() } : r,
              ),
            },
          };
          const admins = x.tenants[tenantId].users.filter((u) => u.role === 'admin');
          next = pushPlatform(
            next,
            'outbox',
            admins.flatMap((admin) => templates.serviceStatus({ admin, org: res.name, active: status === 'active', reason })),
          );
          return audit(next, {
            tenantId,
            action: status === 'active' ? 'Residencial reactivado' : 'Residencial suspendido',
            target: res.name,
            severity: status === 'active' ? 'info' : 'danger',
            detail: reason,
          });
        });
      },
      async changePlan(tenantId, plan) {
        setRoot((x) =>
          audit(
            { ...x, platform: { ...x.platform, residencias: x.platform.residencias.map((r) => (r.id === tenantId ? { ...r, plan } : r)) } },
            { tenantId, action: 'Cambio de plan', target: x.platform.plans.find((p) => p.id === plan)?.name },
          ),
        );
      },
      async generateInvoices(period = monthKey()) {
        let created = 0;
        setRoot((x) => {
          const items = x.platform.residencias
            .filter((r) => r.status === 'active' && !x.platform.invoices.some((i) => i.tenantId === r.id && i.period === period))
            .map((r) => ({
              id: uid('inv_'),
              tenantId: r.id,
              period,
              amount: planPrice(x, r.plan),
              status: 'pending',
              dueDate: `${period}-10`,
              method: null,
              reference: '',
              paidAt: null,
              createdAt: nowIso(),
            }));
          created = items.length;
          return items.length
            ? audit(pushPlatform(x, 'invoices', items), {
                action: 'Cargos generados',
                target: `${items.length} residencia(s) · ${monthLabel(period)}`,
              })
            : x;
        });
        return created;
      },
      async payInvoice(id, { method, reference }) {
        setRoot((x) => {
          const inv = x.platform.invoices.find((i) => i.id === id);
          const res = x.platform.residencias.find((r) => r.id === inv.tenantId);
          const next = {
            ...x,
            platform: {
              ...x.platform,
              invoices: x.platform.invoices.map((i) => (i.id === id ? { ...i, status: 'paid', method, reference, paidAt: nowIso() } : i)),
            },
          };
          return audit(next, {
            tenantId: inv.tenantId,
            action: 'Pago de suscripción registrado',
            target: `${res?.name} · ${monthLabel(inv.period)} · ${money(inv.amount)}`,
          });
        });
      },
      async cancelInvoice(id) {
        setRoot((x) =>
          audit(
            { ...x, platform: { ...x.platform, invoices: x.platform.invoices.map((i) => (i.id === id ? { ...i, status: 'void' } : i)) } },
            { action: 'Cargo cancelado', target: id, severity: 'warn' },
          ),
        );
      },
      async remindInvoice(id) {
        setRoot((x) => {
          const inv = x.platform.invoices.find((i) => i.id === id);
          const t = x.tenants[inv.tenantId];
          const admins = t.users.filter((u) => u.role === 'admin');
          let next = pushPlatform(
            x,
            'outbox',
            admins.flatMap((a) =>
              templates.invoiceReminder({ admin: a, org: t.settings.name, amount: money(inv.amount), period: monthLabel(inv.period) }),
            ),
          );
          const tt = createTx({ ...next.tenants[inv.tenantId] });
          tt.notify(
            admins.map((a) => a.id),
            {
              title: 'Suscripción pendiente',
              body: `La suscripción de ${monthLabel(inv.period)} por ${money(inv.amount)} está pendiente de pago.`,
              kind: 'payment',
              link: '/configuracion',
            },
          );
          next = { ...next, tenants: { ...next.tenants, [inv.tenantId]: tt.next } };
          return audit(next, { tenantId: inv.tenantId, action: 'Recordatorio de suscripción enviado', target: t.settings.name });
        });
      },
      // Suspende los residenciales con cargos vencidos hace más de `days` días
      async suspendOverdue(days = 15) {
        const limit = Date.now() - days * 864e5;
        const r = rootRef.current;
        const ids = [
          ...new Set(
            r.platform.invoices
              .filter((i) => i.status === 'pending' && new Date(i.dueDate + 'T23:59').getTime() < limit)
              .map((i) => i.tenantId),
          ),
        ].filter((id) => r.platform.residencias.find((x) => x.id === id)?.status === 'active');
        ids.forEach((id) => platform.setResidencialStatus(id, 'suspended', `Adeudo mayor a ${days} días`));
        return ids.length;
      },
      async updatePlan(planId, data) {
        setRoot((x) =>
          audit(
            { ...x, platform: { ...x.platform, plans: x.platform.plans.map((p) => (p.id === planId ? { ...p, ...data } : p)) } },
            { action: 'Plan actualizado', target: x.platform.plans.find((p) => p.id === planId)?.name },
          ),
        );
      },
    };
  }, [accounts]);

  // ---------- Acciones del residencial ----------
  // Una acción por operación del contrato compartido; todas devuelven una promesa, igual que con la API.
  const actions = useMemo(() => {
    const ops = Object.fromEntries(
      Object.entries(OPERATION_ROUTES).map(([name, route]) => [
        name,
        (...args) => withErrorToast(toast, () => execute(name, route.args(...args))),
      ]),
    );
    return {
      ...ops,
      logout: auth.logout,
      resetDemo() {
        setRoot(seedRoot());
        setSession(null);
      },
      // Ecart Pay simulado: en la API el servidor crea el cobro y confirma el pago con el proveedor.
      startEcartpay: async (periods) => ({ id: uid('ecp_test_'), periods, checkoutUrl: null, mock: true }),
      confirmEcartpay: (checkout) =>
        withErrorToast(toast, () => {
          execute(
            'submitPayment',
            { periods: checkout.periods, method: 'ecartpay', ecartpayId: checkout.id, reference: checkout.id },
            { ecartpay: { id: checkout.id } },
          );
          return { status: 'paid' };
        }),
    };
  }, [execute, auth, toast, setSession]);

  const value = useMemo(
    () => ({ mode: 'demo', root, db, me, staffMe, session, actions, auth, accounts, platform, authNotice, toast, toasts }),
    [root, db, me, staffMe, session, actions, auth, accounts, platform, authNotice, toast, toasts],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
