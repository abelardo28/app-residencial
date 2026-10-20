// Suscripción de cada residencial con la empresa, desde la app del administrador:
// pago con tarjeta (Ecart Pay) con opción de cobro automático, transferencia con comprobante que revisa la empresa,
// recordatorios antes del vencimiento y reactivación del servicio al ponerse al corriente.
import {
  createTx,
  dueForAutopay,
  dueForReminder,
  fmtDate,
  inReview,
  money,
  monthLabel,
  payable,
  reactivatesAfterPayment,
  receiptError,
  subscriptionMessages,
  subscriptionReference,
} from '@residencial/shared';
import { COMPANY_BANK } from '@residencial/shared/demo';
import { transaction } from '../../db/database.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { publicBilling } from '../../repositories/platform.js';
import { toResidencia } from '../tenant/service.js';

const SYSTEM = { name: 'Sistema' };

export function createSubscriptionService({ repos, config, templates, dispatch, events, ecartpay, log = console }) {
  const { db, accounts, tenants, platform } = repos;
  const link = `${config.APP_URL.replace(/\/$/, '')}/#/configuracion`;
  // Sin cuenta configurada, en desarrollo se muestra la de ejemplo para poder probar el flujo.
  const company = { ...config.company, bank: config.company.bank || (config.isProd ? null : COMPANY_BANK) };

  const admins = (tenantId) => accounts.listByTenant(tenantId).filter((a) => a.role === 'admin' && a.status === 'active');
  const orgOf = (tenantId) => tenants.find(tenantId)?.name || 'tu residencial';
  const audit = (actor, e) => platform.audit({ actor: actor.name, ...e });
  const changed = (tenantId) => {
    events.publish(tenantId, { reason: 'subscription' }); // también avisa al portal de la empresa
    dispatch();
  };
  const describe = (inv) => ({
    org: orgOf(inv.tenantId),
    amount: money(inv.amount),
    period: monthLabel(inv.period),
    due: fmtDate(`${inv.dueDate}T12:00`),
    link,
  });
  const mustInvoice = (id, tenantId) => {
    const inv = platform.invoice(id);
    if (!inv || (tenantId && inv.tenantId !== tenantId)) throw notFound('El cargo no existe.');
    return inv;
  };
  const mustAdmin = (acc) => {
    if (acc.scope !== 'tenant' || acc.role !== 'admin') throw forbidden();
  };

  /** Mensajes a los administradores y una notificación en la app. */
  function tellAdmins(tenantId, kind, data, note) {
    const list = admins(tenantId);
    platform.enqueue(list.flatMap((admin) => subscriptionMessages(kind, { admin, ...data })));
    if (!note) return;
    const uow = tenants.unitOfWork(tenantId, accounts);
    createTx(uow.next).notify(
      list.map((a) => a.id),
      { kind: 'payment', link: '/configuracion', ...note },
    );
    uow.commit();
  }

  /** Registra el pago, avisa y reactiva el servicio si estaba suspendido sólo por adeudo. */
  function markPaid(actor, inv, { method, reference, card }) {
    platform.payInvoice(inv.id, { method, reference: reference || '', paidAt: new Date().toISOString() });
    const d = describe(inv);
    audit(actor, { tenantId: inv.tenantId, action: 'Pago de suscripción registrado', target: `${d.org} · ${d.period} · ${d.amount}` });
    tellAdmins(inv.tenantId, 'paid', { ...d, card }, { title: 'Pago de suscripción recibido', body: `${d.period} · ${d.amount}` });
    const t = tenants.find(inv.tenantId);
    if (reactivatesAfterPayment(toResidencia(t), platform.invoices(inv.tenantId))) {
      tenants.setStatus(t.id, 'active', '', new Date().toISOString());
      platform.enqueue(admins(t.id).flatMap((admin) => templates.serviceStatus({ admin, org: t.name, active: true })));
      audit(SYSTEM, {
        tenantId: t.id,
        action: 'Residencial reactivado',
        target: t.name,
        detail: 'Se puso al corriente con la suscripción',
      });
    }
  }

  return {
    company,

    /** Lo que el administrador ve de su suscripción (sin el identificador de la tarjeta). */
    view: (tenantId) => ({ ...publicBilling(platform.billing(tenantId)), bank: company.bank }),
    billingList: () => platform.billingAll().map(publicBilling),

    // ---------- Tarjeta (Ecart Pay) ----------
    async startCardPayment(acc, invoiceId, { saveCard }) {
      mustAdmin(acc);
      const inv = mustInvoice(invoiceId, acc.tenantId);
      if (!payable(inv)) throw conflict(inReview(inv) ? 'Ya enviaste un comprobante de este cargo.' : 'Este cargo ya no está pendiente.');
      const d = describe(inv);
      const concept = `Suscripción ${d.period} · ${d.org}`;
      const checkout = await ecartpay.createCheckout({
        amount: inv.amount,
        concept,
        email: acc.email,
        reference: subscriptionReference(inv),
        saveCard,
        redirectPath: '/configuracion',
      });
      platform.createCheckout({
        id: checkout.id,
        tenantId: acc.tenantId,
        userId: acc.id,
        invoiceId: inv.id,
        saveCard,
        amount: inv.amount,
        checkoutUrl: checkout.checkoutUrl,
        createdAt: new Date().toISOString(),
      });
      return {
        id: checkout.id,
        checkoutUrl: ecartpay.mode === 'mock' ? null : checkout.checkoutUrl,
        amount: inv.amount,
        concept: `${concept} · ${d.amount}`,
        mock: ecartpay.mode === 'mock',
      };
    },

    /** Consulta a Ecart Pay; si está pagado registra el pago (una sola vez) y, si se pidió, guarda la tarjeta. */
    async confirmCardPayment(checkoutId, acc) {
      const c = platform.checkout(checkoutId);
      if (!c?.invoiceId || (acc && c.tenantId !== acc.tenantId)) throw notFound('El cobro no existe.');
      if (c.status === 'confirmed') return { status: 'paid' };
      const { status, card } = await ecartpay.getCheckout(checkoutId);
      if (status !== 'paid') {
        if (status === 'failed') platform.setCheckoutStatus(checkoutId, 'failed');
        return { status };
      }
      const payer = acc || accounts.findById(c.userId) || SYSTEM;
      const registered = transaction(db, () => {
        if (platform.checkout(checkoutId).status === 'confirmed') return false; // otro proceso ya lo registró
        const inv = mustInvoice(c.invoiceId);
        if (inv.status === 'pending') markPaid(payer, inv, { method: 'ecartpay', reference: c.id, card: card?.last4 });
        if (c.saveCard && card?.token) {
          platform.saveBilling(
            c.tenantId,
            { autopay: true, card: { brand: card.brand, last4: card.last4 }, cardToken: card.token },
            payer.name,
          );
          audit(payer, { tenantId: c.tenantId, action: 'Cobro automático activado', target: `${card.brand} •••• ${card.last4}` });
        }
        platform.setCheckoutStatus(checkoutId, 'confirmed');
        return true;
      });
      changed(c.tenantId);
      return { status: 'paid', registered };
    },

    setAutopay(acc, enabled) {
      mustAdmin(acc);
      const b = platform.billing(acc.tenantId);
      if (enabled && !b.cardToken) throw conflict('Primero paga con tarjeta y marca «Cobrar automáticamente».');
      transaction(db, () => {
        platform.saveBilling(acc.tenantId, { ...b, autopay: enabled }, acc.name);
        audit(acc, { tenantId: acc.tenantId, action: enabled ? 'Cobro automático activado' : 'Cobro automático desactivado' });
      });
      changed(acc.tenantId);
    },

    removeCard(acc) {
      mustAdmin(acc);
      transaction(db, () => {
        platform.saveBilling(acc.tenantId, { autopay: false, card: null, cardToken: null }, acc.name);
        audit(acc, { tenantId: acc.tenantId, action: 'Tarjeta eliminada', severity: 'warn' });
      });
      changed(acc.tenantId);
    },

    // ---------- Transferencia con comprobante ----------
    submitTransfer(acc, invoiceId, { reference, receipt }) {
      mustAdmin(acc);
      const inv = mustInvoice(invoiceId, acc.tenantId);
      if (!payable(inv)) throw conflict(inReview(inv) ? 'Ya enviaste un comprobante de este cargo.' : 'Este cargo ya no está pendiente.');
      const err = receiptError(receipt);
      if (err) throw badRequest(err);
      const d = describe(inv);
      transaction(db, () => {
        platform.setInvoiceReview(inv.id, { reference, receipt, submittedAt: new Date().toISOString(), by: acc.name });
        audit(acc, {
          tenantId: inv.tenantId,
          action: 'Comprobante de suscripción enviado',
          target: `${d.period} · ${d.amount}`,
          detail: reference,
        });
        platform.enqueue(accounts.listStaff().flatMap((staff) => subscriptionMessages('receipt', { staff, ...d })));
      });
      changed(inv.tenantId);
    },

    /** La empresa aprueba el comprobante: queda pagado por transferencia. */
    approveTransfer(actor, invoiceId) {
      const inv = mustInvoice(invoiceId);
      if (!inReview(inv)) throw conflict('Este cargo no tiene un comprobante por revisar.');
      transaction(db, () => {
        markPaid(actor, inv, { method: 'transfer', reference: inv.review.reference || subscriptionReference(inv) });
        platform.setInvoiceReview(inv.id, { ...inv.review, approvedAt: new Date().toISOString(), approvedBy: actor.name });
      });
      changed(inv.tenantId);
    },

    /** La empresa rechaza el comprobante: el cargo sigue pendiente y el administrador ve el motivo. */
    rejectTransfer(actor, invoiceId, reason) {
      const inv = mustInvoice(invoiceId);
      if (!inReview(inv)) throw conflict('Este cargo no tiene un comprobante por revisar.');
      const d = describe(inv);
      transaction(db, () => {
        platform.setInvoiceReview(inv.id, { ...inv.review, receipt: null, rejectedAt: new Date().toISOString(), rejectReason: reason });
        audit(actor, {
          tenantId: inv.tenantId,
          action: 'Comprobante de suscripción rechazado',
          target: d.period,
          detail: reason,
          severity: 'warn',
        });
        tellAdmins(inv.tenantId, 'rejected', { ...d, reason }, { title: 'Comprobante rechazado', body: `${d.period}: ${reason}` });
      });
      changed(inv.tenantId);
    },

    /** Lo llama el portal de la empresa al registrar un pago a mano. */
    markPaid: (actor, inv, payment) => transaction(db, () => markPaid(actor, inv, payment)),

    // ---------- Tareas programadas ----------
    /**
     * Cobra las tarjetas con cobro automático (una vez al día por cargo) y envía los recordatorios
     * unos días antes del vencimiento. Se ejecuta cada hora y al generar los cargos del mes.
     */
    async runJobs(now = new Date()) {
      const result = { charged: 0, failed: 0, reminded: 0 };
      const billing = new Map(platform.billingAll().map((b) => [b.tenantId, b]));
      for (const inv of platform.pendingInvoices()) {
        const t = tenants.find(inv.tenantId);
        if (!t) continue;
        const b = billing.get(inv.tenantId);
        if (dueForAutopay(inv, b, now)) {
          platform.markAutopayAttempt(inv.id, now.toISOString());
          let charge;
          try {
            charge = await ecartpay.chargeCard({
              token: b.cardToken,
              amount: inv.amount,
              concept: `Suscripción ${monthLabel(inv.period)} · ${t.name}`,
              reference: subscriptionReference(inv),
            });
          } catch (err) {
            log.error?.({ err }, 'Cobro automático');
            charge = { status: 'failed' };
          }
          transaction(db, () => {
            if (charge.status === 'paid') {
              if (platform.invoice(inv.id).status === 'pending')
                markPaid(SYSTEM, inv, { method: 'ecartpay', reference: charge.id, card: b.card.last4 });
            } else {
              const d = describe(inv);
              audit(SYSTEM, {
                tenantId: inv.tenantId,
                action: 'Cobro automático rechazado',
                target: `${d.period} · ${d.amount}`,
                severity: 'warn',
              });
              tellAdmins(
                inv.tenantId,
                'card-failed',
                { ...d, card: b.card.last4 },
                { title: 'No pudimos cobrar tu tarjeta', body: `Suscripción de ${d.period} · ${d.amount}. Lo intentaremos mañana.` },
              );
            }
          });
          result[charge.status === 'paid' ? 'charged' : 'failed']++;
          changed(inv.tenantId);
        } else if (t.status === 'active' && dueForReminder(inv, b, now)) {
          const d = describe(inv);
          transaction(db, () => {
            platform.markReminded(inv.id, now.toISOString());
            tellAdmins(inv.tenantId, 'due', d, {
              title: 'Tu suscripción está por vencer',
              body: `${d.period} · ${d.amount} · vence el ${d.due}`,
            });
          });
          result.reminded++;
          changed(inv.tenantId);
        }
      }
      return result;
    },
  };
}
