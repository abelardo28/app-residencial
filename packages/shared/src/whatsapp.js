// Asistente de WhatsApp: los residentes generan pases, consultan su saldo y leen avisos sin instalar la APP.
// Es una conversación por menús con números (funciona igual en cualquier teléfono). La API la usa con
// WhatsApp Cloud API y el modo demo con el simulador; las acciones pasan por las mismas operaciones que la APP.
import { fmtDate, fmtTime, money } from './format.js';
import { debtOf, payableRows, unitReference } from './ledger.js';

/** Minutos que se recuerda una conversación a medias (p. ej. "¿cómo se llama tu visita?"). */
export const BOT_STATE_MINUTES = 30;

/**
 * Teléfono en formato E.164 de México. Meta envía `5215512345678` (con el 1 de celular) y aquí
 * guardamos `+525512345678`, así se comparan bien.
 */
export function normalizePhone(raw = '') {
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 10) d = `52${d}`;
  if (d.length === 13 && d.startsWith('521')) d = `52${d.slice(3)}`;
  return d ? `+${d}` : '';
}

const clean = (s = '') =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const firstName = (name = '') => name.split(' ')[0];
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 0);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);

const MENU_WORDS = ['hola', 'menu', 'inicio', 'ayuda', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', '0', 'cancelar', 'salir'];

/** Personas del residencial que dieron de baja los avisos por WhatsApp. */
export const whatsappOptedOut = (tenant, userId) => (tenant.whatsappOptOuts || []).some((o) => o.id === userId);

/**
 * Responde un mensaje. No guarda nada por sí mismo: devuelve las respuestas y el nuevo estado de la conversación.
 * @param {object} p
 * @param {object} p.tenant  datos del residencial (se leen después de ejecutar, así ven los cambios)
 * @param {object} p.user    quien escribe (encontrado por su teléfono)
 * @param {string} p.text    mensaje recibido
 * @param {object} [p.state] estado anterior de la conversación
 * @param {(name: string, input: object) => any} p.exec  ejecuta una operación como `user`
 * @param {{ app: (path: string) => string, pass: (pass: object) => string }} p.links
 * @returns {{ replies: string[], state: object | null }}
 */
export function botTurn({ tenant, user, text, state = null, now = new Date(), exec, links }) {
  const msg = clean(text);
  const org = tenant.settings.name;
  const reply = (replies, next = null) => ({ replies: [].concat(replies), state: next });

  if (['baja', 'stop', 'no quiero avisos'].includes(msg)) {
    exec('setWhatsappAlerts', { enabled: false });
    return reply(
      'Listo, ya no te enviaremos avisos por WhatsApp. Puedes seguir usando este chat. Escribe *ALTA* para volver a recibirlos.',
    );
  }
  if (msg === 'alta') {
    exec('setWhatsappAlerts', { enabled: true });
    return reply('Listo, volverás a recibir los avisos del residencial por WhatsApp.');
  }

  if (user.role === 'guard') {
    return reply(`Hola, ${firstName(user.name)}. La caseta se opera desde la app de vigilancia: ${links.app('/')}`);
  }
  if (user.role === 'admin') return reply(adminSummary(tenant, links));

  // ---------- Residentes ----------
  if (MENU_WORDS.includes(msg) || !msg) return reply(menu(org, user));

  // Pase en curso: primero el nombre de la visita, después el día.
  if (state?.step === 'pass.name') {
    if (msg.length < 3) return reply('Escribe el nombre completo de tu visita.', state);
    return reply(askWhen(text.trim()), { step: 'pass.when', name: text.trim().slice(0, 120) });
  }
  if (state?.step === 'pass.when') {
    const when = { 1: 'today', hoy: 'today', 2: 'tomorrow', manana: 'tomorrow' }[msg];
    if (!when) return reply('Responde *1* para hoy o *2* para mañana.', state);
    return reply(createPass({ tenant, name: state.name, when, now, exec, links }));
  }

  const named = text.trim().match(/^(?:nuevo\s+)?pase(?:\s+para)?\s+(.{3,})$/i);
  if (named) return reply(createPass({ tenant, name: named[1], when: 'today', now, exec, links }));
  if (['1', 'pase', 'visita', 'nuevo pase'].includes(msg)) return reply('¿Cómo se llama tu visita?', { step: 'pass.name' });
  if (['2', 'saldo', 'pagar', 'pago', 'adeudo', 'referencia', 'estado de cuenta'].includes(msg)) return reply(balance(tenant, user, links));
  if (['3', 'avisos', 'aviso', 'noticias'].includes(msg)) return reply(notices(tenant, links));
  if (['4', 'visitas', 'accesos', 'entradas'].includes(msg)) return reply(visitsToday(tenant, user, now));
  return reply(['No entendí tu mensaje.', menu(org, user)]);
}

function menu(org, user) {
  return [
    `*${org}*`,
    `Hola, ${firstName(user.name)}. ¿Qué necesitas?`,
    '',
    '*1* Pase para una visita',
    '*2* Mi saldo y cómo pagar',
    '*3* Avisos recientes',
    '*4* Mis visitas de hoy',
    '',
    'Responde con el número. También puedes escribir, por ejemplo: *pase Juan Pérez*.',
  ].join('\n');
}

const askWhen = (name) => `¿Para cuándo es el pase de *${name}*?\n*1* Hoy\n*2* Mañana`;

function createPass({ tenant, name, when, now, exec, links }) {
  const from = when === 'today' ? now : startOfDay(new Date(now.getTime() + 86400e3));
  const to = endOfDay(from);
  const pass = exec('createPass', {
    visitorName: name.slice(0, 120),
    type: 'amigo',
    mode: 'single',
    validFrom: from.toISOString(),
    validTo: to.toISOString(),
    maxUses: 1,
    days: [],
    timeFrom: '00:00',
    timeTo: '23:59',
    notes: 'Creado por WhatsApp',
  });
  const day = when === 'today' ? 'hoy' : `mañana ${fmtDate(from)}`;
  return [
    `Listo. Pase para *${pass.visitorName}*, ${day}, válido hasta las ${fmtTime(to)}`,
    `Código: *${pass.code}*`,
    '',
    `Reenvía este enlace a tu visita; ahí verá su código QR para mostrarlo en caseta:\n${links.pass(pass)}`,
    '',
    `Te avisaremos cuando llegue a ${tenant.settings.name}.`,
  ].join('\n');
}

function balance(tenant, user, links) {
  const debt = debtOf(tenant, user.unitId);
  const owed = payableRows(tenant, user.unitId);
  const total = owed.reduce((s, r) => s + r.amount, 0);
  const { bank } = tenant.settings;
  if (!owed.length) return 'Estás al corriente. ¡Gracias por tu pago!';
  const lines = owed.map((r) => `• ${r.label}: ${money(r.amount)}${r.lateFee ? ` (incluye recargo de ${money(r.lateFee)})` : ''}`);
  return [
    `Tu saldo es de *${money(total)}*${debt.months ? `, con ${debt.months} mes(es) vencido(s)` : ''}.`,
    ...lines,
    '',
    '*Pago por transferencia SPEI*',
    `Banco: ${bank.name}`,
    `CLABE: ${bank.clabe}`,
    `Beneficiario: ${bank.holder}`,
    `Referencia numérica: *${unitReference(tenant, user.unitId)}*`,
    'Con tu referencia el pago se aplica solo, no necesitas mandar comprobante.',
    '',
    `Pago con tarjeta: ${links.app('/pagos')}`,
  ].join('\n');
}

function notices(tenant, links) {
  const list = tenant.notices
    .filter((n) => n.audience !== 'staff')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
  if (!list.length) return 'No hay avisos recientes.';
  return [
    '*Avisos recientes*',
    ...list.map((n) => `\n*${n.title}* · ${fmtDate(n.createdAt)}\n${n.body.slice(0, 160)}${n.body.length > 160 ? '…' : ''}`),
    '',
    `Ver todos: ${links.app('/avisos')}`,
  ].join('\n');
}

function visitsToday(tenant, user, now) {
  const logs = tenant.accessLogs.filter((a) => a.unitId === user.unitId && sameDay(new Date(a.at), now));
  if (!logs.length) return 'Hoy no ha llegado ninguna visita a tu casa.';
  return [
    '*Visitas de hoy*',
    ...logs.map((a) => `• ${fmtTime(a.at)} ${a.visitorName}${a.exitAt ? ` (salió ${fmtTime(a.exitAt)})` : ''}`),
  ].join('\n');
}

function adminSummary(tenant, links) {
  const pending = tenant.payments.filter((p) => p.status === 'pending').length;
  const residents = tenant.users.filter((u) => u.role === 'resident');
  const debt = residents.reduce((s, r) => s + debtOf(tenant, r.unitId).amount, 0);
  const incidents = tenant.incidents.filter((i) => i.status !== 'resuelta').length;
  const unmatched = (tenant.bankMovements || []).filter((m) => m.status === 'unmatched').length;
  return [
    `*Resumen de ${tenant.settings.name}*`,
    `• Comprobantes por revisar: ${pending}`,
    `• Depósitos por asignar: ${unmatched}`,
    `• Adeudo total: ${money(debt)}`,
    `• Reportes abiertos: ${incidents}`,
    '',
    `Abrir el panel: ${links.app('/')}`,
  ].join('\n');
}

/**
 * Mensajes de WhatsApp que inicia el residencial (avisos y recordatorios).
 * Meta sólo permite iniciar conversaciones con plantillas aprobadas: `template` es la clave de la plantilla
 * y `params` sus variables. `body` es el texto tal como lo verá la persona (para el buzón de prueba).
 */
export function whatsappMessages(tenant, users, { kind, body, params }) {
  const wa = tenant.settings.whatsapp;
  if (!wa?.enabled || wa[kind === 'notice' ? 'notices' : 'reminders'] === false) return [];
  return users
    .filter((u) => u.phone && !whatsappOptedOut(tenant, u.id))
    .map((u) => ({
      channel: 'whatsapp',
      to: u.phone,
      subject: null,
      body: typeof body === 'function' ? body(u) : body,
      meta: { kind, template: kind, params: typeof params === 'function' ? params(u) : params },
    }));
}
