// Datos de la empresa: planes, cargos de suscripción, auditoría, bandeja de salida y cobros de Ecart Pay.
import { uid } from '@residencial/shared';
import { json, parseJson } from '../db/database.js';

const toPlan = (r) => ({ id: r.id, name: r.name, price: r.price, maxUnits: r.max_units, features: parseJson(r.features, []) });
const toInvoice = (r) => ({
  id: r.id,
  tenantId: r.tenant_id,
  period: r.period,
  amount: r.amount,
  status: r.status,
  dueDate: r.due_date,
  method: r.method,
  reference: r.reference,
  paidAt: r.paid_at,
  createdAt: r.created_at,
  review: parseJson(r.review, null),
  remindedAt: r.reminded_at,
  autopayAttemptAt: r.autopay_attempt_at,
});
const toBilling = (r) => ({
  tenantId: r.tenant_id,
  autopay: !!r.autopay,
  card: r.card_token ? { brand: r.card_brand, last4: r.card_last4 } : null,
  cardToken: r.card_token,
  updatedAt: r.updated_at,
});
/** Lo que pueden ver las pantallas (sin el identificador de la tarjeta). */
export const publicBilling = (b) => ({ tenantId: b.tenantId, autopay: b.autopay, card: b.card });
const toAudit = (r) => ({
  id: r.id,
  at: r.at,
  tenantId: r.tenant_id,
  actor: r.actor,
  action: r.action,
  target: r.target,
  detail: r.detail,
  severity: r.severity,
});
const toMessage = (r) => ({
  id: r.id,
  channel: r.channel,
  to: r.recipient,
  subject: r.subject,
  body: r.body,
  meta: parseJson(r.meta, {}),
  status: r.status,
  attempts: r.attempts,
  at: r.created_at,
});

