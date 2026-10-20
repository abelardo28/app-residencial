// Estado de cuenta de cada casa: cuotas, recargos, adeudo, referencia de pago y restricciones por adeudo.
import { lastMonths, monthKey } from './format.js';

export const LEDGER_MONTHS = 4;

/** Valores por defecto de cobranza (los residenciales creados antes no los tienen guardados). */
export const BILLING_DEFAULTS = {
  lateFee: 0, // recargo fijo por mes vencido
  lateFeeGraceDays: 0, // días de tolerancia después del día límite antes de cobrar recargo
  restrictions: { enabled: false, minMonths: 2, reservations: true, recurrentPasses: true },
};
export const billingSettings = (settings = {}) => ({
  lateFee: settings.lateFee ?? BILLING_DEFAULTS.lateFee,
  lateFeeGraceDays: settings.lateFeeGraceDays ?? BILLING_DEFAULTS.lateFeeGraceDays,
  restrictions: { ...BILLING_DEFAULTS.restrictions, ...(settings.restrictions || {}) },
});

const dayOf = (m, today) => (m < monthKey(today) ? Infinity : m === monthKey(today) ? today.getDate() : -Infinity);

/**
 * Estado de cada uno de los últimos meses para una casa.
 * Cada fila: { month, state: paid|review|overdue|due, payment, fee, lateFee, amount, waived }
 */
export function ledger(tenant, unitId, today = new Date()) {
  const { dueDay, monthlyFee } = tenant.settings;
  const { lateFee, lateFeeGraceDays } = billingSettings(tenant.settings);
  const unit = tenant.units?.find((u) => u.id === unitId);
  const waivedList = unit?.waivedLateFees || [];
  return lastMonths(LEDGER_MONTHS, today).map((m) => {
    const ps = tenant.payments.filter((p) => p.unitId === unitId && p.period === m);
    const approved = ps.find((p) => p.status === 'approved');
    const pending = ps.find((p) => p.status === 'pending');
    const rejected = ps.find((p) => p.status === 'rejected');
    const day = dayOf(m, today);
    const overdue = day > dueDay;
    const state = approved ? 'paid' : pending ? 'review' : overdue ? 'overdue' : 'due';
    const waived = waivedList.includes(m);
    const charge = state === 'overdue' && lateFee > 0 && day > dueDay + lateFeeGraceDays && !waived ? lateFee : 0;
    const paidPayment = approved || pending;
    const fee = paidPayment ? paidPayment.amount - (paidPayment.lateFee || 0) : monthlyFee;
    const late = paidPayment ? paidPayment.lateFee || 0 : charge;
    return { month: m, state, payment: approved || pending || rejected, fee, lateFee: late, amount: fee + late, waived };
  });
}

/** Meses que la casa puede pagar ahora (vencidos o por pagar), del más antiguo al más reciente. */
export const payableRows = (tenant, unitId, today) =>
  ledger(tenant, unitId, today).filter((r) => r.state === 'overdue' || r.state === 'due');
export const payableMonths = (tenant, unitId, today) => payableRows(tenant, unitId, today).map((r) => r.month);

/** Importe a pagar por los meses indicados (cuota + recargo). Lanza si algún mes no se puede pagar. */
export function amountDue(tenant, unitId, periods, today) {
  const rows = new Map(payableRows(tenant, unitId, today).map((r) => [r.month, r]));
  return periods.reduce((sum, p) => {
    const r = rows.get(p);
    if (!r) throw new Error(`El mes ${p} no se puede pagar.`);
    return sum + r.amount;
  }, 0);
}

/** Adeudo vencido de una casa. */
export function debtOf(tenant, unitId, today) {
  const overdue = ledger(tenant, unitId, today).filter((r) => r.state === 'overdue');
  return { months: overdue.length, amount: overdue.reduce((s, r) => s + r.amount, 0), rows: overdue };
}

/**
 * ¿La casa tiene restringido algún servicio por adeudo? Devuelve el motivo o null.
 * `what`: 'reservations' | 'recurrentPasses'
 */
export function debtRestriction(tenant, unitId, what, today) {
  const { restrictions } = billingSettings(tenant.settings);
  if (!restrictions.enabled || !restrictions[what]) return null;
  const debt = debtOf(tenant, unitId, today);
  if (debt.months < restrictions.minMonths) return null;
  const servicio = what === 'reservations' ? 'reservar áreas comunes' : 'crear pases recurrentes o de varias entradas';
  return `Tu casa tiene ${debt.months} meses vencidos. Por reglamento, para ${servicio} necesitas ponerte al corriente.`;
}

/**
 * Referencia numérica de pago de una casa (7 dígitos): "1" + número de casa (5) + dígito verificador.
 * El residente la escribe en el campo "Referencia" de su transferencia SPEI y la conciliación la reconoce.
 */
export function unitReference(tenant, unitId) {
  const index = tenant.units.findIndex((u) => u.id === unitId);
  if (index < 0) return '';
  const base = '1' + String(index + 1).padStart(5, '0');
  return base + checkDigit(base);
}

/** Dígito verificador (módulo 10 con pesos 3-7-1, como las referencias bancarias). */
export function checkDigit(digits) {
  const weights = [3, 7, 1];
  const sum = [...digits].reverse().reduce((s, d, i) => s + Number(d) * weights[i % 3], 0);
  return String((10 - (sum % 10)) % 10);
}

export const validReference = (ref = '') => /^\d{7}$/.test(ref) && checkDigit(ref.slice(0, 6)) === ref[6];

/** Busca la casa a la que pertenece una referencia. */
export function unitByReference(tenant, ref) {
  if (!validReference(ref)) return null;
  const index = Number(ref.slice(1, 6)) - 1;
  return tenant.units[index] || null;
}
