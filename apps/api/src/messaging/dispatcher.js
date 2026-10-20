// Despachador de la bandeja de salida: toma los mensajes en cola y los envía con el proveedor configurado.
// - console: no envía nada; los mensajes quedan visibles en el buzón de desarrollo (/api/v1/dev/outbox).
// - live: correo con Resend y WhatsApp con la WhatsApp Business Cloud API (plantillas y respuestas del asistente).

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
  const to = m.to.replace('+', '');
  const lang = { code: config.WHATSAPP_TEMPLATE_LANG };
  let message;
  if (m.meta?.code) {
    // Los códigos usan una plantilla de la categoría "Autenticación".
    message = {
      type: 'template',
      template: {
        name: config.WHATSAPP_AUTH_TEMPLATE,
        language: lang,
        components: [
          { type: 'body', parameters: [{ type: 'text', text: m.meta.code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.meta.code }] },
        ],
      },
    };
  } else if (m.meta?.freeform) {
    // Respuesta del asistente: la persona acaba de escribir, así que estamos dentro de la ventana de 24 h.
    message = { type: 'text', text: { body: m.body, preview_url: true } };
  } else if (m.meta?.template) {
    // Avisos y recordatorios inician la conversación: Meta exige una plantilla aprobada.
    const name = { notice: config.WHATSAPP_NOTICE_TEMPLATE, reminder: config.WHATSAPP_REMINDER_TEMPLATE }[m.meta.template];
    if (!name) throw new Error(`Plantilla de WhatsApp desconocida: ${m.meta.template}`);
    const parameters = (m.meta.params || []).map((text) => ({ type: 'text', text: String(text).slice(0, 1000) }));
    message = { type: 'template', template: { name, language: lang, components: [{ type: 'body', parameters }] } };
  } else {
    throw new Error('Mensaje de WhatsApp sin plantilla.');
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...message }),
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
