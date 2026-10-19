// Residenciales y sus colecciones operativas.
import { json, parseJson } from '../db/database.js';
import { toUserView } from './accounts.js';

export const COLLECTIONS = [
  'units',
  'passes',
  'accessLogs',
  'payments',
  'notices',
  'notifications',
  'reservations',
  'incidents',
  'packages',
  'polls',
  'expenses',
  'sos',
];

const toTenant = (r) =>
  r && {
    id: r.id,
    name: r.name,
    address: r.address,
    plan: r.plan_id,
    status: r.status,
    statusReason: r.status_reason,
    statusAt: r.status_at,
    contact: r.contact,
    settings: parseJson(r.settings, {}),
    createdAt: r.created_at,
  };

export function tenantsRepository(db) {
  const records = db.prepare('SELECT data FROM tenant_records WHERE tenant_id = ? AND collection = ? ORDER BY rowid DESC');
  const insertRecord = db.prepare('INSERT INTO tenant_records (tenant_id, collection, id, data, updated_at) VALUES (?, ?, ?, ?, ?)');
  const updateRecord = db.prepare('UPDATE tenant_records SET data = ?, updated_at = ? WHERE tenant_id = ? AND collection = ? AND id = ?');
  const deleteRecord = db.prepare('DELETE FROM tenant_records WHERE tenant_id = ? AND collection = ? AND id = ?');

  const repo = {
    find: (id) => toTenant(db.prepare('SELECT * FROM tenants WHERE id = ?').get(id)),
    list: () => db.prepare('SELECT * FROM tenants ORDER BY created_at').all().map(toTenant),
    create: (t) =>
      db
        .prepare('INSERT INTO tenants (id, name, address, plan_id, status, contact, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(t.id, t.name, t.address || '', t.plan, t.status || 'active', t.contact || '', json(t.settings), t.createdAt),
    setStatus: (id, status, reason, at) =>
      db.prepare('UPDATE tenants SET status = ?, status_reason = ?, status_at = ? WHERE id = ?').run(status, reason, at, id),
    setPlan: (id, plan) => db.prepare('UPDATE tenants SET plan_id = ? WHERE id = ?').run(plan, id),
    saveSettings: (id, settings) => db.prepare('UPDATE tenants SET settings = ? WHERE id = ?').run(json(settings), id),
    countUnits: (id) => db.prepare("SELECT COUNT(*) AS n FROM tenant_records WHERE tenant_id = ? AND collection = 'units'").get(id).n,

    listRecords: (tenantId, collection) => records.all(tenantId, collection).map((r) => JSON.parse(r.data)),

    /** Inserta una colección completa conservando el orden (el primer elemento queda como el más reciente). */
    insertMany(tenantId, collection, items) {
      const at = new Date().toISOString();
      for (const item of [...items].reverse()) insertRecord.run(tenantId, collection, item.id, json(item), at);
    },

    /** Lee todos los datos de un residencial (para la vista por rol). */
    snapshot(tenantId, accounts) {
      const tenant = repo.find(tenantId);
      const data = { settings: tenant.settings };
      for (const c of COLLECTIONS) data[c] = repo.listRecords(tenantId, c);
      const invites = accounts.invitesByTenant(tenantId);
      data.users = accounts.listByTenant(tenantId).map((a) => toUserView(a, invites.get(a.id)));
      return data;
    },

    /**
     * Unidad de trabajo para las operaciones compartidas: carga cada colección la primera vez que se usa
     * y al confirmar guarda sólo los elementos que cambiaron (por referencia), los nuevos y los eliminados.
     */
    unitOfWork(tenantId, accounts) {
      const loaded = new Map(); // colección -> Map(id -> objeto original)
      const state = {};
      const load = (key) => {
        if (key === 'settings') return repo.find(tenantId).settings;
        if (key === 'users') return accounts.listByTenant(tenantId).map((a) => toUserView(a));
        if (COLLECTIONS.includes(key)) return repo.listRecords(tenantId, key);
        return undefined;
      };
      const next = new Proxy(state, {
        get(target, key) {
          if (typeof key !== 'string') return undefined;
          if (!(key in target)) {
            const value = load(key);
            if (value === undefined) return undefined;
            target[key] = value;
            loaded.set(key, key === 'settings' ? value : new Map(value.map((x) => [x.id, x])));
          }
          return target[key];
        },
        set(target, key, value) {
          if (!(key in target)) Reflect.get(next, key); // registra el original antes de reemplazarlo
          target[key] = value;
          return true;
        },
      });

      return {
        next,
        /** Guarda los cambios. Devuelve `true` si algo cambió. */
        commit() {
          const at = new Date().toISOString();
          let changed = false;
          for (const [key, original] of loaded) {
            const current = state[key];
            if (key === 'settings') {
              if (current !== original) {
                repo.saveSettings(tenantId, current);
                changed = true;
              }
              continue;
            }
            const currentIds = new Set();
            for (const item of [...current].reverse()) {
              currentIds.add(item.id);
              const before = original.get(item.id);
              if (before === item) continue;
              changed = true;
              if (key === 'users') {
                if (!before) throw new Error('Las cuentas se crean desde la gestión de cuentas.');
                accounts.update(item.id, { name: item.name, profile: { unitId: item.unitId, vehicles: item.vehicles, shift: item.shift } });
              } else if (before) {
                updateRecord.run(json(item), at, tenantId, key, item.id);
              } else {
                insertRecord.run(tenantId, key, item.id, json(item), at);
              }
            }
            for (const id of original.keys()) {
              if (currentIds.has(id)) continue;
              if (key === 'users') throw new Error('Las cuentas se eliminan desde la gestión de cuentas.');
              deleteRecord.run(tenantId, key, id);
              changed = true;
            }
          }
          return changed;
        },
      };
    },
  };
  return repo;
}