export function platformRepository(db) {
  return {
    // ---------- Planes ----------
    plans: () => db.prepare('SELECT * FROM plans ORDER BY price').all().map(toPlan),
    plan: (id) => {
      const r = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
      return r && toPlan(r);
    },
    savePlan: (p) =>
      db
        .prepare(
          `INSERT INTO plans (id, name, price, max_units, features) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, price = excluded.price, max_units = excluded.max_units, features = excluded.features`,
        )
        .run(p.id, p.name, p.price, p.maxUnits, json(p.features)),

    // ---------- Cargos de suscripción ----------
    invoices: (tenantId) =>
      (tenantId
        ? db.prepare('SELECT * FROM invoices WHERE tenant_id = ? ORDER BY period DESC').all(tenantId)
        : db.prepare('SELECT * FROM invoices ORDER BY period DESC, created_at').all()
      ).map(toInvoice),
    invoice: (id) => {
      const r = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      return r && toInvoice(r);
    },
    createInvoice: (i) =>
      db
        .prepare(
          'INSERT INTO invoices (id, tenant_id, period, amount, status, due_date, method, reference, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(i.id, i.tenantId, i.period, i.amount, i.status, i.dueDate, i.method ?? null, i.reference || '', i.paidAt ?? null, i.createdAt),
    hasInvoice: (tenantId, period) =>
      !!db.prepare("SELECT 1 FROM invoices WHERE tenant_id = ? AND period = ? AND status != 'void'").get(tenantId, period),
    payInvoice: (id, { method, reference, paidAt }) =>
      db
        .prepare("UPDATE invoices SET status = 'paid', method = ?, reference = ?, paid_at = ? WHERE id = ?")
        .run(method, reference, paidAt, id),
    setInvoiceReview: (id, review) => db.prepare('UPDATE invoices SET review = ? WHERE id = ?').run(review ? json(review) : null, id),
    markReminded: (id, at) => db.prepare('UPDATE invoices SET reminded_at = ? WHERE id = ?').run(at, id),
    markAutopayAttempt: (id, at) => db.prepare('UPDATE invoices SET autopay_attempt_at = ? WHERE id = ?').run(at, id),
    pendingInvoices: () => db.prepare("SELECT * FROM invoices WHERE status = 'pending' ORDER BY due_date").all().map(toInvoice),
    voidInvoice: (id) => db.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").run(id),
    overdueTenants: (beforeDate) =>
      db
        .prepare(
          "SELECT DISTINCT i.tenant_id AS id FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.status = 'pending' AND i.due_date < ? AND t.status = 'active'",
        )
        .all(beforeDate)
        .map((r) => r.id),

    // ---------- Cobro automático de la suscripción ----------
    billing(tenantId) {
      const r = db.prepare('SELECT * FROM subscription_billing WHERE tenant_id = ?').get(tenantId);
      return r ? toBilling(r) : { tenantId, autopay: false, card: null, cardToken: null };
    },
    billingAll: () => db.prepare('SELECT * FROM subscription_billing').all().map(toBilling),
    saveBilling: (tenantId, { autopay, card, cardToken }, by) =>
      db
        .prepare(
          `INSERT INTO subscription_billing (tenant_id, autopay, card_brand, card_last4, card_token, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id) DO UPDATE SET autopay = excluded.autopay, card_brand = excluded.card_brand, card_last4 = excluded.card_last4,
          card_token = excluded.card_token, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .run(tenantId, autopay ? 1 : 0, card?.brand ?? null, card?.last4 ?? null, cardToken ?? null, new Date().toISOString(), by ?? null),

    // ---------- Auditoría ----------
    audit(entry) {
      const e = { id: uid('au_'), at: new Date().toISOString(), severity: 'info', actor: 'Sistema', target: '', detail: '', ...entry };
      db.prepare(
        'INSERT INTO audit_log (id, at, tenant_id, actor, action, target, detail, severity, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(e.id, e.at, e.tenantId ?? null, e.actor || 'Sistema', e.action, e.target || '', e.detail || '', e.severity, e.ip ?? null);
      return e;
    },
    auditLog: ({ tenantId, limit = 300 } = {}) =>
      (tenantId
        ? db.prepare('SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY at DESC LIMIT ?').all(tenantId, limit)
        : db.prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?').all(limit)
      ).map(toAudit),

    // ---------- Bandeja de salida ----------
    enqueue(messages) {
      const stmt = db.prepare('INSERT INTO outbox (id, channel, recipient, subject, body, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const m of messages)
        stmt.run(m.id || uid('msg_'), m.channel, m.to, m.subject ?? null, m.body, json(m.meta || {}), m.at || new Date().toISOString());
    },
    queued: (limit = 20) =>
      db.prepare("SELECT * FROM outbox WHERE status = 'queued' AND attempts < 5 ORDER BY created_at LIMIT ?").all(limit).map(toMessage),
    markSent: (id, { redact }) =>
      redact
        ? db
            .prepare("UPDATE outbox SET status = 'sent', sent_at = ?, body = '[enviado]', meta = '{}' WHERE id = ?")
            .run(new Date().toISOString(), id)
        : db.prepare("UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?").run(new Date().toISOString(), id),
    markFailed: (id, error) =>
      db
        .prepare(
          "UPDATE outbox SET attempts = attempts + 1, last_error = ?, status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'queued' END WHERE id = ?",
        )
        .run(String(error).slice(0, 500), id),
    recentMessages: (limit = 100) => db.prepare('SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?').all(limit).map(toMessage),

    // ---------- Cobros de Ecart Pay ----------
    createCheckout: (c) =>
      db
        .prepare(
          'INSERT INTO ecartpay_checkouts (id, tenant_id, user_id, periods, amount, checkout_url, created_at, invoice_id, save_card) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          c.id,
          c.tenantId,
          c.userId,
          json(c.periods || []),
          c.amount,
          c.checkoutUrl,
          c.createdAt,
          c.invoiceId ?? null,
          c.saveCard ? 1 : 0,
        ),
    checkout(id) {
      const r = db.prepare('SELECT * FROM ecartpay_checkouts WHERE id = ?').get(id);
      return (
        r && {
          id: r.id,
          tenantId: r.tenant_id,
          userId: r.user_id,
          periods: parseJson(r.periods, []),
          amount: r.amount,
          status: r.status,
          checkoutUrl: r.checkout_url,
          invoiceId: r.invoice_id,
          saveCard: !!r.save_card,
        }
      );
    },
    setCheckoutStatus: (id, status) =>
      db.prepare('UPDATE ecartpay_checkouts SET status = ?, confirmed_at = ? WHERE id = ?').run(status, new Date().toISOString(), id),
  };
}
