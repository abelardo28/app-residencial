// Caseta física: plumas, lectores de tags RFID y cámaras de placas.
//
// Los equipos de la caseta no se conectan directo a internet: un agente local (apps/gate-agent) corre en una
// computadora o Raspberry Pi de la caseta, mantiene una conexión saliente con la API y:
//   - recibe las órdenes "abrir pluma" y activa el relevador (Shelly, controlador HTTP o consola);
//   - reenvía las lecturas de tags y placas para que el servidor decida si abre.
// Cada equipo se identifica con un token firmado (`RD1.…`) que administración genera en la APP.
import { uid, nowIso } from './format.js';
import { evaluatePass, normalizePlate } from './access.js';
import { DomainError, forbidden } from './tx.js';

export const DEVICE_KINDS = { barrier: 'Pluma', reader: 'Lector de tags', camera: 'Cámara de placas' };
export const LANES = { entrada: 'Entrada de visitas', residentes: 'Entrada de residentes', salida: 'Salida' };
export const GATE_DEFAULTS = { autoOpenOnPass: true, residentOpen: false, autoOpenResidentPlates: true };
export const gateSettings = (settings = {}) => ({ ...GATE_DEFAULTS, ...(settings.gate || {}) });

/** Segundos que una orden de apertura sigue vigente. Pasado ese tiempo el agente la ignora: la pluma nunca abre tarde. */
export const COMMAND_TTL_SECONDS = 20;
const MAX_EVENTS = 300;
const MAX_COMMANDS = 200;

// ---------- Tokens de los equipos ----------
const tokenPayload = (tenantId, deviceId, version) => `dev.${tenantId}.${deviceId}.${version}`;
export const deviceToken = (tenantId, device, sign) =>
  `RD1.${tenantId}.${device.id}.${device.version}.${sign(tokenPayload(tenantId, device.id, device.version))}`;

/** Lee un token de equipo. Devuelve null si está mal formado o la firma no corresponde. */
export function verifyDeviceToken(token = '', sign) {
  const parts = String(token).split('.');
  if (parts.length !== 5 || parts[0] !== 'RD1') return null;
  const [, tenantId, deviceId, v, sig] = parts;
  const version = Number(v);
  if (!Number.isInteger(version) || sign(tokenPayload(tenantId, deviceId, version)) !== sig) return null;
  return { tenantId, deviceId, version };
}

export const normalizeTag = (code = '') =>
  String(code)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

// ---------- Ayudantes ----------
const keepLast = (t, c, max) => {
  if (t.next[c].length > max) t.next[c] = t.next[c].slice(0, max);
};
function addEvent(t, event) {
  const e = { id: uid('ge_'), at: nowIso(), ...event };
  t.add('gateEvents', e);
  keepLast(t, 'gateEvents', MAX_EVENTS);
  return e;
}
const activeBarriers = (t) => t.next.devices.filter((d) => d.kind === 'barrier' && d.status === 'active');
/** Pluma que corresponde a un carril (o a un lector / cámara). */
export function barrierFor(devices, { lane, barrierId } = {}) {
  const barriers = devices.filter((d) => d.kind === 'barrier' && d.status === 'active');
  return barriers.find((d) => d.id === barrierId) || barriers.find((d) => d.lane === lane) || barriers[0] || null;
}

/** Deja en cola una orden de apertura para el agente de la caseta. */
function queueOpen(t, barrier, { reason, by }) {
  if (!barrier) return null;
  const command = {
    id: uid('gc_'),
    deviceId: barrier.id,
    action: 'open',
    reason,
    by: by.id,
    byName: by.name,
    status: 'pending',
    createdAt: nowIso(),
  };
  t.add('gateCommands', command);
  keepLast(t, 'gateCommands', MAX_COMMANDS);
  return command;
}

/** Órdenes que el agente todavía debe ejecutar. */
export const pendingCommands = (commands, deviceId, now = Date.now()) =>
  commands.filter(
    (c) => c.deviceId === deviceId && c.status === 'pending' && now - new Date(c.createdAt).getTime() < COMMAND_TTL_SECONDS * 1000,
  );

/** Abre la pluma de entrada después de registrar una visita con pase, si la configuración lo indica. */
export function openAfterEntry(t, user, log, wanted) {
  const cfg = gateSettings(t.next.settings);
  const open = wanted ?? (log.kind === 'pass' && cfg.autoOpenOnPass);
  if (!open) return null;
  return queueOpen(t, barrierFor(t.next.devices || [], { lane: 'entrada' }), { reason: `Ingreso de ${log.visitorName}`, by: user });
}

// ---------- Operaciones ----------
const ADMIN = ['admin'];
const GUARD = ['guard'];
const DEVICE = ['device'];

