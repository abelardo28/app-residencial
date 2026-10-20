// /api/v1/devices — conexión del agente de la caseta (apps/gate-agent).
// El agente se autentica con el token del equipo (`Authorization: Bearer RD1.…`) y:
//   GET  /stream               recibe las órdenes "abrir pluma" en tiempo real (Server-Sent Events)
//   POST /events               envía lecturas de tags y placas
//   POST /commands/:id/ack     confirma si la pluma abrió
import { z } from 'zod';
import { COMMAND_TTL_SECONDS, pendingCommands, verifyDeviceToken } from '@residencial/shared';
import { passSigner } from '../../lib/crypto.js';
import { unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { OPERATION_SCHEMAS } from '../tenant/schemas.js';

const HEARTBEAT_MS = 25_000;
const AckBody = OPERATION_SCHEMAS.ackGateCommand.omit({ id: true });
const Params = z.object({ id: z.string().min(1).max(64) });

export default async function deviceRoutes(app, { repos, config, events, tenantService }) {
  const sign = passSigner(config.ACCESS_SECRET);

  /** Equipo vigente para el token, o null (token alterado, renovado, equipo desactivado o residencial suspendido). */
  function resolveDevice(header = '') {
    const parsed = verifyDeviceToken(header.replace(/^Bearer\s+/i, ''), sign);
    if (!parsed) return null;
    if (repos.tenants.find(parsed.tenantId)?.status !== 'active') return null;
    const device = repos.tenants.listRecords(parsed.tenantId, 'devices').find((d) => d.id === parsed.deviceId);
    if (!device || device.status !== 'active' || device.version !== parsed.version) return null;
    return { ...device, tenantId: parsed.tenantId };
  }

  app.addHook('preHandler', async (req) => {
    req.device = resolveDevice(req.headers.authorization);
    if (!req.device) throw unauthorized('Token de equipo inválido o revocado.', 'invalid_device');
  });

  app.get('/stream', (req, reply) => {
    const device = req.device;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const sent = new Set();
    const flush = () => {
      for (const c of pendingCommands(repos.tenants.listRecords(device.tenantId, 'gateCommands'), device.id)) {
        if (sent.has(c.id)) continue;
        sent.add(c.id);
        send('command', { id: c.id, action: c.action, reason: c.reason, createdAt: c.createdAt, ttlSeconds: COMMAND_TTL_SECONDS });
      }
    };

    tenantService.executeAsDevice(device, 'deviceStatus', { connected: true });
    send('ready', { device: { id: device.id, name: device.name, kind: device.kind, lane: device.lane } });
    flush();
    const unsubscribe = events.subscribe(device.tenantId, flush);
    const heartbeat = setInterval(() => {
      if (!resolveDevice(req.headers.authorization)) {
        send('revoked', { message: 'El token de este equipo se revocó.' });
        return res.end();
      }
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      try {
        tenantService.executeAsDevice(device, 'deviceStatus', { connected: false });
      } catch {
        /* el equipo pudo eliminarse mientras estaba conectado */
      }
    });
  });

  app.post('/events', async (req) => ({
    result: tenantService.executeAsDevice(req.device, 'gateEvent', parse(OPERATION_SCHEMAS.gateEvent, req.body)),
  }));

  app.post('/commands/:id/ack', async (req) => {
    const { id } = parse(Params, req.params);
    tenantService.executeAsDevice(req.device, 'ackGateCommand', { id, ...parse(AckBody, req.body || {}) });
    return { ok: true };
  });
}
