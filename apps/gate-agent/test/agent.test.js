import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { parseEvents } from '../src/sse.js';
import { plateFrom } from '../src/lpr.js';
import { isFresh, startAgent } from '../src/agent.js';
import { loadConfig } from '../src/config.js';

const quiet = { info() {}, warn() {}, error() {} };

describe('agente de caseta', () => {
  test('lee eventos SSE aunque lleguen en pedazos', () => {
    const a = parseEvents('event: ready\ndata: {"a":1}\n\n: ping\n\nevent: command\nda');
    assert.deepEqual(a.events, [{ event: 'ready', data: '{"a":1}' }]);
    const b = parseEvents(a.rest + 'ta: {"id":"gc_1"}\n\n');
    assert.deepEqual(b.events, [{ event: 'command', data: '{"id":"gc_1"}' }]);
  });

  test('reconoce la placa en los avisos de las cámaras', () => {
    assert.equal(plateFrom('{"plate":"pxr-482-a"}', 'application/json'), 'PXR482A');
    assert.equal(
      plateFrom('<EventNotificationAlert><ANPR><licensePlate>ABC123D</licensePlate></ANPR></EventNotificationAlert>', 'application/xml'),
      'ABC123D',
    );
    assert.equal(plateFrom('Events[0].PlateNumber=XYZ987A', 'text/plain'), 'XYZ987A');
  });

  test('una orden vieja nunca abre la pluma', () => {
    const now = Date.now();
    assert.equal(isFresh({ createdAt: new Date(now - 3000).toISOString(), ttlSeconds: 20 }, now), true);
    assert.equal(isFresh({ createdAt: new Date(now - 60_000).toISOString(), ttlSeconds: 20 }, now), false);
  });

  test('valida la configuración', () => {
    assert.throws(() => loadConfig({ API_URL: 'x' }), /API_URL/);
    assert.throws(() => loadConfig({ API_URL: 'https://a.mx', BARRIER_TOKEN: 't', RELAY: 'shelly' }), /RELAY_URL/);
  });

  test('abre con la orden de la API, confirma y reenvía los tags', async () => {
    const acks = [];
    const reads = [];
    const relayHits = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/relay/0?turn=on&timer=1') {
          relayHits.push(req.url);
          return res.end('{}');
        }
        if (req.url === '/api/v1/devices/stream') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `event: command\ndata: ${JSON.stringify({ id: 'gc_1', reason: 'Prueba', createdAt: new Date().toISOString(), ttlSeconds: 20 })}\n\n`,
          );
          res.write(
            `event: command\ndata: ${JSON.stringify({ id: 'gc_old', reason: 'Vieja', createdAt: '2020-01-01T00:00:00Z', ttlSeconds: 20 })}\n\n`,
          );
          return;
        }
        if (req.url.startsWith('/api/v1/devices/commands/'))
          acks.push({ url: req.url, body: JSON.parse(body), auth: req.headers.authorization });
        if (req.url === '/api/v1/devices/events') reads.push(JSON.parse(body));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ result: { label: 'Casa 3', result: 'opened' } }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const input = new PassThrough();
    const stop = startAgent(
      loadConfig({ API_URL: base, BARRIER_TOKEN: 'RD1.b', RELAY: 'shelly', RELAY_URL: base, READER_TOKEN: 'RD1.r', CAMERA_TOKEN: '' }),
      { log: quiet, input },
    );
    input.write('A1B2C3D4\n');
    for (let i = 0; i < 50 && (!acks.length || !reads.length); i++) await new Promise((r) => setTimeout(r, 40));
    stop();
    server.closeAllConnections();
    server.close();
    assert.equal(relayHits.length, 1); // la orden vieja no abrió
    assert.deepEqual(
      acks.map((a) => [a.url, a.body.ok, a.auth]),
      [['/api/v1/devices/commands/gc_1/ack', true, 'Bearer RD1.b']],
    );
    assert.deepEqual(reads, [{ kind: 'tag', value: 'A1B2C3D4' }]);
  });
});
