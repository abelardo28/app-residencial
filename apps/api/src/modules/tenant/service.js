// Operaciones del residencial y la vista de datos de cada usuario.
// Las reglas viven en @residencial/shared; aquí sólo se cargan los datos, se ejecuta la operación
// dentro de una transacción y se guardan los cambios, la auditoría y los mensajes.
import { amountDue, createTx, money, payableRows, runOperation, viewFor } from '@residencial/shared';
import { transaction } from '../../db/database.js';
import { passSigner, sha256 } from '../../lib/crypto.js';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { toUserView } from '../../repositories/accounts.js';

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

export function createTenantService({ repos, config, dispatch, events, ecartpay, subscription }) {
  const { db, accounts, tenants, platform } = repos;
  const sign = passSigner(config.ACCESS_SECRET);

  const hash = { alg: 'sha256', fn: sha256 }; // huellas del paquete sin conexión de caseta

  /**
   * Corre `fn({ t, exec, user })` en una transacción del residencial: carga sólo lo que se usa, guarda los cambios,
   * la auditoría y los mensajes, y avisa a las pantallas conectadas. `actor(next)` devuelve quién ejecuta.
   */
  function withTenant(tenantId, actor, fn, reason = 'change') {
    const { value, changed } = transaction(db, () => {
      const uow = tenants.unitOfWork(tenantId, accounts);
      const t = createTx(uow.next);
      const user = actor(uow.next);
      const exec = (name, input, trusted = {}) => runOperation(name, t, { user, sign, hash, tenantId, trusted }, input);
      const value = fn({ t, exec, user });
      const changed = uow.commit();
      for (const e of t.side.audit) platform.audit({ tenantId, actor: user.name, ...e });
      if (t.side.outbox.length) platform.enqueue(t.side.outbox);
      return { value, changed };
    });
    if (changed) events.publish(tenantId, { reason });
    dispatch();
    return value ?? null;
  }

  const charging = new Set(); // residentes con un cobro a tarjeta guardada en curso (evita cobrar dos veces)

  /** Monto y concepto de lo que el residente quiere pagar; falla si algo ya está pagado o en revisión. */
  function quote(acc, periods) {
    if (acc.role !== 'resident') throw forbidden();
    const unitId = acc.profile.unitId;
    const data = {
      settings: tenants.find(acc.tenantId).settings,
      units: tenants.listRecords(acc.tenantId, 'units'),
      payments: tenants.listRecords(acc.tenantId, 'payments'),
    };
    const list = [...new Set(periods)];
    const rows = payableRows(data, unitId).filter((r) => list.includes(r.key));
    if (!list.length || rows.length !== list.length)
      throw new HttpError(409, 'Alguno de los cargos ya está pagado o en revisión.', 'period_unavailable');
    const amount = amountDue(data, unitId, list); // cuota + recargos + conceptos
    const concept = `Pago ${rows.map((r) => r.label).join(', ')}`.slice(0, 200);
    return { list, rows, amount, concept, unitId };
  }

  const userOf = (acc) => (next) => next.users.find((u) => u.id === acc.id) || toUserView(acc);

  /** Ejecuta una operación compartida como `acc`. `trusted` son datos que verificó el servidor. */
  function execute(acc, name, input, trusted = {}) {
    if (acc.scope !== 'tenant') throw forbidden();
    return withTenant(acc.tenantId, userOf(acc), ({ exec }) => exec(name, input, trusted), name);
  }

  return {
    execute,
    withTenant,
    userOf,

    /** Operación ejecutada por un equipo de caseta (pluma, lector o cámara). */
    executeAsDevice: (device, name, input) =>
      withTenant(
        device.tenantId,
        () => ({ ...device, role: 'device' }),
        ({ exec }) => exec(name, input),
        name,
      ),

    /** Todo lo que la APP necesita para mostrar la sesión de un usuario del residencial. */
    snapshot(acc) {
      const tenant = tenants.find(acc.tenantId);
      const data = tenants.snapshot(acc.tenantId, accounts);
      const me = data.users.find((u) => u.id === acc.id);
      const isAdmin = acc.role === 'admin';
      return {
        platform: {
          company: { name: subscription.company.name, bank: isAdmin ? subscription.company.bank : null },
          residencias: [toResidencia(tenant)],
          plans: isAdmin ? platform.plans() : [],
          invoices: isAdmin ? platform.invoices(acc.tenantId) : [],
          billing: isAdmin ? [subscription.view(acc.tenantId)] : [],
          audit: isAdmin ? platform.auditLog({ tenantId: acc.tenantId, limit: 100 }) : [],
          outbox: [],
          staff: [],
        },
        tenants: { [acc.tenantId]: viewFor(data, me) },
      };
    },

    // ---------- Ecart Pay ----------
    async createCheckout(acc, { periods, saveCard = false }) {
      const { list, amount, concept, unitId } = quote(acc, periods);
      const checkout = await ecartpay.createCheckout({
        amount,
        concept,
        email: acc.email,
        reference: `${acc.tenantId}:${unitId}`,
        saveCard,
      });
      platform.createCheckout({
        id: checkout.id,
        tenantId: acc.tenantId,
        userId: acc.id,
        periods: list,
        amount,
        checkoutUrl: checkout.checkoutUrl,
        createdAt: new Date().toISOString(),
        saveCard,
      });
      return {
        id: checkout.id,
        checkoutUrl: ecartpay.mode === 'mock' ? null : checkout.checkoutUrl,
        amount,
        concept: `${concept} · ${money(amount)}`,
        mock: ecartpay.mode === 'mock',
      };
    },

    /** Cobra una tarjeta guardada del residente y registra el pago aprobado. */
    async payWithCard(acc, { periods, cardId }) {
      const card = tenants.listRecords(acc.tenantId, 'cards').find((c) => c.id === cardId && c.userId === acc.id);
      if (!card) throw notFound('La tarjeta no existe.');
      if (charging.has(acc.id)) throw new HttpError(409, 'Ya hay un cobro en curso. Espera a que termine.', 'charge_in_progress');
      charging.add(acc.id);
      try {
        const { list, amount, concept, unitId } = quote(acc, periods);
        let charge;
        try {
          charge = await ecartpay.chargeCard({
            token: card.token,
            amount,
            concept,
            reference: `${acc.tenantId}:${unitId}`,
            email: acc.email,
          });
        } catch {
          charge = { status: 'failed' };
        }
        if (charge.status !== 'paid' || !charge.id)
          throw new HttpError(402, `La tarjeta ${card.brand} ···${card.last4} fue rechazada. Prueba con otra tarjeta.`, 'card_declined');
        const now = new Date().toISOString();
        platform.createCheckout({
          id: charge.id,
          tenantId: acc.tenantId,
          userId: acc.id,
          periods: list,
          amount,
          checkoutUrl: '',
          createdAt: now,
        });
        execute(
          acc,
          'submitPayment',
          { periods: list, method: 'ecartpay', ecartpayId: charge.id, reference: charge.id },
          { ecartpay: { id: charge.id, amount, card: { brand: card.brand, last4: card.last4 } } },
        );
        platform.setCheckoutStatus(charge.id, 'confirmed');
        return { status: 'paid', amount };
      } finally {
        charging.delete(acc.id);
      }
    },

    /** Consulta a Ecart Pay y, si el cobro está pagado, registra el pago aprobado (una sola vez). */
    async confirmCheckout(checkoutId, acc) {
      const c = platform.checkout(checkoutId);
      if (!c || (acc && c.userId !== acc.id)) throw notFound('El cobro no existe.');
      if (c.status === 'confirmed') return { status: 'paid' };
      const { status, card } = await ecartpay.getCheckout(checkoutId);
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
          { ecartpay: { id: c.id, amount: c.amount, card, saveCard: c.saveCard } },
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
      const c = id && platform.checkout(id);
      if (!c) return { ignored: true };
      // No se confía en el estado del aviso: se vuelve a consultar al proveedor.
      return c.invoiceId ? subscription.confirmCardPayment(id, null) : this.confirmCheckout(id, null);
    },
  };
}
