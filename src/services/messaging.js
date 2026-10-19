// Envío de correos y mensajes de WhatsApp.
//
// Producción: el SERVIDOR envía los mensajes (nunca el navegador) con:
//   - Correo: un proveedor transaccional (Amazon SES, SendGrid, Resend…) con SPF/DKIM configurados.
//   - WhatsApp: WhatsApp Business Cloud API con plantillas aprobadas por Meta (categoría "Autenticación").
// En la demo los mensajes se guardan en un buzón de prueba visible desde la pantalla de inicio de sesión.
import { uid } from '../lib/utils';

export const MESSAGING_MODE = import.meta.env.VITE_API_URL ? 'live' : 'demo';

export function appLink(path) {
  try {
    const base = window.location.href.split('#')[0];
    return /^https?:/.test(base) ? `${base}#${path}` : `https://tu-dominio.mx/#${path}`;
  } catch {
    return `https://tu-dominio.mx/#${path}`;
  }
}

const msg = (channel, to, subject, body, meta = {}) => ({ id: uid('msg_'), channel, to, subject, body, meta, at: new Date().toISOString() });

export const templates = {
  invite({ user, org, token, code, purpose }) {
    const reset = purpose === 'reset';
    const link = appLink(`/activar?t=${token}&e=${encodeURIComponent(user.email)}`);
    return [
      msg('email', user.email, reset ? `Restablece tu contraseña · ${org}` : `Activa tu cuenta · ${org}`,
        `Hola ${user.name}:\n\n${reset ? 'Tu administrador solicitó restablecer tu contraseña.' : `Se creó tu cuenta en ${org}.`} Para ${reset ? 'crear una nueva contraseña' : 'activarla'} abre este enlace:\n\n${link}\n\nTambién te enviamos un código de 6 dígitos por WhatsApp; lo necesitarás en el siguiente paso. El enlace vence en 48 horas y sólo se puede usar una vez.\n\nSi no esperabas este mensaje, ignóralo. Nunca te pediremos tu contraseña.`,
        { kind: 'invite', token, email: user.email, link }),
      msg('whatsapp', user.phone, null,
        `${org}: tu código de ${reset ? 'restablecimiento' : 'activación'} es ${code}. Vence en 48 h. No lo compartas con nadie, ni con el personal del residencial.`,
        { kind: 'invite-code', code }),
    ];
  },
  mfa({ user, code }) {
    return [
      msg('whatsapp', user.phone, null, `Tu código para iniciar sesión es ${code}. Vence en 5 minutos. Si no fuiste tú, cambia tu contraseña.`, { kind: 'mfa', code }),
      msg('email', user.email, 'Código de inicio de sesión', `Tu código para iniciar sesión es ${code}. Vence en 5 minutos.\n\nSi no intentaste entrar, avisa a tu administrador.`, { kind: 'mfa', code }),
    ];
  },
  activated({ user, org }) {
    return [msg('email', user.email, `Tu cuenta está activa · ${org}`, `Hola ${user.name}, tu contraseña quedó configurada. Si no fuiste tú, contacta a tu administrador de inmediato.`, { kind: 'activated' })];
  },
  locked({ user }) {
    return [msg('email', user.email, 'Bloqueamos temporalmente tu cuenta', `Detectamos varios intentos fallidos de inicio de sesión. Tu cuenta se bloqueó 15 minutos. Si no fuiste tú, avisa a tu administrador.`, { kind: 'locked' })];
  },
  invoiceReminder({ admin, org, amount, period }) {
    return [msg('email', admin.email, `Recordatorio de pago · ${org}`, `Hola ${admin.name}, la suscripción de ${org} correspondiente a ${period} por ${amount} está pendiente.`, { kind: 'invoice' })];
  },
};

// Envío real a través del backend (se usa cuando VITE_API_URL está configurada).
export async function deliver(messages) {
  if (MESSAGING_MODE === 'demo') return;
  await fetch(`${import.meta.env.VITE_API_URL}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(messages.map(({ channel, to, subject, body }) => ({ channel, to, subject, body }))),
  });
}
