// Cuentas, invitaciones y retos de verificación en dos pasos.
import { json, parseJson } from '../db/database.js';

const PROFILE_KEYS = ['unitId', 'vehicles', 'shift'];

const toAccount = (r) =>
  r && {
    id: r.id,
    scope: r.scope,
    tenantId: r.tenant_id,
    email: r.email,
    name: r.name,
    phone: r.phone,
    role: r.role,
    profile: parseJson(r.profile, {}),
    status: r.status,
    passwordHash: r.password_hash,
    failed: r.failed_attempts,
    lockedUntil: r.locked_until,
    sessionVersion: r.session_version,
    lastLoginAt: r.last_login_at,
    passwordChangedAt: r.password_changed_at,
    createdAt: r.created_at,
  };

/** Usuario tal como lo ven las pantallas: perfil + resumen de seguridad, sin secretos. */
export const toUserView = (a, invite) => ({
  id: a.id,
  name: a.name,
  role: a.role,
  email: a.email,
  phone: a.phone,
  vehicles: [],
  ...a.profile,
  auth: {
    status: a.status,
    lockedUntil: a.lockedUntil,
    lastLoginAt: a.lastLoginAt,
    passwordChangedAt: a.passwordChangedAt,
    invite: invite ? { purpose: invite.purpose, expiresAt: invite.expiresAt } : null,
  },
});

const COLUMNS = {
  name: 'name', phone: 'phone', status: 'status', passwordHash: 'password_hash', failed: 'failed_attempts',
  lockedUntil: 'locked_until', sessionVersion: 'session_version', lastLoginAt: 'last_login_at', passwordChangedAt: 'password_changed_at',
};

export function accountsRepository(db) {
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
  const byTenant = db.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at');
  const staff = db.prepare("SELECT * FROM users WHERE scope = 'platform' ORDER BY created_at");
  const insert = db.prepare(`INSERT INTO users (id, scope, tenant_id, email, name, phone, role, profile, status, password_hash, session_version, password_changed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  const invitesByTenant = db.prepare('SELECT i.* FROM invites i JOIN users u ON u.id = i.user_id WHERE u.tenant_id = ?');
  const inviteByUser = db.prepare('SELECT * FROM invites WHERE user_id = ?');
  const inviteByToken = db.prepare('SELECT * FROM invites WHERE token_hash = ?');
  const toInvite = (r) => r && { userId: r.user_id, purpose: r.purpose, tokenHash: r.token_hash, codeHash: r.code_hash, attempts: r.attempts, expiresAt: r.expires_at };

  return {
    findById: (id) => toAccount(byId.get(id)),
    findByEmail: (email) => toAccount(byEmail.get(email)),
    listByTenant: (tenantId) => byTenant.all(tenantId).map(toAccount),
    listStaff: () => staff.all().map(toAccount),

    create(a) {
      insert.run(a.id, a.scope, a.tenantId ?? null, a.email, a.name, a.phone || '', a.role, json(pickProfile(a.profile)), a.status || 'pending', a.passwordHash ?? null, a.passwordChangedAt ?? null, a.createdAt);
      return this.findById(a.id);
    },
    update(id, patch) {
      const sets = [];
      const values = [];
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'profile') {
          sets.push('profile = ?');
          values.push(json(pickProfile(value)));
        } else if (COLUMNS[key]) {
          sets.push(`${COLUMNS[key]} = ?`);
          values.push(value);
        }
      }
      if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    },
    bumpSessionVersion: (id) => db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(id),
    delete: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id),

    // ---------- Invitaciones ----------
    invitesByTenant: (tenantId) => new Map(invitesByTenant.all(tenantId).map((r) => [r.user_id, toInvite(r)])),
    inviteFor: (userId) => toInvite(inviteByUser.get(userId)),
    inviteByTokenHash: (hash) => toInvite(inviteByToken.get(hash)),
    saveInvite: (i) =>
      db.prepare(`INSERT INTO invites (user_id, purpose, token_hash, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET purpose = excluded.purpose, token_hash = excluded.token_hash, code_hash = excluded.code_hash,
        attempts = 0, expires_at = excluded.expires_at, created_at = excluded.created_at`).run(i.userId, i.purpose, i.tokenHash, i.codeHash, i.expiresAt, i.createdAt),
    setInviteAttempts: (userId, attempts) => db.prepare('UPDATE invites SET attempts = ? WHERE user_id = ?').run(attempts, userId),
    deleteInvite: (userId) => db.prepare('DELETE FROM invites WHERE user_id = ?').run(userId),

    // ---------- Verificación en dos pasos ----------
    createChallenge: (c) => db.prepare('INSERT INTO mfa_challenges (id, user_id, code_hash, attempts, expires_at) VALUES (?, ?, ?, 0, ?)').run(c.id, c.userId, c.codeHash, c.expiresAt),
    getChallenge(id) {
      const r = db.prepare('SELECT * FROM mfa_challenges WHERE id = ?').get(id);
      return r && { id: r.id, userId: r.user_id, codeHash: r.code_hash, attempts: r.attempts, expiresAt: r.expires_at };
    },
    setChallengeAttempts: (id, attempts) => db.prepare('UPDATE mfa_challenges SET attempts = ? WHERE id = ?').run(attempts, id),
    deleteChallenge: (id) => db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(id),
    purgeExpiredChallenges: (now) => db.prepare('DELETE FROM mfa_challenges WHERE expires_at < ?').run(now),
  };
}

function pickProfile(profile = {}) {
  return Object.fromEntries(PROFILE_KEYS.filter((k) => profile[k] !== undefined).map((k) => [k, profile[k]]));
}
