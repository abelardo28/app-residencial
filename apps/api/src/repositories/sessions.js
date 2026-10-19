export function sessionsRepository(db) {
  const toSession = (r) =>
    r && { tokenHash: r.token_hash, userId: r.user_id, sessionVersion: r.session_version, csrfToken: r.csrf_token, createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at };
  return {
    create: (s) =>
      db.prepare('INSERT INTO sessions (token_hash, user_id, session_version, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.tokenHash, s.userId, s.sessionVersion, s.csrfToken, s.createdAt, s.createdAt, s.expiresAt, s.ip ?? null, s.userAgent ?? null),
    find: (tokenHash) => toSession(db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash)),
    touch: (tokenHash, at) => db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(at, tokenHash),
    delete: (tokenHash) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash),
    deleteForUser: (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId),
    purgeExpired: (now) => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now),
  };
}
