// Despachador de la bandeja de salida: toma los mensajes en cola y los envía con el proveedor configurado.
// - console: no envía nada; los mensajes quedan visibles en el buzón de desarrollo (/api/v1/dev/outbox).
// - live: correo con Resend y WhatsApp con la WhatsApp Business Cloud API (plantilla de autenticación).

export function createProviders(config, log) {
  if (config.MESSAGING_PROVIDER === 'console') {
    return {
      redactAfterSend: false,
      async send(m) {
        log.info({ channel: m.channel, to: m.to, subject: m.subject }, 'Mensaje en buzón de desarrollo');
      },
    };
  }
  return {
    redactAfterSend: true, // el cuerpo lleva enlaces y códigos: no se conserva después de enviarlo
    async send(m) {
      if (m.channel === 'email') return sendEmail(config, m);
      return sendWhatsApp(config, m);
    },
  };
}

async function sendEmail(config, m) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.body }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function sendWhatsApp(config, m) {
  // Meta exige plantillas aprobadas. Los códigos usan una plantilla de la categoría "Autenticación".
  const code = m.meta?.code;
  if (!code) throw new Error('Los mensajes de WhatsApp sin código requieren una plantilla propia.');
  const res = await fetch(`https://graph.facebook.com/v21.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: m.to.replace('+', ''),
      type: 'template',
      template: {
        name: config.WHATSAPP_AUTH_TEMPLATE,
        language: { code: config.WHATSAPP_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
}

/** Envía lo pendiente. Se llama después de cada cambio y periódicamente para reintentar. */
export function createDispatcher({ repos, providers, log }) {
  let running = false;
  return async function dispatch() {
    if (running) return;
    running = true;
    try {
      for (const m of repos.platform.queued()) {
        try {
          await providers.send(m);
          repos.platform.markSent(m.id, { redact: providers.redactAfterSend });
        } catch (err) {
          log.warn({ err, id: m.id }, 'No se pudo enviar un mensaje; se reintentará');
          repos.platform.markFailed(m.id, err.message);
        }
      }
    } finally {
      running = false;
    }
  };
}
