import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTestApp } from './helpers.js';

const SECRET = 'secreto-de-la-app';
const sign = (body) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
const payload = (from, text, id) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [{ from, id, type: 'text', text: { body: text } }] } }] }],
  });

describe('asistente de WhatsApp', () => {
  let t;
  before(async () => {
    t = await createTestApp({ WHATSAPP_VERIFY_TOKEN: 'verifica-123', WHATSAPP_APP_SECRET: SECRET });
  });
  after(() => t.close());

  const post = (body, signature = sign(body)) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/whatsapp',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    });
  const repliesTo = (phone) =>
    t.repos.platform
      .recentMessages(200)
      .filter((m) => m.to === phone && m.meta.kind === 'bot')
      .map((m) => m.body);

  test('Meta verifica el webhook con el token configurado', async () => {
    const ok = await t.app.inject({ url: '/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verifica-123&hub.challenge=42' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body, '42');
    const bad = await t.app.inject({ url: '/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=42' });
    assert.equal(bad.statusCode, 403);
  });

  test('rechaza mensajes sin la firma de Meta', async () => {
    const body = payload('5215520000003', 'hola', 'wamid.x0');
    assert.equal((await post(body, 'sha256=falsa')).statusCode, 401);
    assert.equal(repliesTo('+525520000003').length, 0);
  });

  test('responde al residente por su teléfono y no repite un mensaje reenviado', async () => {
    const body = payload('5215520000003', 'Hola', 'wamid.1');
    assert.equal((await post(body)).statusCode, 200);
    assert.equal((await post(body)).statusCode, 200);
    const replies = repliesTo('+525520000003');
    assert.equal(replies.length, 1);
    assert.match(replies[0], /Hola, Ana/);
  });

  test('crea un pase desde WhatsApp con las mismas reglas que la APP', async () => {
    await post(payload('5215520000003', 'pase Rosa Castellanos', 'wamid.2'));
    const pass = t.repos.tenants.listRecords('t1', 'passes').find((p) => p.visitorName === 'Rosa Castellanos');
    assert.ok(pass);
    assert.equal(pass.residentId, 'res1');
    assert.ok(repliesTo('+525520000003')[0].includes(pass.code));
  });

  test('un número desconocido recibe instrucciones', async () => {
    await post(payload('5215599999999', 'hola', 'wamid.3'));
    assert.match(repliesTo('+525599999999')[0], /no está registrado/);
  });

  test('los avisos llegan por WhatsApp con su plantilla', async () => {
    const admin = t.client();
    await admin.login('admin@residencial.mx');
    await admin.post('/tenant/notices', { title: 'Fumigación', category: 'general', body: 'El jueves a las 10.', audience: 'residents' });
    const wa = t.repos.platform.recentMessages(200).filter((m) => m.meta.template === 'notice');
    assert.ok(wa.length >= 3);
    assert.deepEqual(wa[0].meta.params.slice(1, 2), ['Fumigación']);
  });
});
