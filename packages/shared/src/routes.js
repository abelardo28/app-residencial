// Contrato REST de las operaciones del residencial (base: /api/v1).
// La API registra una ruta por entrada; la APP genera su cliente HTTP con la misma tabla,
// así ambos lados no pueden quedar desalineados.
//
// `args` convierte los argumentos con los que la APP llama a la acción en el objeto de entrada
// de la operación. Las claves que aparecen en `path` (`:id`) viajan en la URL; el resto, en el cuerpo.
const one = (key) => (value) => ({ [key]: value });
const same = (input = {}) => input;

export const OPERATION_ROUTES = {
  markRead: { method: 'POST', path: '/notifications/:id/read', args: one('id') },
  markAllRead: { method: 'POST', path: '/notifications/read-all', args: () => ({}) },

  createPass: { method: 'POST', path: '/passes', args: same },
  revokePass: { method: 'POST', path: '/passes/:id/revoke', args: one('id') },
  regeneratePass: { method: 'POST', path: '/passes/:id/regenerate', args: one('id') },

  checkCode: { method: 'POST', path: '/access/check', args: one('text') },
  registerEntry: { method: 'POST', path: '/access/entries', args: same },
  registerExit: { method: 'POST', path: '/access/entries/:id/exit', args: one('id') },
  generalAccess: { method: 'POST', path: '/access/general', args: same },

  submitPayment: { method: 'POST', path: '/payments', args: same },
  reviewPayment: { method: 'POST', path: '/payments/:id/review', args: (id, status, note) => ({ id, status, note }) },
  registerCashPayment: { method: 'POST', path: '/payments/cash', args: same },
  sendReminder: { method: 'POST', path: '/payments/reminders', args: one('residentIds') },
  waiveLateFee: { method: 'POST', path: '/units/:unitId/late-fees/waive', args: (unitId, period) => ({ unitId, period }) },
  reconcileBank: { method: 'POST', path: '/bank/reconcile', args: one('movements') },
  assignBankMovement: { method: 'POST', path: '/bank/movements/:id/assign', args: (id, unitId, periods) => ({ id, unitId, periods }) },
  ignoreBankMovement: { method: 'POST', path: '/bank/movements/:id/ignore', args: one('id') },

  createNotice: { method: 'POST', path: '/notices', args: same },
  deleteNotice: { method: 'DELETE', path: '/notices/:id', args: one('id') },
  markNoticeRead: { method: 'POST', path: '/notices/:id/read', args: one('id') },
  confirmNotice: { method: 'POST', path: '/notices/:id/confirmation', args: (id, answer) => ({ id, answer }) },

  createReservation: { method: 'POST', path: '/reservations', args: same },
  cancelReservation: { method: 'POST', path: '/reservations/:id/cancel', args: one('id') },

  createIncident: { method: 'POST', path: '/incidents', args: same },
  updateIncident: { method: 'PATCH', path: '/incidents/:id', args: (id, data) => ({ id, ...data }) },

  registerPackage: { method: 'POST', path: '/packages', args: same },
  deliverPackage: { method: 'POST', path: '/packages/:id/deliver', args: (id, code) => ({ id, code }) },

  createPoll: { method: 'POST', path: '/polls', args: same },
  vote: { method: 'POST', path: '/polls/:id/votes', args: (id, optionId) => ({ id, optionId }) },

  addExpense: { method: 'POST', path: '/expenses', args: same },

  triggerSos: { method: 'POST', path: '/sos', args: one('kind') },
  attendSos: { method: 'POST', path: '/sos/:id/attend', args: one('id') },

  updateUser: { method: 'PATCH', path: '/users/:id', args: (id, data) => ({ id, ...data }) },
  updateSettings: { method: 'PATCH', path: '/settings', args: same },
  saveUnit: { method: 'POST', path: '/units', args: same },
  deleteUnit: { method: 'DELETE', path: '/units/:id', args: one('id') },
  saveAmenity: { method: 'POST', path: '/amenities', args: same },
  deleteAmenity: { method: 'DELETE', path: '/amenities/:id', args: one('id') },
  saveCharge: { method: 'POST', path: '/charges', args: same },
  deleteCharge: { method: 'DELETE', path: '/charges/:id', args: one('id') },
  setWhatsappAlerts: { method: 'POST', path: '/whatsapp/alerts', args: one('enabled') },
  setDefaultCard: { method: 'POST', path: '/cards/:id/default', args: one('id') },
  deleteCard: { method: 'DELETE', path: '/cards/:id', args: one('id') },

  // Caseta física (las operaciones de los equipos tienen sus propias rutas en /devices)
  createDevice: { method: 'POST', path: '/gate/devices', args: same },
  updateDevice: { method: 'PATCH', path: '/gate/devices/:id', args: (id, data) => ({ id, ...data }) },
  rotateDeviceToken: { method: 'POST', path: '/gate/devices/:id/token', args: one('id') },
  deleteDevice: { method: 'DELETE', path: '/gate/devices/:id', args: one('id') },
  registerTag: { method: 'POST', path: '/gate/tags', args: same },
  updateTag: { method: 'PATCH', path: '/gate/tags/:id', args: (id, data) => ({ id, ...data }) },
  deleteTag: { method: 'DELETE', path: '/gate/tags/:id', args: one('id') },
  openGate: { method: 'POST', path: '/gate/open', args: same },
  offlinePack: { method: 'POST', path: '/access/offline-pack', args: () => ({}) },
};

/** Separa una entrada en la ruta concreta y el cuerpo, p. ej. `/passes/p_1/revoke` + `{}`. */
export function splitRoute(route, input) {
  const body = { ...input };
  const path = route.path.replace(/:(\w+)/g, (_, key) => {
    const value = body[key];
    delete body[key];
    return encodeURIComponent(value);
  });
  return { path, body };
}
