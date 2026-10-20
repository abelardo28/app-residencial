// Operaciones del residencial y la vista de datos de cada usuario.
// Las reglas viven en @residencial/shared; aquí sólo se cargan los datos, se ejecuta la operación
// dentro de una transacción y se guardan los cambios, la auditoría y los mensajes.
import { amountDue, createTx, money, monthLabel, payableMonths, runOperation, viewFor } from '@residencial/shared';
import { transaction } from '../../db/database.js';
import { passSigner } from '../../lib/crypto.js';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { toUserView } from '../../repositories/accounts.js';

const COMPANY = { name: 'Residencial Cloud' };

export const toResidencia = (t) => ({
  id: t.id,
  name: t.name,
  address: t.address,
  plan: t.plan,
  status: t.status,
  statusReason: t.statusReason,
  statusAt: t.statusAt,
  createdAt: t.createdAt,
  contact: t.contact,
});

export function createTenantService({ repos, config, dispatch, events, ecartpay }) {
  const { db, accounts, tenants, platform } = repos;
  const sign = passSigner(config.ACCESS_SECRET);

  /** Ejecuta una operación compartida como `acc`. `trusted` son datos que verificó el servidor. */
  function execute(acc, name, input, trusted = {}) {
    if (acc.scope !== 'tenant') throw forbidden();
    const tenantId = acc.tenantId;
    const { value, changed } = transaction(db, () => {
      const uow = tenants.unitOfWork(tenantId, accounts);
      const t = createTx(uow.next);
      const user = uow.next.users.find((u) => u.id === acc.id) || toUserView(acc);
      const value = runOperation(name, t, { user, sign, trusted }, input);
      const changed = uow.commit();
      for (const e of t.side.audit) platform.audit({ tenantId, actor: acc.name, ...e });
      if (t.side.outbox.length) platform.enqueue(t.side.outbox);
      return { value, changed };
    });
    if (changed) events.publish(tenantId, { reason: name });
    dispatch();
    return value ?? null;
  }

  return {
    execute,

    /** Todo lo que la APP necesita para mostrar la sesión de un usuario del residencial. */
    snapshot(acc) {
      const tenant = tenants.find(acc.tenantId);
      const data = tenants.snapshot(acc.tenantId, accounts);
      const me = data.users.find((u) => u.id === acc.id);
      const isAdmin = acc.role === 'admin';
      return {
        platform: {
          company: COMPANY,
          residencias: [toResidencia(tenant)],
          plans: isAdmin ? platform.plans() : [],
          invoices: isAdmin ? platform.invoices(acc.tenantId) : [],
          audit: isAdmin ? platform.auditLog({ tenantId: acc.tenantId, limit: 100 }) : [],
          outbox: [],
          staff: [],
        },
        tenants: { [acc.tenantId]: viewFor(data, me) },
      };
    },

    // ---------- Ecart Pay ----------
    async createCheckout(acc, { periods }) {
      if (acc.role !== 'resident') throw forbidden();
      const unitId = acc.profile.unitId;
      const data = {
        settings: tenants.find(acc.tenantId).settings,
        units: tenants.listRecords(acc.tenantId, 'units'),
        payments: tenants.listRecords(acc.tenantId, 'payments'),
      };
      const list = [...new Set(periods)];
      const allowed = payableMonths(data, unitId);
      if (!list.length || list.some((p) => !allowed.includes(p)))
        throw new HttpError(409, 'Alguno de los meses ya está pagado o en revisión.', 'period_unavailable');
      const amount = amountDue(data, unitId, list); // cuota + recargos
      const concept = `Mantenimiento ${list.map(monthLabel).join(', ')}`;
      const checkout = await ecartpay.createCheckout({ amount, concept, email: acc.email, reference: `${acc.tenantId}:${unitId}` });
      platform.createCheckout({
        id: checkout.id,
        tenantId: acc.tenantId,
        userId: acc.id,
        periods: list,
        amount,
        checkoutUrl: checkout.checkoutUrl,
        createdAt: new Date().toISOString(),
      });
      return {
        id: checkout.id,
        checkoutUrl: ecartpay.mode === 'mock' ? null : checkout.checkoutUrl,
        amount,
        concept: `${concept} · ${money(amount)}`,
        mock: ecartpay.mode === 'mock',
      };
    },

    /** Consulta a Ecart Pay y, si el cobro está pagado, registra el pago aprobado (una sola vez). */
    async confirmCheckout(checkoutId, acc) {
      const c = platform.checkout(checkoutId);
      if (!c || (acc && c.userId !== acc.id)) throw notFound('El cobro no existe.');
      if (c.status === 'confirmed') return { status: 'paid' };
      const status = await ecartpay.getStatus(checkoutId);
      if (status !== 'paid') {
        if (status === 'failed') platform.setCheckoutStatus(checkoutId, 'failed');
        return { status };
      }
      const owner = acc || accounts.findById(c.userId);
      if (!owner) throw notFound('La cuenta ya no existe.');
      const done = transaction(db, () => {
        if (platform.checkout(checkoutId).status === 'confirmed') return false; // otro proceso ya lo registró
        execute(
          owner,
          'submitPayment',
          { periods: c.periods, method: 'ecartpay', ecartpayId: c.id, reference: c.id },
          { ecartpay: { id: c.id, amount: c.amount } },
        );
        platform.setCheckoutStatus(checkoutId, 'confirmed');
        return true;
      });
      return { status: 'paid', registered: done };
    },

    /** Aviso de Ecart Pay. La firma se valida antes de confiar en el contenido. */
    async webhook(rawBody, signature) {
      if (!ecartpay.verifyWebhook(rawBody, signature)) throw new HttpError(401, 'Firma inválida.', 'invalid_signature');
      let event;
      try {
        event = JSON.parse(rawBody);
      } catch {
        throw badRequest('Aviso inválido.');
      }
      const id = event?.data?.id || event?.id;
      if (!id || !platform.checkout(id)) return { ignored: true };
      // No se confía en el estado del aviso: se vuelve a consultar al proveedor.
      return this.confirmCheckout(id, null);
    },
  };
}
