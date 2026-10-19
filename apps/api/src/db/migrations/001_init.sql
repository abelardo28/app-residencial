-- Esquema inicial.
-- Identidad, sesiones, facturación y auditoría son tablas relacionales.
-- Los módulos operativos del residencial (pases, accesos, pagos, avisos…) se guardan como documentos JSON
-- en `tenant_records`, siempre separados por residencial (tenant_id). En PostgreSQL se usaría JSONB.

CREATE TABLE plans (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price       INTEGER NOT NULL CHECK (price >= 0),
  max_units   INTEGER NOT NULL CHECK (max_units > 0),
  features    TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL DEFAULT '',
  plan_id       TEXT NOT NULL REFERENCES plans(id),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  status_reason TEXT NOT NULL DEFAULT '',
  status_at     TEXT,
  contact       TEXT NOT NULL DEFAULT '',
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);

-- Cuentas de residenciales (scope = tenant) y del personal de la empresa (scope = platform)
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  scope               TEXT NOT NULL CHECK (scope IN ('tenant', 'platform')),
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                TEXT NOT NULL,
  phone               TEXT NOT NULL DEFAULT '',
  role                TEXT NOT NULL,
  profile             TEXT NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'reset', 'suspended')),
  password_hash       TEXT,
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  session_version     INTEGER NOT NULL DEFAULT 1,
  last_login_at       TEXT,
  password_changed_at TEXT,
  created_at          TEXT NOT NULL,
  CHECK ((scope = 'tenant') = (tenant_id IS NOT NULL))
);
CREATE INDEX users_tenant ON users(tenant_id);

-- Invitación de activación o restablecimiento. Sólo se guardan hashes.
CREATE TABLE invites (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('activate', 'reset')),
  token_hash  TEXT NOT NULL UNIQUE,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE mfa_challenges (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL
);

-- Sesiones opacas: la cookie lleva un token aleatorio y aquí sólo su hash
CREATE TABLE sessions (
  token_hash      TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_version INTEGER NOT NULL,
  csrf_token      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  ip              TEXT,
  user_agent      TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE tenant_records (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collection  TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, collection, id)
);

CREATE TABLE invoices (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'void')),
  due_date    TEXT NOT NULL,
  method      TEXT,
  reference   TEXT NOT NULL DEFAULT '',
  paid_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX invoices_tenant ON invoices(tenant_id, period);

CREATE TABLE ecartpay_checkouts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  periods       TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'confirmed', 'failed')),
  checkout_url  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  confirmed_at  TEXT
);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  tenant_id   TEXT,
  actor       TEXT NOT NULL DEFAULT 'Sistema',
  action      TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'danger')),
  ip          TEXT
);
CREATE INDEX audit_tenant ON audit_log(tenant_id, at);

-- Bandeja de salida transaccional: el mensaje se guarda en la misma transacción que el cambio
-- y un despachador lo envía después (con reintentos). Así no se pierden ni se duplican avisos.
CREATE TABLE outbox (
  id          TEXT PRIMARY KEY,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient   TEXT NOT NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  meta        TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  sent_at     TEXT
);
CREATE INDEX outbox_status ON outbox(status, created_at);
