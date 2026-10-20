// /api/v1/events — avisos en tiempo real (Server-Sent Events).
// Sólo anuncia "algo cambió"; la APP vuelve a pedir su vista. Así nunca se filtran datos de otro rol.
import { SESSION_COOKIE } from '../../plugins/auth.js';

const HEARTBEAT_MS = 25_000;

export default async function eventsRoutes(app, { events, authService }) {
  app.get('/', { preHandler: app.authenticate, config: { allowSuspended: true } }, (req, reply) => {
    const acc = req.account;
    const token = req.cookies[SESSION_COOKIE];
    const channel = acc.scope === 'platform' ? 'platform' : acc.tenantId;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: no almacenar en búfer
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('ready', { channel });

    const unsubscribe = events.subscribe(channel, (payload) => send('change', { at: payload.at }));
    const heartbeat = setInterval(() => {
      try {
        authService.resolveSession(token, { touch: false });
        res.write(': ping\n\n');
      } catch (err) {
        send('session-ended', { message: err.message });
        res.end();
      }
    }, HEARTBEAT_MS);

    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.on('close', close);
  });
}
