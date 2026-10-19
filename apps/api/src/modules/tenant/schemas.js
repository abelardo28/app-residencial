// Validación de entrada de cada operación del residencial.
// `z.object` descarta cualquier campo no declarado: el cliente no puede colar `status`, `residentId`, etc.
import { z } from 'zod';
import { OPERATIONS, PASS_MODES, PASS_TYPES } from '@residencial/shared';

const MB = 1024 * 1024;
const id = z.string().min(1).max(64);
const text = (max = 500) => z.string().trim().max(max);
const requiredText = (max = 200) => z.string().trim().min(1).max(max);
const isoDate = z.iso.datetime({ offset: true });
const day = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periodo AAAA-MM');
const money = z.number().nonnegative().max(10_000_000);
/** Imagen o archivo como data URL (las fotos se comprimen en la APP antes de subirlas). */
const dataUrl = (maxMb) =>
  z
    .string()
    .max(Math.ceil(maxMb * MB * 1.37))
    .regex(/^data:[\w.+-]+\/[\w.+-]+(;[\w=-]+)*(;base64)?,/, 'Archivo inválido');
/** Foto tomada en caseta (data URL ya comprimida). */
const photo = dataUrl(2).or(z.literal('')).nullish();
const attachment = z.object({
  id,
  name: requiredText(200),
  type: text(100),
  size: z.number().int().nonnegative().optional(),
  dataUrl: dataUrl(3),
});

const byId = z.object({ id });
const empty = z.object({});

export const OPERATION_SCHEMAS = {
  markRead: byId,
  markAllRead: empty,

  createPass: z.object({
    visitorName: requiredText(120),
    type: z.enum(Object.keys(PASS_TYPES)),
    mode: z.enum(PASS_MODES),
    validFrom: isoDate,
    validTo: isoDate,
    maxUses: z.number().int().min(1).max(100),
    days: z.array(z.number().int().min(0).max(6)).max(7),
    timeFrom: hhmm,
    timeTo: hhmm,
    expectedPlate: text(12).optional(),
    notes: text(300).optional(),
  }),
  revokePass: byId,

  checkCode: z.object({ text: requiredText(600) }),
  registerEntry: z.object({
    passId: id.nullish(),
    visitorName: text(120).optional(),
    type: text(40).optional(),
    unitId: id.optional(),
    plate: text(12).optional(),
    photo,
    notes: text(300).optional(),
    companions: z.number().int().min(0).max(50).optional(),
  }),
  registerExit: byId,
  generalAccess: z.object({ provider: requiredText(80), plate: text(12).optional(), photo, notes: text(300).optional() }),

  submitPayment: z.object({
    periods: z.array(period).min(1).max(24),
    method: z.enum(['transfer', 'cash']), // los pagos con Ecart Pay sólo los registra el servidor
    receipt: attachment.nullish(),
    reference: text(80).optional(),
    notes: text(300).optional(),
  }),
  reviewPayment: z.object({ id, status: z.enum(['approved', 'rejected']), note: text(300).optional() }),
  registerCashPayment: z.object({ residentId: id, periods: z.array(period).min(1).max(24), reference: text(80).optional() }),
  sendReminder: z.object({ residentIds: z.array(id).min(1).max(2000) }),

  createNotice: z.object({
    title: requiredText(140),
    category: z.enum(['general', 'reunion', 'documento', 'bitacora', 'mantenimiento', 'urgente']),
    body: requiredText(5000),
    eventDate: isoDate.nullish(),
    location: text(140).optional(),
    audience: z.enum(['residents', 'staff', 'all']),
    requireConfirm: z.boolean().optional(),
    attachments: z.array(attachment).max(3).optional(),
  }),
  deleteNotice: byId,
  markNoticeRead: byId,
  confirmNotice: z.object({ id, answer: z.enum(['si', 'no']) }),

  createReservation: z.object({
    amenityId: id,
    date: day,
    from: hhmm,
    to: hhmm,
    guests: z.number().int().min(1).max(1000),
    notes: text(300).optional(),
  }),
  cancelReservation: byId,

  createIncident: z.object({
    title: requiredText(140),
    category: requiredText(60),
    description: text(2000).optional(),
    photo: attachment.nullish(),
  }),
  updateIncident: z.object({ id, status: z.enum(['abierta', 'en_proceso', 'resuelta']).optional(), comment: text(1000).optional() }),

  registerPackage: z.object({ unitId: id, carrier: requiredText(60), description: text(200).optional() }),
  deliverPackage: z.object({
    id,
    code: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Código de 4 dígitos'),
  }),

  createPoll: z.object({
    question: requiredText(300),
    closesAt: isoDate,
    options: z
      .array(z.object({ text: requiredText(120) }))
      .min(2)
      .max(10),
  }),
  vote: z.object({ id, optionId: id }),

  addExpense: z.object({ concept: requiredText(140), category: requiredText(60), amount: money, date: day }),

  triggerSos: z.object({ kind: requiredText(40).optional() }),
  attendSos: byId,

  updateUser: z.object({
    id,
    name: requiredText(120).optional(),
    unitId: id.optional(),
    vehicles: z.array(text(12)).max(10).optional(),
    shift: text(40).optional(),
  }),
  updateSettings: z.object({
    name: requiredText(120).optional(),
    monthlyFee: money.optional(),
    dueDay: z.number().int().min(1).max(28).optional(),
    lateFee: money.optional(),
    bank: z.object({ name: text(80), clabe: text(40), holder: text(120) }).optional(),
    amenities: z
      .array(
        z.object({ id, name: requiredText(80), capacity: z.number().int().min(1), open: hhmm, close: hhmm, deposit: money.optional() }),
      )
      .max(30)
      .optional(),
    generalProviders: z.array(requiredText(60)).max(30).optional(),
    // data URL = foto propia · '' = foto de ejemplo · null = sin portada
    cover: dataUrl(3).or(z.literal('')).nullable().optional(),
  }),
};

// Si se agrega una operación sin esquema, la API no arranca.
const missing = Object.keys(OPERATIONS).filter((name) => !OPERATION_SCHEMAS[name]);
if (missing.length) throw new Error(`Faltan esquemas de validación para: ${missing.join(', ')}`);
