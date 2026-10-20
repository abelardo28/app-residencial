// Suscripción de cada residencial con la empresa: estados de los cargos, referencia de pago,
// recordatorios y cobro automático. Lo usan la API, el modo demo y las pantallas.
import { uid } from './format.js';

/** Días antes del vencimiento en que se recuerda el pago (si no hay cobro automático). */
export const REMINDER_DAYS_BEFORE = 3;
/** Comprobantes de transferencia: imágenes o PDF de hasta 3 MB. */
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const RECEIPT_MAX_BYTES = 3 * 1024 * 1024;

const day = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const daysUntil = (date, now = new Date()) => Math.round((new Date(`${date}T12:00:00Z`) - new Date(`${day(now)}T12:00:00Z`)) / 864e5);

/** Comprobante enviado que la empresa aún no revisa. */
export const inReview = (inv) => inv.status === 'pending' && !!inv.review && !inv.review.rejectedAt;

/** paid · review (comprobante por revisar) · overdue · pending · void */
export function invoiceState(inv, now = new Date()) {
  if (inv.status !== 'pending') return inv.status;
  if (inReview(inv)) return 'review';
  return inv.dueDate < day(now) ? 'overdue' : 'pending';
}

/** Se puede pagar desde la app: pendiente y sin comprobante en revisión. */
export const payable = (inv) => inv.status === 'pending' && !inReview(inv);

/** Referencia para identificar la transferencia de un cargo, p. ej. SUS-T1-202610. */
export const subscriptionReference = (inv) =>
  `SUS-${String(inv.tenantId).replace(/^t_/, '').slice(-6).toUpperCase()}-${inv.period.replace('-', '')}`;

/** El cobro automático se intenta una vez al día por cargo pendiente. */
export const dueForAutopay = (inv, billing, now = new Date()) =>
  payable(inv) && !!billing?.autopay && !!billing.card && (!inv.autopayAttemptAt || day(inv.autopayAttemptAt) < day(now));

/** Recordatorio único unos días antes del vencimiento, sólo si no se cobra solo. */
export function dueForReminder(inv, billing, now = new Date()) {
  if (!payable(inv) || inv.remindedAt || billing?.autopay) return false;
  const left = daysUntil(inv.dueDate, now);
  return left >= 0 && left <= REMINDER_DAYS_BEFORE;
}

/** Suspendido por adeudo y ya sin cargos vencidos: se reactiva solo al pagar. */
export const reactivatesAfterPayment = (residencia, invoices, now = new Date()) =>
  residencia?.status === 'suspended' &&
  /adeudo/i.test(residencia.statusReason || '') &&
  !invoices.some((i) => i.tenantId === residencia.id && invoiceState(i, now) === 'overdue');

/** Valida un comprobante enviado como data URL. Devuelve el mensaje de error o null. */
export function receiptError(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,/.exec(dataUrl || '');
  if (!m) return 'Adjunta el comprobante de la transferencia.';
  if (!RECEIPT_TYPES.includes(m[1])) return 'El comprobante debe ser una imagen o un PDF.';
  if (((dataUrl.length - m[0].length) * 3) / 4 > RECEIPT_MAX_BYTES) return 'El comprobante pesa más de 3 MB.';
  return null;
}

const message = (channel, to, subject, body, meta) => ({
  id: uid('msg_'),
  channel,
  to,
  subject,
  body,
  meta,
  at: new Date().toISOString(),
});

/**
 * Correos y WhatsApp de la suscripción. `link` abre la pantalla de pago (Configuración).
 * El recordatorio por WhatsApp inicia la conversación, así que en producción usa la plantilla `subscription`
 * con las variables [nombre, residencial, monto, vencimiento].
 */
export function subscriptionMessages(kind, { admin, staff, org, amount, period, due, reason, card, link }) {
  const hi = admin ? `Hola ${admin.name}:\n\n` : '';
  switch (kind) {
    case 'due':
      return [
        message(
          'email',
          admin.email,
          `Tu suscripción vence el ${due} · ${org}`,
          `${hi}La suscripción de ${org} de ${period} por ${amount} vence el ${due}. Puedes pagarla con tarjeta o transferencia desde la app:\n\n${link}\n\nSi activas el cobro automático, la tarjeta se cobrará sola cada mes.`,
          { kind: 'subscription' },
        ),
        message(
          'whatsapp',
          admin.phone,
          null,
          `${org}: la suscripción de ${period} por ${amount} vence el ${due}. Págala desde la app en Configuración: ${link}`,
          { kind: 'subscription', template: 'subscription', params: [admin.name, org, amount, due] },
        ),
      ];
    case 'paid':
      return [
        message(
          'email',
          admin.email,
          `Pago recibido · ${org}`,
          `${hi}Recibimos el pago de la suscripción de ${org} de ${period} por ${amount}${card ? ` con la tarjeta terminación ${card}` : ''}. Gracias.`,
          { kind: 'subscription' },
        ),
      ];
    case 'card-failed':
      return [
        message(
          'email',
          admin.email,
          `No pudimos cobrar tu tarjeta · ${org}`,
          `${hi}El cobro automático de la suscripción de ${org} de ${period} por ${amount} fue rechazado por la tarjeta terminación ${card}. Lo intentaremos de nuevo mañana. También puedes pagar con otra tarjeta o por transferencia:\n\n${link}`,
          { kind: 'subscription' },
        ),
      ];
    case 'rejected':
      return [
        message(
          'email',
          admin.email,
          `Revisa tu comprobante · ${org}`,
          `${hi}No pudimos validar el comprobante de la suscripción de ${period}${reason ? `: ${reason}` : ''}. Envía otro o paga con tarjeta desde la app:\n\n${link}`,
          { kind: 'subscription' },
        ),
      ];
    case 'receipt':
      return [
        message(
          'email',
          staff.email,
          `Comprobante por revisar · ${org}`,
          `${org} envió el comprobante de la suscripción de ${period} por ${amount}. Revísalo en el portal, en Cobranza.`,
          { kind: 'subscription' },
        ),
      ];
    default:
      return [];
  }
}
