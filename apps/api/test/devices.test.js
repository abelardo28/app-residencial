import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestApp } from './helpers.js';

/** Lee eventos SSE de una respuesta de fetch hasta que `until` devuelva true. */
async function readEvents(res, until, ms = 3000) {
  const reader = res.body.getReader();
  const events = [];
  let buf = '';
  const timer = setTimeout(() => reader.cancel(), ms);
  try {
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = block.match(/^event: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (event) events.push({ event, data: JSON.parse(data) });
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { events, reader };
}

describe('caseta física', () => {
  let t, admin, guard, base, token;
  before(async () => {
    t = await createTestApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${t.app.server.address().port}/api/v1`;
    [admin, guard] = [t.client(), t.client()];
    await admin.login('admin@residencial.mx');
    await guard.login('caseta@residencial.mx');
    const res = await admin.post('/tenant/gate/devices', { name: 'Pluma de prueba', kind: 'barrier', lane: 'salida' });
    assert.equal(res.status, 200);
    token = res.body.result.token;
  });
  after(() => t.close());

  const device = (path, body, tk = token) =>
    t.app.inject({
      method: body ? 'POST' : 'GET',
      url: `/api/v1/devices${path}`,
      payload: body,
      headers: { authorization: `Bearer ${tk}` },
    });

  test('un token alterado no entra', async () => {
    assert.equal((await device('/events', { kind: 'tag', value: 'X' }, token.slice(0, -1) + 'x')).statusCode, 401);
  });

  test('la pluma recibe la orden de abrir en tiempo real y la confirma', async () => {
    const stream = await fetch(`${base}/devices/stream`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(stream.status, 200);
    const pending = readEvents(stream, (ev) => ev.some((e) => e.event === 'command'));
    await new Promise((r) => setTimeout(r, 100));
    const deviceId = (await admin.get('/me/snapshot')).body.root.tenants.t1.devices.find((d) => d.name === 'Pluma de prueba').id;
    const open = await guard.post('/tenant/gate/open', { deviceId, reason: 'Proveedor' });
    assert.equal(open.status, 200);
    const { events, reader } = await pending;
    await reader.cancel();
    const command = events.find((e) => e.event === 'command').data;
    assert.equal(command.reason, 'Proveedor');
    assert.equal((await device(`/commands/${command.id}/ack`, { ok: true })).statusCode, 200);
    const db = (await admin.get('/me/snapshot')).body.root.tenants.t1;
    assert.equal(db.gateCommands.find((c) => c.id === command.id).status, 'done');
    assert.ok(db.devices.find((d) => d.id === deviceId).connectedAt);
  });

  test('un lector de tags abre la pluma de residentes', async () => {
    const reader = await admin.post('/tenant/gate/devices', { name: 'Lector 2', kind: 'reader', lane: 'residentes', barrierId: 'dv_pl2' });
    const res = await device('/events', { kind: 'tag', value: 'A1B2C3D4' }, reader.body.result.token);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().result.result, 'opened');
  });

  test('renovar el token desconecta al equipo anterior', async () => {
    const deviceId = (await admin.get('/me/snapshot')).body.root.tenants.t1.devices.find((d) => d.name === 'Pluma de prueba').id;
    const rotated = await admin.post(`/tenant/gate/devices/${deviceId}/token`);
    assert.equal((await device('/events', { kind: 'tag', value: 'X' })).statusCode, 401);
    assert.equal((await device('/events', { kind: 'tag', value: 'XXXX' }, rotated.body.result.token)).statusCode, 200);
  });

  test('sólo administración da de alta equipos y la vigilancia no ve los tags', async () => {
    assert.equal((await guard.post('/tenant/gate/devices', { name: 'X', kind: 'barrier', lane: 'entrada' })).status, 403);
    const view = (await guard.get('/me/snapshot')).body.root.tenants.t1;
    assert.deepEqual(view.tags, []);
    assert.ok(view.devices.every((d) => d.version === undefined));
  });

  test('el paquete sin conexión trae huellas, no los códigos QR', async () => {
    const res = await guard.post('/tenant/access/offline-pack');
    assert.equal(res.status, 200);
    const pack = res.body.result;
    assert.equal(pack.alg, 'sha256');
    const passes = t.repos.tenants.listRecords('t1', 'passes');
    const one = pack.passes[0];
    const full = passes.find((p) => p.id === one.id);
    assert.equal(one.tokenHash, createHash('sha256').update(full.token).digest('hex'));
    assert.equal(one.token, undefined);
    assert.equal((await admin.post('/tenant/access/offline-pack')).status, 403);
  });

  test('los registros sin conexión se sincronizan con su hora', async () => {
    const pack = (await guard.post('/tenant/access/offline-pack')).body.result;
    const at = new Date(Date.now() - 5 * 60e3).toISOString();
    const res = await guard.post('/tenant/access/entries', { passId: pack.passes[0].id, offlineAt: at });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.at, at);
    assert.equal(res.body.result.offline, true);
  });
});
