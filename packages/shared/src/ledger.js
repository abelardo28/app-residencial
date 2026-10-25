// Estado de cuenta de cada casa: cuotas, recargos, adeudo, referencia de pago y restricciones por adeudo.
import { lastMonths, monthKey, monthLabel } from './format.js';

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

/** Conceptos de cobro además de la cuota: un cargo único (p. ej. impermeabilización) o uno mensual (p. ej. cuota extraordinaria). */
export const CHARGE_KINDS = { once: 'Cobro único', monthly: 'Cada mes' };

/** Clave de cobro de un concepto: el id (único) o id@AAAA-MM (mensual). La cuota usa el mes (AAAA-MM). */
export const chargeKey = (charge, month) => (charge.kind === 'monthly' ? `${charge.id}@${month}` : charge.id);
export const chargeApplies = (charge, unitId) => !charge.unitIds?.length || charge.unitIds.includes(unitId);

/** Cómo se nombra un pago: el mes de la cuota o el concepto. */
export const periodLabel = (p) => (p.chargeId ? p.concept : monthLabel(p.period));
/** Mes al que corresponde un pago (para los totales por mes). */
export const paymentMonth = (p) => p.month || p.period;

const isoDay = (d) => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
const paymentsFor = (tenant, unitId, key) => {
  const ps = tenant.payments.filter((p) => p.unitId === unitId && p.period === key);
  return {
    approved: ps.find((p) => p.status === 'approved'),
    pending: ps.find((p) => p.status === 'pending'),
    rejected: ps.find((p) => p.status === 'rejected'),
  };
};

/** Filas de los conceptos que aplican a una casa. Los únicos se muestran mientras se deban o en la ventana del estado de cuenta. */
function chargeRows(tenant, unitId, months, today) {
  const { dueDay } = tenant.settings;
  const todayIso = isoDay(today);
  const rows = [];
  for (const c of tenant.settings.charges || []) {
    if (!chargeApplies(c, unitId)) continue;
    const slots =
      c.kind === 'monthly'
        ? months
            .filter((m) => m >= c.from && (!c.to || m <= c.to))
            .map((m) => ({ month: m, due: `${m}-${String(dueDay).padStart(2, '0')}` }))
        : [{ month: c.dueDate.slice(0, 7), due: c.dueDate }];
    for (const { month, due } of slots) {
      const key = chargeKey(c, month);
      const { approved, pending, rejected } = paymentsFor(tenant, unitId, key);
      if (c.archived && !approved && !pending) continue; // concepto eliminado: sólo queda lo ya pagado
      if (approved && month < months[0]) continue;
      const state = approved ? 'paid' : pending ? 'review' : todayIso > due ? 'overdue' : 'due';
      const paid = approved || pending;
      const amount = paid ? paid.amount : c.amount;
      rows.push({
        key,
        month,
        chargeId: c.id,
        label: c.kind === 'monthly' ? `${c.name} · ${monthLabel(month)}` : c.name,
        due,
        state,
        payment: approved || pending || rejected,
        fee: amount,
        lateFee: 0,
        amount,
        waived: false,
      });
    }
  }
  return rows;
}

/**
 * Estado de cuenta de una casa: la cuota de los últimos meses más los conceptos que le aplican, del más antiguo al más reciente.
 * Cada fila: { key, month, label, chargeId?, state: paid|review|overdue|due, payment, fee, lateFee, amount, waived }
 * `key` es lo que se paga (la API y las pantallas lo llaman «periodo»).
 */
export function ledger(tenant, unitId, today = new Date()) {
  const { dueDay, monthlyFee } = tenant.settings;
  const { lateFee, lateFeeGraceDays } = billingSettings(tenant.settings);
  const unit = tenant.units?.find((u) => u.id === unitId);
  const waivedList = unit?.waivedLateFees || [];
  const months = lastMonths(LEDGER_MONTHS, today);
  const fees = months.map((m) => {
    const { approved, pending, rejected } = paymentsFor(tenant, unitId, m);
    const day = dayOf(m, today);
    const overdue = day > dueDay;
    const state = approved ? 'paid' : pending ? 'review' : overdue ? 'overdue' : 'due';
    const waived = waivedList.includes(m);
    const charge = state === 'overdue' && lateFee > 0 && day > dueDay + lateFeeGraceDays && !waived ? lateFee : 0;
    const paidPayment = approved || pending;
    const fee = paidPayment ? paidPayment.amount - (paidPayment.lateFee || 0) : monthlyFee;
    const late = paidPayment ? paidPayment.lateFee || 0 : charge;
    return {
      key: m,
      month: m,
      label: monthLabel(m),
      state,
      payment: approved || pending || rejected,
      fee,
      lateFee: late,
      amount: fee + late,
      waived,
    };
  });
  return [...fees, ...chargeRows(tenant, unitId, months, today)].sort(
    (a, b) => a.month.localeCompare(b.month) || Number(!!a.chargeId) - Number(!!b.chargeId),
  );
}

/** Lo que la casa puede pagar ahora (vencido o por pagar), del más antiguo al más reciente. */
export const payableRows = (tenant, unitId, today) =>
  ledger(tenant, unitId, today).filter((r) => r.state === 'overdue' || r.state === 'due');
export const payableMonths = (tenant, unitId, today) => payableRows(tenant, unitId, today).map((r) => r.key);

/** Importe a pagar por los periodos indicados (cuota + recargo o concepto). Lanza si alguno no se puede pagar. */
export function amountDue(tenant, unitId, periods, today) {
  const rows = new Map(payableRows(tenant, unitId, today).map((r) => [r.key, r]));
  return periods.reduce((sum, p) => {
    const r = rows.get(p);
    if (!r) throw new Error(`El periodo ${p} no se puede pagar.`);
    return sum + r.amount;
  }, 0);
}

/** Adeudo vencido de una casa. `months` cuenta sólo cuotas vencidas (lo que usan las restricciones); `rows` incluye conceptos. */
export function debtOf(tenant, unitId, today) {
  const overdue = ledger(tenant, unitId, today).filter((r) => r.state === 'overdue');
  return { months: overdue.filter((r) => !r.chargeId).length, amount: overdue.reduce((s, r) => s + r.amount, 0), rows: overdue };
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
