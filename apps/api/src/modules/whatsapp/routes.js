// /api/v1/webhooks/whatsapp — webhook de la WhatsApp Cloud API (Meta).
import { incomingMessages } from './service.js';

export default async function whatsappWebhookRoutes(app, { whatsappService }) {
  // Meta verifica la URL una vez con un GET y el token que se configuró al registrar el webhook.
  app.get('/', async (req, reply) => {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && whatsappService.verifyToken(q['hub.verify_token'])) {
      return reply.type('text/plain').send(String(q['hub.challenge'] ?? ''));
    }
    return reply.code(403).send({ error: { code: 'forbidden', message: 'Token de verificación inválido.' } });
  });

  // Los mensajes llegan firmados; se necesita el cuerpo sin procesar para validar la firma.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.post('/', async (req, reply) => {
    if (!whatsappService.verifySignature(req.body, req.headers['x-hub-signature-256']))
      return reply.code(401).send({ error: { code: 'invalid_signature', message: 'Firma inválida.' } });
    let payload;
    try {
      payload = JSON.parse(req.body);
    } catch {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Aviso inválido.' } });
    }
    // Meta reintenta si no respondemos 200 rápido: cada mensaje se atiende por separado y un error no detiene a los demás.
    for (const m of incomingMessages(payload)) {
      try {
        whatsappService.handleIncoming(m);
      } catch (err) {
        req.log.error({ err }, 'No se pudo atender un mensaje de WhatsApp');
      }
    }
    return { received: true };
  });
}
