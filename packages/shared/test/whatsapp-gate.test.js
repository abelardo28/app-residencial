import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createTx, runOperation } from '../src/index.js';
import { botTurn, normalizePhone } from '../src/whatsapp.js';
import { deviceToken, pendingCommands, verifyDeviceToken } from '../src/gate.js';
import { unitReference } from '../src/ledger.js';
import { seedTenant } from '../src/demo/seed.js';

const sign = (payload) => createHmac('sha256', 'test').update(payload).digest('base64url').slice(0, 16);
const hash = { alg: 'sha256', fn: (s) => createHash('sha256').update(s).digest('hex') };
const tenant = () => seedTenant({ sign });
const ctxFor = (db, userId) => ({ user: db.users.find((u) => u.id === userId), sign, hash, tenantId: 't1', trusted: {} });
const run = (db, userId, name, input) => {
  const t = createTx({ ...db });
  const result = runOperation(name, t, ctxFor(db, userId), input);
  return { result, next: t.next, side: t.side };
};
const asDevice = (db, deviceId, name, input) => {
  const t = createTx({ ...db });
  const device = db.devices.find((d) => d.id === deviceId);
  const result = runOperation(name, t, { user: { ...device, role: 'device' }, sign, hash, tenantId: 't1' }, input);
  return { result, next: t.next };
};

/** Conversación de prueba: cada mensaje se ejecuta como lo haría la API (operaciones en una transacción). */
function chat(db, userId) {
  let data = db;
  let state = null;
  return {
    send(text) {
      const t = createTx({ ...data });
      const user = t.next.users.find((u) => u.id === userId);
      const out = botTurn({
        tenant: t.next,
        user,
        text,
        state,
        exec: (name, input) => runOperation(name, t, ctxFor(t.next, userId), input),
        links: { app: (p) => `https://app.mx/#${p}`, pass: (p) => `https://app.mx/#/qr?t=${p.token}` },
      });
      data = t.next;
      state = out.state;
      return out.replies.join('\n');
    },
    get data() {
      return data;
    },
  };
}

describe('asistente de WhatsApp', () => {
  test('normaliza los teléfonos de México como los manda Meta', () => {
    assert.equal(normalizePhone('5215520000003'), '+525520000003');
    assert.equal(normalizePhone('+52 55 2000 0003'), '+525520000003');
    assert.equal(normalizePhone('5520000003'), '+525520000003');
  });

  test('crea un pase en dos pasos y lo devuelve con su enlace', () => {
    const c = chat(tenant(), 'res1');
    assert.match(c.send('Hola'), /1\* Pase para una visita/);
    assert.match(c.send('1'), /Cómo se llama/);
    assert.match(c.send('Pedro Páramo'), /Para cuándo/);
    const done = c.send('2');
    assert.match(done, /Pase para \*Pedro Páramo\*, mañana/);
    const pass = c.data.passes.find((p) => p.visitorName === 'Pedro Páramo');
    assert.ok(pass);
    assert.equal(pass.residentId, 'res1');
    assert.ok(done.includes(pass.code) && done.includes(pass.token));
    assert.ok(new Date(pass.validFrom) > new Date());
  });

  test('entiende "pase Nombre" en un solo mensaje', () => {
    const c = chat(tenant(), 'res1');
    assert.match(c.send('pase para Juan Rulfo'), /Pase para \*Juan Rulfo\*, hoy/);
  });

  test('muestra el saldo con la referencia de pago', () => {
    const db = tenant();
    const text = chat(db, 'res1').send('2');
    assert.ok(text.includes(unitReference(db, 'u3')));
    assert.match(text, /recargo/);
  });

  test('BAJA y ALTA controlan los avisos por WhatsApp', () => {
    const c = chat(tenant(), 'res1');
    c.send('BAJA');
    const after = run(c.data, 'adm1', 'createNotice', {
      title: 'Corte de agua',
      category: 'general',
      body: 'Mañana de 9 a 12.',
      audience: 'residents',
    });
    const phones = after.side.outbox.map((m) => m.to);
    assert.ok(!phones.includes('+525520000003'));
    assert.ok(phones.includes('+525520000005'));
    assert.equal(after.side.outbox[0].meta.template, 'notice');
    c.send('alta');
    assert.equal(c.data.whatsappOptOuts.length, 0);
  });

  test('el recordatorio de pago llega por WhatsApp con la referencia', () => {
    const db = tenant();
    const { side } = run(db, 'adm1', 'sendReminder', { residentIds: ['res3'] });
    assert.equal(side.outbox.length, 1);
    assert.ok(side.outbox[0].body.includes(unitReference(db, 'u7')));
  });

  test('sin WhatsApp activado no se envía nada', () => {
    const db = tenant();
    db.settings = { ...db.settings, whatsapp: { enabled: false } };
    assert.equal(run(db, 'adm1', 'sendReminder', { residentIds: ['res3'] }).side.outbox.length, 0);
  });

  test('administración recibe un resumen y vigilancia el enlace a la app', () => {
    assert.match(chat(tenant(), 'adm1').send('hola'), /Comprobantes por revisar/);
    assert.match(chat(tenant(), 'grd1').send('hola'), /app de vigilancia/);
  });
});

