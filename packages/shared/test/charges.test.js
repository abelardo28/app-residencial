import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTx, runOperation, DomainError } from '../src/index.js';
import { amountDue, debtOf, ledger, payableMonths, periodLabel } from '../src/ledger.js';
import { seedTenant } from '../src/demo/seed.js';

const sign = (payload) => createHmac('sha256', 'test').update(payload).digest('base64url').slice(0, 16);
const run = (db, userId, name, input) => {
  const t = createTx({ ...db });
  const result = runOperation(name, t, { user: db.users.find((u) => u.id === userId), sign, trusted: {} }, input);
  return { result, next: t.next, side: t.side };
};

describe('conceptos de cobro en el estado de cuenta', () => {
  const base = (charges) => ({
    settings: { monthlyFee: 1000, dueDay: 10, charges },
    units: [
      { id: 'u1', label: 'Casa 1' },
      { id: 'u2', label: 'Casa 2' },
    ],
    payments: [],
  });
  const today = new Date(2026, 9, 20); // 20 de octubre

  test('un cobro único aparece junto a la cuota y vence en su fecha', () => {
    const db = base([{ id: 'ch1', name: 'Impermeabilización', amount: 2500, kind: 'once', dueDate: '2026-10-31', unitIds: [] }]);
    const row = ledger(db, 'u1', today).find((r) => r.chargeId);
    assert.deepEqual([row.key, row.label, row.state, row.amount], ['ch1', 'Impermeabilización', 'due', 2500]);
    assert.equal(ledger(db, 'u1', new Date(2026, 10, 1)).find((r) => r.chargeId).state, 'overdue');
    assert.equal(amountDue(db, 'u1', ['2026-10', 'ch1'], today), 3500);
  });

  test('un concepto mensual se cobra cada mes de su vigencia y sólo a las casas elegidas', () => {
    const db = base([
      { id: 'ch2', name: 'Cuota extraordinaria', amount: 300, kind: 'monthly', from: '2026-09', to: null, unitIds: ['u2'] },
    ]);
    assert.equal(ledger(db, 'u1', today).filter((r) => r.chargeId).length, 0);
    const rows = ledger(db, 'u2', today).filter((r) => r.chargeId);
    assert.deepEqual(
      rows.map((r) => r.key),
      ['ch2@2026-09', 'ch2@2026-10'],
    );
    assert.equal(rows[0].state, 'overdue');
    // El adeudo suma el concepto, pero los meses vencidos (para restricciones) sólo cuentan cuotas
    const debt = debtOf(db, 'u2', today);
    assert.equal(debt.months, 4);
    assert.equal(debt.amount, 4000 + 300 + 300);
  });

  test('un pago del concepto lo marca pagado y conserva su nombre', () => {
    const db = base([{ id: 'ch1', name: 'Pintura', amount: 800, kind: 'once', dueDate: '2026-10-31', unitIds: [] }]);
    const p = { id: 'p', unitId: 'u1', period: 'ch1', chargeId: 'ch1', concept: 'Pintura', amount: 800, status: 'approved' };
    db.payments.push(p);
    assert.equal(ledger(db, 'u1', today).find((r) => r.chargeId).state, 'paid');
    assert.ok(!payableMonths(db, 'u1', today).includes('ch1'));
    assert.equal(periodLabel(p), 'Pintura');
  });
});

describe('administración de conceptos y áreas', () => {
  const db = seedTenant({ sign });
  const admin = db.users.find((u) => u.role === 'admin').id;
  const resident = db.users.find((u) => u.role === 'resident');

  test('crear un concepto avisa a los residentes y se puede pagar en efectivo', () => {
    const { result: ch, next } = run(db, admin, 'saveCharge', {
      name: 'Fondo de reserva',
      amount: 500,
      kind: 'once',
      dueDate: '2099-01-31',
    });
    assert.equal(next.settings.charges.at(-1).id, ch.id);
    assert.ok(next.notifications.some((n) => n.userId === resident.id && n.title === 'Nuevo cargo: Fondo de reserva'));
    const paid = run(next, admin, 'registerCashPayment', { residentId: resident.id, periods: [ch.id] }).next;
    const p = paid.payments.find((x) => x.chargeId === ch.id);
    assert.deepEqual([p.amount, p.concept, p.status], [500, 'Fondo de reserva', 'approved']);
    // Con pagos, eliminar lo archiva: ya no se cobra a nadie más
    const after = run(paid, admin, 'deleteCharge', { id: ch.id }).next;
    assert.equal(after.settings.charges.find((c) => c.id === ch.id).archived, true);
    const other = after.users.find((u) => u.role === 'resident' && u.unitId !== resident.unitId);
    assert.ok(!ledger(after, other.unitId).some((r) => r.chargeId === ch.id));
  });

  test('un concepto sin pagos se elimina por completo y valida sus datos', () => {
    const { result: ch, next } = run(db, admin, 'saveCharge', { name: 'Multa', amount: 200, kind: 'monthly', from: '2026-10' });
    assert.ok(!run(next, admin, 'deleteCharge', { id: ch.id }).next.settings.charges.some((c) => c.id === ch.id));
    assert.throws(() => run(db, admin, 'saveCharge', { name: 'X', amount: 10, kind: 'once' }), DomainError);
    assert.throws(() => run(db, resident.id, 'saveCharge', { name: 'X', amount: 10, kind: 'once', dueDate: '2099-01-01' }), DomainError);
  });

  test('áreas: alta, edición, pausa y baja', () => {
    const { result: am, next } = run(db, admin, 'saveAmenity', { name: 'Gimnasio', capacity: 12, open: '06:00', close: '23:00' });
    const edited = run(next, admin, 'saveAmenity', { ...am, capacity: 15, active: false }).next;
    assert.equal(edited.settings.amenities.find((a) => a.id === am.id).capacity, 15);
    assert.throws(
      () => run(edited, resident.id, 'createReservation', { amenityId: am.id, date: '2099-01-01', from: '10:00', to: '11:00', guests: 2 }),
      /no está disponible/,
    );
    assert.throws(() => run(db, admin, 'saveAmenity', { name: 'Bad', capacity: 1, open: '10:00', close: '09:00' }), DomainError);
    assert.equal(
      run(edited, admin, 'deleteAmenity', { id: am.id }).next.settings.amenities.some((a) => a.id === am.id),
      false,
    );
  });

  test('no se elimina un área con reservaciones próximas', () => {
    const am = db.reservations.find((r) => r.status !== 'cancelled' && r.date >= new Date().toISOString().slice(0, 10)).amenityId;
    assert.throws(() => run(db, admin, 'deleteAmenity', { id: am }), /reservación/);
  });
});
