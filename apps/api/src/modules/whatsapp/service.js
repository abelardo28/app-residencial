// Asistente de WhatsApp: recibe los mensajes del webhook de Meta, identifica a la persona por su teléfono y
// responde con las reglas compartidas (@residencial/shared/whatsapp.js). Las respuestas salen por la bandeja
// de salida, igual que el resto de los mensajes.
import { BOT_STATE_MINUTES, DomainError, botTurn, normalizePhone } from '@residencial/shared';
import { createHmac } from 'node:crypto';
import { hmac, safeEqual } from '../../lib/crypto.js';

const NOT_REGISTERED =
  'Hola. Este número no está registrado en ningún residencial. Pide a tu administración que te dé de alta con este teléfono.';
const SUSPENDED = 'El servicio de tu residencial está suspendido por el momento. Contacta a tu administración.';
const ONLY_TEXT = 'Por ahora sólo entiendo mensajes de texto. Escribe *menú* para ver las opciones.';

export function createWhatsappService({ repos, config, tenantService, dispatch, log }) {
  const { accounts, tenants, platform, whatsapp } = repos;
  const base = config.APP_URL.replace(/\/$/, '');
  const links = {
    app: (path) => `${base}/#${path}`,
    pass: (p) => `${base}/#/qr?t=${encodeURIComponent(p.token)}&n=${encodeURIComponent(p.visitorName)}`,
  };

  function answer(phone, text) {
    if (text == null) return [ONLY_TEXT];
    const acc = accounts.findActiveByPhone(phone);
    if (!acc) return [NOT_REGISTERED];
    if (tenants.find(acc.tenantId)?.status !== 'active') return [SUSPENDED];
    const session = whatsapp.session(phone);
    const fresh = session && session.userId === acc.id && Date.now() - new Date(session.updatedAt).getTime() < BOT_STATE_MINUTES * 60e3;
    try {
      const out = tenantService.withTenant(
        acc.tenantId,
        tenantService.userOf(acc),
        ({ t, exec, user }) => botTurn({ tenant: t.next, user, text, state: fresh ? session.state : null, exec, links }),
        'whatsapp',
      );
      whatsapp.saveSession(phone, { tenantId: acc.tenantId, userId: acc.id, state: out.state });
      return out.replies;
    } catch (err) {
      whatsapp.saveSession(phone, { tenantId: acc.tenantId, userId: acc.id, state: null });
      if (err instanceof DomainError) return [err.message];
      log.error({ err }, 'Error en el asistente de WhatsApp');
      return ['Tuvimos un problema para atenderte. Inténtalo de nuevo en unos minutos.'];
    }
  }

  return {
    /** Atiende un mensaje. Con `deliver: false` (simulador de desarrollo) sólo devuelve las respuestas. */
    handleIncoming({ from, text, messageId }, { deliver = true } = {}) {
      const phone = normalizePhone(from);
      if (messageId && !whatsapp.markInbound(messageId)) return { duplicate: true, replies: [] };
      const replies = answer(phone, text);
      if (deliver) {
        platform.enqueue(replies.map((body) => ({ channel: 'whatsapp', to: phone, body, meta: { kind: 'bot', freeform: true } })));
        dispatch();
      }
      return { replies };
    },

    /** Firma `X-Hub-Signature-256` de Meta: HMAC-SHA256 del cuerpo con la clave secreta de la app. */
    verifySignature(rawBody, header = '') {
      if (!config.WHATSAPP_APP_SECRET) return !config.isProd; // en desarrollo se acepta sin firma
      const expected = `sha256=${createHmac('sha256', config.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
      return safeEqual(expected, header);
    },

    verifyToken: (token) => !!config.WHATSAPP_VERIFY_TOKEN && safeEqual(hmac('wa', token || ''), hmac('wa', config.WHATSAPP_VERIFY_TOKEN)),
  };
}

/** Extrae los mensajes de un aviso de la WhatsApp Cloud API (ignora confirmaciones de entrega y lectura). */
export function incomingMessages(payload) {
  const out = [];
  for (const entry of payload?.entry || [])
    for (const change of entry.changes || [])
      for (const m of change.value?.messages || []) {
        const text =
          m.type === 'text'
            ? m.text?.body
            : m.type === 'interactive'
              ? m.interactive?.button_reply?.title || m.interactive?.list_reply?.title
              : m.type === 'button'
                ? m.button?.text
                : null;
        out.push({ from: m.from, messageId: m.id, text: typeof text === 'string' ? text.slice(0, 1000) : null });
      }
  return out;
}
