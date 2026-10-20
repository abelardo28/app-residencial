-- Pago de la suscripción desde la app: comprobantes por revisar, recordatorios y cobro automático con tarjeta.
ALTER TABLE invoices ADD COLUMN review TEXT;              -- JSON: { reference, receipt, submittedAt, by, rejectedAt?, rejectReason? }
ALTER TABLE invoices ADD COLUMN reminded_at TEXT;
ALTER TABLE invoices ADD COLUMN autopay_attempt_at TEXT;

ALTER TABLE ecartpay_checkouts ADD COLUMN invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE ecartpay_checkouts ADD COLUMN save_card INTEGER NOT NULL DEFAULT 0;

-- Tarjeta guardada para el cobro automático. Sólo se guarda el identificador que entrega Ecart Pay, nunca el número.
CREATE TABLE subscription_billing (
  tenant_id   TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  autopay     INTEGER NOT NULL DEFAULT 0,
  card_brand  TEXT,
  card_last4  TEXT,
  card_token  TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
