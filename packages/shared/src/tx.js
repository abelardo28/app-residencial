import { uid, nowIso } from './format.js';

/** Error de negocio con código HTTP sugerido. La API lo traduce a la respuesta; la APP muestra el mensaje. */
export class DomainError extends Error {
  constructor(message, status = 400, code = 'invalid') {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
  }
}
export const notFound = (what = 'El registro') => new DomainError(`${what} no existe.`, 404, 'not_found');
export const forbidden = (msg = 'No tienes permiso para hacer esto.') => new DomainError(msg, 403, 'forbidden');

/**
 * Ayudantes de escritura sobre los datos de un residencial (`next`).
 * `next` es un objeto con las colecciones (arreglos) y `settings`. En la APP es una copia del estado;
 * en la API es una unidad de trabajo que lee de la base de datos y guarda sólo lo que cambió.
 * Las operaciones nunca mutan elementos: crean objetos nuevos, así se detecta qué cambió.
 */
export function createTx(next) {
  const side = { audit: [], outbox: [] };
  const ids = (list) => list.map((u) => u.id);
  const t = {
    next,
    side,
    get: (c, id) => next[c].find((x) => x.id === id),
    must(c, id, what) {
      const item = t.get(c, id);
      if (!item) throw notFound(what);
      return item;
    },
    add: (c, item) => {
      next[c] = [item, ...next[c]];
      return item;
    },
    patch: (c, id, ch) => {
      next[c] = next[c].map((x) => (x.id === id ? { ...x, ...(typeof ch === 'function' ? ch(x) : ch) } : x));
    },
    remove: (c, id) => {
      next[c] = next[c].filter((x) => x.id !== id);
    },
    usersBy: (fn) => ids(next.users.filter(fn)),
    admins: () => t.usersBy((u) => u.role === 'admin'),
    guards: () => t.usersBy((u) => u.role === 'guard'),
    residents: () => t.usersBy((u) => u.role === 'resident'),
    unitResidents: (unitId) => t.usersBy((u) => u.role === 'resident' && u.unitId === unitId),
    unitLabel: (unitId) => next.units.find((u) => u.id === unitId)?.label || '',
    userName: (id) => next.users.find((u) => u.id === id)?.name || '',
    notify: (userIds, n) => {
      const at = nowIso();
      const items = [...new Set(userIds)].map((userId) => ({ ...n, id: uid('nt_'), userId, read: false, createdAt: at }));
      if (items.length) next.notifications = [...items, ...next.notifications];
    },
    audit: (e) => side.audit.push(e),
    send: (msgs) => side.outbox.push(...msgs),
  };
  return t;
}
