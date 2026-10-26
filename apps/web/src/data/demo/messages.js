// Mensajes del modo demo: se guardan en el buzón de prueba visible desde el inicio de sesión.
// Con la API, el servidor los envía por correo (Resend) y WhatsApp (Cloud API); ver apps/api/src/messaging.
import { uid } from '@residencial/shared';

export function appLink(path) {
  try {
    const base = window.location.href.split('#')[0];
    return /^https?:/.test(base) ? `${base}#${path}` : `https://tu-dominio.mx/#${path}`;
  } catch {
    return `https://tu-dominio.mx/#${path}`;
  }
}

const msg = (channel, to, subject, body, meta = {}) => ({
  id: uid('msg_'),
  channel,
  to,
  subject,
  body,
  meta,
  at: new Date().toISOString(),
});

export const templates = {
  invite({ user, org, token, code, purpose }) {
    const reset = purpose === 'reset';
    const link = appLink(`/activar?t=${token}&e=${encodeURIComponent(user.email)}`);
    return [
      msg(
        'email',
        user.email,
        reset ? `Restablece tu contraseña · ${org}` : `Activa tu cuenta · ${org}`,
        `Hola ${user.name}:\n\n${reset ? 'Tu administrador solicitó restablecer tu contraseña.' : `Se creó tu cuenta en ${org}.`} Para ${reset ? 'crear una nueva contraseña' : 'activarla'} abre este enlace:\n\n${link}\n\nTambién te enviamos un código de 6 dígitos por WhatsApp; lo necesitarás en el siguiente paso. El enlace vence en 48 horas y sólo se puede usar una vez.\n\nSi no esperabas este mensaje, ignóralo. Nunca te pediremos tu contraseña.`,
        { kind: 'invite', token, email: user.email, link },
      ),
      msg(
        'whatsapp',
        user.phone,
        null,
        `${org}: tu código de ${reset ? 'restablecimiento' : 'activación'} es ${code}. Vence en 48 h. No lo compartas con nadie, ni con el personal del residencial.`,
        { kind: 'invite-code', code },
      ),
    ];
  },
  mfa({ user, code }) {
    return [
      msg(
        'whatsapp',
        user.phone,
        null,
        `Tu código para iniciar sesión es ${code}. Vence en 5 minutos. Si no fuiste tú, cambia tu contraseña.`,
        { kind: 'mfa', code },
      ),
      msg(
        'email',
        user.email,
        'Código de inicio de sesión',
        `Tu código para iniciar sesión es ${code}. Vence en 5 minutos.\n\nSi no intentaste entrar, avisa a tu administrador.`,
        { kind: 'mfa', code },
      ),
    ];
  },
  passwordChanged({ user, org }) {
    return [
      msg(
        'email',
        user.email,
        `Cambiaste tu contraseña · ${org}`,
        `Hola ${user.name}, la contraseña de tu cuenta se cambió y cerramos tus sesiones en otros dispositivos. Si no fuiste tú, contacta a tu administrador de inmediato.`,
        { kind: 'password-changed' },
      ),
    ];
  },
  activated({ user, org }) {
    return [
      msg(
        'email',
        user.email,
        `Tu cuenta está activa · ${org}`,
        `Hola ${user.name}, tu contraseña quedó configurada. Si no fuiste tú, contacta a tu administrador de inmediato.`,
        { kind: 'activated' },
      ),
    ];
  },
  locked({ user }) {
    return [
      msg(
        'email',
        user.email,
        'Bloqueamos temporalmente tu cuenta',
        `Detectamos varios intentos fallidos de inicio de sesión. Tu cuenta se bloqueó 15 minutos. Si no fuiste tú, avisa a tu administrador.`,
        { kind: 'locked' },
      ),
    ];
  },
  serviceStatus({ admin, org, active, reason }) {
    return [
      msg(
        'email',
        admin.email,
        active ? `Servicio reactivado · ${org}` : `Servicio suspendido · ${org}`,
        active
          ? 'El acceso a la app fue reactivado para todos los usuarios.'
          : `El acceso a la app fue suspendido.${reason ? ` Motivo: ${reason}.` : ''} Contacta a la empresa para regularizarlo.`,
        { kind: 'status' },
      ),
    ];
  },
  invoiceReminder({ admin, org, amount, period }) {
    return [
      msg(
        'email',
        admin.email,
        `Recordatorio de pago · ${org}`,
        `Hola ${admin.name}, la suscripción de ${org} correspondiente a ${period} por ${amount} está pendiente.`,
        { kind: 'invoice' },
      ),
    ];
  },
};
