// Qué parte de los datos del residencial puede ver cada rol.
// La API aplica esta vista antes de responder: nadie recibe datos que su rol no necesita
// (por ejemplo, un residente no recibe los pases, pagos ni datos de contacto de otras casas).

const pickKeys = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
const DEVICE_PUBLIC = ['id', 'name', 'kind', 'lane', 'status', 'connectedAt', 'disconnectedAt'];
const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

/** Datos públicos de una persona para otros usuarios del residencial. */
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  role: u.role,
  ...(u.role === 'resident' ? { unitId: u.unitId } : { shift: u.shift }),
});

const forResident = (tenant, me) => {
  const mine = (x) => x.unitId === me.unitId;
  const seesNotice = (n) => n.audience !== 'staff';
  return {
    settings: omit(tenant.settings, []),
    units: tenant.units,
    users: tenant.users.map((u) => {
      if (u.id === me.id) return u;
      if (u.role !== 'resident' || u.unitId === me.unitId) return publicUser(u);
      return { id: u.id, role: u.role }; // otras casas: sólo cuentan para porcentajes de participación
    }),
    passes: tenant.passes.filter(mine),
    accessLogs: tenant.accessLogs.filter((a) => mine(a) || a.kind === 'general').map((a) => (mine(a) ? a : omit(a, ['photo']))),
    // Los pagos de otras casas sólo alimentan los totales de transparencia
    payments: tenant.payments.map((p) =>
      mine(p)
        ? p
        : { id: p.id, unitId: null, period: p.period, month: p.month, amount: p.amount, status: p.status, createdAt: p.createdAt },
    ),
    notices: tenant.notices.filter(seesNotice).map((n) => {
      const readBy = n.readBy || [];
      const answer = n.confirmations?.[me.id];
      return {
        ...n,
        readBy: readBy.filter((id) => id === me.id),
        readCount: readBy.length,
        confirmations: answer ? { [me.id]: answer } : {},
      };
    }),
    notifications: tenant.notifications.filter((n) => n.userId === me.id),
    reservations: tenant.reservations.map((r) => (mine(r) ? r : omit(r, ['residentId', 'unitId', 'notes']))),
    incidents: tenant.incidents.filter(mine),
    packages: tenant.packages.filter(mine),
    // Votos anónimos: se conservan los conteos y el voto propio
    polls: tenant.polls.map((p) => ({
      ...p,
      votes: Object.fromEntries(Object.entries(p.votes || {}).map(([uid, o], i) => [uid === me.id ? uid : `anon${i}`, o])),
    })),
    expenses: tenant.expenses,
    sos: tenant.sos.filter((s) => s.residentId === me.id),
    bankMovements: [],
    // Sólo las plumas, para el botón "Abrir pluma" cuando el residencial lo permite
    devices: (tenant.devices || []).filter((d) => d.kind === 'barrier' && d.status === 'active').map((d) => pickKeys(d, DEVICE_PUBLIC)),
    tags: (tenant.tags || []).filter(mine),
    gateCommands: (tenant.gateCommands || []).filter((c) => c.by === me.id).slice(0, 5),
    gateEvents: [],
    whatsappOptOuts: (tenant.whatsappOptOuts || []).filter((o) => o.id === me.id),
    // Tarjetas propias, sin el identificador de Ecart Pay (sólo el servidor cobra con él)
    cards: (tenant.cards || []).filter((c) => c.userId === me.id).map((c) => omit(c, ['token'])),
  };
};

const forGuard = (tenant, me) => ({
  settings: { name: tenant.settings.name, generalProviders: tenant.settings.generalProviders, cover: tenant.settings.cover },
  units: tenant.units,
  users: tenant.users.map((u) => (u.id === me.id ? u : { ...publicUser(u), ...(u.role === 'resident' ? { vehicles: u.vehicles } : {}) })),
  passes: [], // la validación de códigos ocurre en el servidor
  accessLogs: tenant.accessLogs,
  payments: [],
  notices: tenant.notices
    .filter((n) => ['staff', 'all'].includes(n.audience))
    .map((n) => ({ ...n, readBy: (n.readBy || []).filter((id) => id === me.id), confirmations: {} })),
  notifications: tenant.notifications.filter((n) => n.userId === me.id),
  reservations: [],
  incidents: [],
  packages: tenant.packages,
  polls: [],
  expenses: [],
  sos: tenant.sos,
  bankMovements: [],
  devices: (tenant.devices || []).map((d) => pickKeys(d, DEVICE_PUBLIC)),
  tags: [],
  gateCommands: (tenant.gateCommands || []).slice(0, 30),
  gateEvents: (tenant.gateEvents || []).slice(0, 60),
  whatsappOptOuts: (tenant.whatsappOptOuts || []).filter((o) => o.id === me.id),
  cards: [],
});

// Las tarjetas de los residentes son suyas: administración no las recibe.
const forAdmin = (tenant, me) => ({ ...tenant, notifications: tenant.notifications.filter((n) => n.userId === me.id), cards: [] });

export function viewFor(tenant, me) {
  if (me.role === 'admin') return forAdmin(tenant, me);
  if (me.role === 'guard') return forGuard(tenant, me);
  return forResident(tenant, me);
}