export const GATE_OPERATIONS = {
  createDevice: {
    roles: ADMIN,
    run(t, { sign, tenantId }, { name, kind, lane, barrierId = null }) {
      const device = {
        id: uid('dv_'),
        name,
        kind,
        lane,
        barrierId: kind === 'barrier' ? null : barrierId,
        version: 1,
        status: 'active',
        createdAt: nowIso(),
        connectedAt: null,
        disconnectedAt: null,
      };
      t.add('devices', device);
      t.audit({ action: 'Equipo de caseta agregado', target: `${DEVICE_KINDS[kind]} · ${name}` });
      return { device, token: deviceToken(tenantId, device, sign) };
    },
  },
  updateDevice: {
    roles: ADMIN,
    run(t, _ctx, { id, ...changes }) {
      const device = t.must('devices', id, 'El equipo');
      t.patch('devices', id, changes);
      t.audit({ action: 'Equipo de caseta actualizado', target: device.name });
    },
  },
  // Invalida el token anterior (por ejemplo, si se perdió la computadora de la caseta).
  rotateDeviceToken: {
    roles: ADMIN,
    run(t, { sign, tenantId }, { id }) {
      const device = t.must('devices', id, 'El equipo');
      const next = { ...device, version: device.version + 1 };
      t.patch('devices', id, { version: next.version });
      t.audit({ action: 'Token de equipo renovado', target: device.name, severity: 'warn' });
      return { token: deviceToken(tenantId, next, sign) };
    },
  },
  deleteDevice: {
    roles: ADMIN,
    run(t, _ctx, { id }) {
      const device = t.must('devices', id, 'El equipo');
      t.remove('devices', id);
      t.audit({ action: 'Equipo de caseta eliminado', target: device.name, severity: 'warn' });
    },
  },

  registerTag: {
    roles: ADMIN,
    run(t, _ctx, { unitId, code, label }) {
      const unit = t.must('units', unitId, 'La casa');
      const clean = normalizeTag(code);
      if (clean.length < 4) throw new DomainError('El número del tag debe tener al menos 4 caracteres.');
      if (t.next.tags.some((x) => x.code === clean)) throw new DomainError('Ese tag ya está registrado.', 409, 'duplicate_tag');
      const tag = { id: uid('tg_'), unitId, code: clean, label: label || 'Tag', status: 'active', createdAt: nowIso() };
      t.add('tags', tag);
      t.audit({ action: 'Tag registrado', target: `${unit.label} · ${tag.label}` });
      return tag;
    },
  },
  updateTag: {
    roles: ADMIN,
    run(t, _ctx, { id, status, label }) {
      const tag = t.must('tags', id, 'El tag');
      t.patch('tags', id, { ...(status ? { status } : {}), ...(label ? { label } : {}) });
      t.audit({ action: status === 'blocked' ? 'Tag bloqueado' : 'Tag actualizado', target: `${t.unitLabel(tag.unitId)} · ${tag.label}` });
    },
  },
  deleteTag: {
    roles: ADMIN,
    run(t, _ctx, { id }) {
      const tag = t.must('tags', id, 'El tag');
      t.remove('tags', id);
      t.audit({ action: 'Tag eliminado', target: `${t.unitLabel(tag.unitId)} · ${tag.label}` });
    },
  },

  // Abrir la pluma a mano: vigilancia y administración siempre; residentes sólo si el residencial lo permite.
  openGate: {
    roles: ['guard', 'admin', 'resident'],
    run(t, { user }, { deviceId, reason = '' }) {
      const cfg = gateSettings(t.next.settings);
      if (user.role === 'resident') {
        if (!cfg.residentOpen) throw forbidden('Este residencial no permite abrir la pluma desde la app.');
        const recent = t.next.gateCommands.find((c) => c.by === user.id && Date.now() - new Date(c.createdAt).getTime() < 10e3);
        if (recent) throw new DomainError('Espera unos segundos antes de volver a abrir.', 429, 'too_fast');
      }
      const barrier = deviceId
        ? activeBarriers(t).find((d) => d.id === deviceId)
        : barrierFor(t.next.devices, { lane: user.role === 'resident' ? 'residentes' : 'entrada' });
      if (!barrier) throw new DomainError('No hay una pluma conectada.', 404, 'no_barrier');
      const who = user.role === 'resident' ? `${user.name} · ${t.unitLabel(user.unitId)}` : user.name;
      const command = queueOpen(t, barrier, { reason: reason || 'Apertura manual', by: user });
      addEvent(t, {
        deviceId: barrier.id,
        kind: 'manual',
        value: '',
        result: 'opened',
        unitId: user.unitId || null,
        label: who,
        detail: reason,
      });
      if (user.role !== 'guard') t.audit({ action: 'Pluma abierta desde la app', target: `${barrier.name} · ${who}` });
      return command;
    },
  },

  // Lectura de un tag o una placa que envía el agente de la caseta.
  gateEvent: {
    roles: DEVICE,
    run(t, { user: device }, { kind, value }) {
      const cfg = gateSettings(t.next.settings);
      const self = t.must('devices', device.id, 'El equipo');
      const barrier = barrierFor(t.next.devices, self);
      const by = { id: self.id, name: self.name };

      if (kind === 'tag') {
        const code = normalizeTag(value);
        const tag = t.next.tags.find((x) => x.code === code);
        if (tag?.status === 'active') {
          const label = `${t.unitLabel(tag.unitId)} · ${tag.label}`;
          const command = queueOpen(t, barrier, { reason: `Tag ${label}`, by });
          return addEvent(t, {
            deviceId: self.id,
            kind,
            value: code,
            result: command ? 'opened' : 'no_barrier',
            unitId: tag.unitId,
            label,
          });
        }
        const reason = tag ? 'Tag bloqueado' : 'Tag no registrado';
        t.notify(t.guards(), {
          title: `${reason} en ${self.name}`,
          body: `Tag ${code}${tag ? ` · ${t.unitLabel(tag.unitId)}` : ''}`,
          kind: 'alert',
          link: '/',
        });
        return addEvent(t, { deviceId: self.id, kind, value: code, result: 'denied', unitId: tag?.unitId || null, label: reason });
      }

      // Placa
      const plate = normalizePlate(value);
      const resident = t.next.users.find((u) => u.role === 'resident' && (u.vehicles || []).map(normalizePlate).includes(plate));
      if (resident) {
        const label = `${t.unitLabel(resident.unitId)} · ${resident.name}`;
        const command = cfg.autoOpenResidentPlates ? queueOpen(t, barrier, { reason: `Placa ${plate} · ${label}`, by }) : null;
        return addEvent(t, {
          deviceId: self.id,
          kind,
          value: plate,
          result: command ? 'opened' : 'resident',
          unitId: resident.unitId,
          label,
        });
      }
      const pass = t.next.passes.find((p) => p.expectedPlate === plate && evaluatePass(p).ok);
      if (pass) {
        // Una visita con pase siempre la confirma el vigilante (foto, número de acompañantes…).
        t.notify(t.guards(), {
          title: `Llegó ${pass.visitorName}`,
          body: `Placa ${plate} · visita de ${t.unitLabel(pass.unitId)}. Confírmala en caseta.`,
          kind: 'access',
          link: '/',
        });
        return addEvent(t, {
          deviceId: self.id,
          kind,
          value: plate,
          result: 'pass',
          unitId: pass.unitId,
          passId: pass.id,
          label: pass.visitorName,
        });
      }
      return addEvent(t, { deviceId: self.id, kind, value: plate, result: 'unknown', unitId: null, label: 'Placa sin registro' });
    },
  },
  ackGateCommand: {
    roles: DEVICE,
    run(t, { user: device }, { id, ok, error = '' }) {
      const c = t.must('gateCommands', id, 'La orden');
      if (c.deviceId !== device.id) throw forbidden();
      if (c.status !== 'pending') return;
      t.patch('gateCommands', id, { status: ok ? 'done' : 'failed', ackAt: nowIso(), error: ok ? '' : error.slice(0, 200) });
      if (!ok)
        t.notify(t.guards(), {
          title: 'La pluma no respondió',
          body: `${device.name}: ${error || 'sin detalle'}`,
          kind: 'alert',
          link: '/',
        });
    },
  },
  // El servidor lo registra al conectarse y desconectarse el agente (no en cada latido).
  deviceStatus: {
    roles: DEVICE,
    run(t, { user: device }, { connected }) {
      t.patch('devices', device.id, connected ? { connectedAt: nowIso(), disconnectedAt: null } : { disconnectedAt: nowIso() });
    },
  },

  /**
   * Paquete para validar pases sin internet en la tablet de caseta (24 h). No lleva los códigos QR,
   * sólo su huella (`hash`): la tablet compara la huella de lo que escanea.
   */
  offlinePack: {
    roles: GUARD,
    run(t, { hash }) {
      const now = Date.now();
      const until = now + 24 * 3600e3;
      const passes = t.next.passes
        .filter((p) => p.status === 'active' && new Date(p.validTo).getTime() > now && new Date(p.validFrom).getTime() < until)
        .filter((p) => evaluatePass(p, new Date(Math.max(now, new Date(p.validFrom).getTime()))).ok)
        .map((p) => ({
          id: p.id,
          tokenHash: hash.fn(p.token),
          code: p.code,
          visitorName: p.visitorName,
          type: p.type,
          unitId: p.unitId,
          residentId: p.residentId,
          mode: p.mode,
          maxUses: p.maxUses,
          uses: p.uses.map((u) => ({ at: u.at })),
          validFrom: p.validFrom,
          validTo: p.validTo,
          days: p.days,
          timeFrom: p.timeFrom,
          timeTo: p.timeTo,
          expectedPlate: p.expectedPlate,
          status: p.status,
          notes: p.notes,
        }));
      return { alg: hash.alg, generatedAt: new Date(now).toISOString(), validUntil: new Date(until).toISOString(), passes };
    },
  },
};
