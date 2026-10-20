// Estado de las conversaciones del asistente de WhatsApp.
import { json, parseJson } from '../db/database.js';

export function whatsappRepository(db) {
  const getSession = db.prepare('SELECT * FROM whatsapp_sessions WHERE phone = ?');
  const upsert = db.prepare(`INSERT INTO whatsapp_sessions (phone, tenant_id, user_id, state, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET tenant_id = excluded.tenant_id, user_id = excluded.user_id, state = excluded.state, updated_at = excluded.updated_at`);
  const inbound = db.prepare('INSERT OR IGNORE INTO whatsapp_inbound (id, received_at) VALUES (?, ?)');
  return {
    session(phone) {
      const r = getSession.get(phone);
      return r && { phone: r.phone, tenantId: r.tenant_id, userId: r.user_id, state: parseJson(r.state), updatedAt: r.updated_at };
    },
    saveSession: (phone, { tenantId, userId, state }) => upsert.run(phone, tenantId, userId, json(state), new Date().toISOString()),
    /** Registra un mensaje recibido. Devuelve `false` si ya se había procesado. */
    markInbound: (id) => inbound.run(id, new Date().toISOString()).changes === 1,
    purge(before) {
      db.prepare('DELETE FROM whatsapp_inbound WHERE received_at < ?').run(before);
    },
  };
}
