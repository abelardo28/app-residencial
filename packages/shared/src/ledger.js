import { lastMonths, monthKey } from './format.js';

export const LEDGER_MONTHS = 4;

/** Estado de cada uno de los últimos meses de cuota para una casa. */
export function ledger(tenant, unitId, today = new Date()) {
  return lastMonths(LEDGER_MONTHS, today).map((m) => {
    const ps = tenant.payments.filter((p) => p.unitId === unitId && p.period === m);
    const approved = ps.find((p) => p.status === 'approved');
    const pending = ps.find((p) => p.status === 'pending');
    const rejected = ps.find((p) => p.status === 'rejected');
    const overdue = m < monthKey(today) || (m === monthKey(today) && today.getDate() > tenant.settings.dueDay);
    const state = approved ? 'paid' : pending ? 'review' : overdue ? 'overdue' : 'due';
    return { month: m, state, payment: approved || pending || rejected };
  });
}

/** Meses que la casa puede pagar ahora (vencidos o por pagar). */
export const payableMonths = (tenant, unitId, today) =>
  ledger(tenant, unitId, today).filter((r) => r.state === 'overdue' || r.state === 'due').map((r) => r.month);
