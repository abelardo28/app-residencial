// Textos de correo y WhatsApp. El enlace de activación va por correo y el código por WhatsApp:
// para activar una cuenta se necesitan los dos canales.
import { uid } from '@residencial/shared';

const msg = (channel, to, subject, body, meta = {}) => ({ id: uid('msg_'), channel, to, subject, body, meta, at: new Date().toISOString() });

export function createTemplates(appUrl) {
  const link = (token, email) => `${appUrl.replace(/\/$/, '')}/#/activar?t=${token}&e=${encodeURIComponent(email)}`;
  return {
    invite({ user, org, token, code, purpose }) {
      const reset = purpose === 'reset';
      const url = link(token, user.email);
      return [
        msg('email', user.email, reset ? `Restablece tu contraseña · ${org}` : `Activa tu cuenta · ${org}`,
          `Hola ${user.name}:\n\n${reset ? 'Tu administrador solicitó restablecer tu contraseña.' : `Se creó tu cuenta en ${org}.`} Para ${reset ? 'crear una nueva contraseña' : 'activarla'} abre este enlace:\n\n${url}\n\nTambién te enviamos un código de 6 dígitos por WhatsApp; lo necesitarás en el siguiente paso. El enlace vence en 48 horas y sólo se puede usar una vez.\n\nSi no esperabas este mensaje, ignóralo. Nunca te pediremos tu contraseña.`,
          { kind: 'invite', token, email: user.email, link: url }),
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
    activated: ({ user, org }) => [msg('email', user.email, `Tu cuenta está activa · ${org}`, `Hola ${user.name}, tu contraseña quedó configurada. Si no fuiste tú, contacta a tu administrador de inmediato.`, { kind: 'activated' })],
    locked: ({ user }) => [msg('email', user.email, 'Bloqueamos temporalmente tu cuenta', 'Detectamos varios intentos fallidos de inicio de sesión. Tu cuenta se bloqueó 15 minutos. Si no fuiste tú, avisa a tu administrador.', { kind: 'locked' })],
    invoiceReminder: ({ admin, org, amount, period }) => [msg('email', admin.email, `Recordatorio de pago · ${org}`, `Hola ${admin.name}, la suscripción de ${org} correspondiente a ${period} por ${amount} está pendiente.`, { kind: 'invoice' })],
    serviceStatus: ({ admin, org, active, reason }) => [
      msg('email', admin.email, active ? `Servicio reactivado · ${org}` : `Servicio suspendido · ${org}`,
        active ? 'El acceso a la app fue reactivado para todos los usuarios.' : `El acceso a la app fue suspendido.${reason ? ` Motivo: ${reason}.` : ''} Contacta a la empresa para regularizarlo.`, { kind: 'status' }),
    ],
  };
}