describe('caseta física', () => {
  test('el token del equipo se verifica y se invalida al renovarlo', () => {
    const db = tenant();
    const { result } = run(db, 'adm1', 'createDevice', { name: 'Pluma 2', kind: 'barrier', lane: 'salida' });
    assert.deepEqual(verifyDeviceToken(result.token, sign), { tenantId: 't1', deviceId: result.device.id, version: 1 });
    assert.equal(verifyDeviceToken(result.token.slice(0, -1) + 'x', sign), null);
    const rotated = run(db, 'adm1', 'rotateDeviceToken', { id: 'dv_pl1' });
    assert.equal(verifyDeviceToken(rotated.result.token, sign).version, 2);
    assert.notEqual(rotated.result.token, deviceToken('t1', db.devices[0], sign));
  });

  test('un tag activo abre la pluma de su carril; uno bloqueado avisa a caseta', () => {
    const db = tenant();
    const ok = asDevice(db, 'dv_rf1', 'gateEvent', { kind: 'tag', value: 'a1b2-c3d4' });
    assert.equal(ok.result.result, 'opened');
    assert.equal(pendingCommands(ok.next.gateCommands, 'dv_pl2').length, 1);
    const blocked = asDevice(db, 'dv_rf1', 'gateEvent', { kind: 'tag', value: 'FF00AA11' });
    assert.equal(blocked.result.result, 'denied');
    assert.equal(blocked.next.gateCommands.length, 0);
    assert.ok(blocked.next.notifications.some((n) => n.userId === 'grd1' && n.title.startsWith('Tag bloqueado')));
  });

  test('la placa de un residente abre; la de una visita con pase avisa al vigilante', () => {
    const db = tenant();
    assert.equal(asDevice(db, 'dv_cam1', 'gateEvent', { kind: 'plate', value: 'PXR-482-A' }).result.result, 'opened');
    const pass = run(db, 'res1', 'createPass', {
      visitorName: 'Visita con auto',
      type: 'amigo',
      mode: 'single',
      validFrom: new Date(Date.now() - 60e3).toISOString(),
      validTo: new Date(Date.now() + 3600e3).toISOString(),
      maxUses: 1,
      days: [],
      timeFrom: '00:00',
      timeTo: '23:59',
      expectedPlate: 'ZZZ999',
    });
    const seen = asDevice(pass.next, 'dv_cam1', 'gateEvent', { kind: 'plate', value: 'ZZZ999' });
    assert.equal(seen.result.result, 'pass');
    assert.equal(seen.next.gateCommands.length, 0); // la visita la confirma el vigilante
    assert.ok(seen.next.notifications.some((n) => n.userId === 'grd1' && n.title === 'Llegó Visita con auto'));
  });

  test('registrar una visita con pase abre la pluma de entrada', () => {
    const db = tenant();
    const pass = db.passes.find(
      (p) => p.status === 'active' && p.mode === 'single' && !p.uses.length && new Date(p.validFrom) < new Date(),
    );
    const { next } = run(db, 'grd1', 'registerEntry', { passId: pass.id });
    assert.equal(next.gateCommands[0].deviceId, 'dv_pl1');
    assert.equal(asDevice(next, 'dv_pl1', 'ackGateCommand', { id: next.gateCommands[0].id, ok: true }).next.gateCommands[0].status, 'done');
  });

  test('un residente abre la pluma sólo si el residencial lo permite', () => {
    const db = tenant();
    assert.equal(run(db, 'res1', 'openGate', {}).result.deviceId, 'dv_pl2');
    db.settings = { ...db.settings, gate: { ...db.settings.gate, residentOpen: false } };
    assert.throws(
      () => run(db, 'res1', 'openGate', {}),
      (e) => e.status === 403,
    );
  });

  test('sin internet: la tablet valida con la huella y al sincronizar se marcan los conflictos', () => {
    const db = tenant();
    const pack = run(db, 'grd1', 'offlinePack', {}).result;
    const pass = db.passes.find((p) => pack.passes.some((x) => x.id === p.id) && p.mode === 'single');
    const entry = pack.passes.find((x) => x.id === pass.id);
    assert.equal(entry.tokenHash, hash.fn(pass.token));
    assert.equal(entry.token, undefined);

    const at = new Date(Date.now() - 10 * 60e3).toISOString();
    const first = run(db, 'grd1', 'registerEntry', { passId: pass.id, offlineAt: at });
    assert.equal(first.result.at, at);
    assert.equal(first.result.offline, true);
    assert.equal(first.next.gateCommands.length, 0); // la pluma ya se abrió en caseta
    // La segunda vez el pase de una entrada ya no es válido, pero la visita ya entró: se registra y se avisa.
    const second = run(first.next, 'grd1', 'registerEntry', { passId: pass.id, offlineAt: at });
    assert.match(second.result.offlineConflict, /ya fue utilizado/);
    assert.ok(second.next.notifications.some((n) => n.userId === 'adm1' && n.title === 'Revisa un acceso sin conexión'));
    assert.throws(() => run(db, 'grd1', 'registerEntry', { passId: pass.id, offlineAt: '2020-01-01T00:00:00Z' }));
  });
});
