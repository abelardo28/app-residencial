-- Conversaciones del asistente de WhatsApp (una por teléfono) y mensajes recibidos ya procesados.
CREATE TABLE whatsapp_sessions (
  phone       TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state       TEXT,
  updated_at  TEXT NOT NULL
);

-- Meta puede reenviar el mismo aviso: el id del mensaje evita responder dos veces.
CREATE TABLE whatsapp_inbound (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
CREATE INDEX whatsapp_inbound_at ON whatsapp_inbound(received_at);
