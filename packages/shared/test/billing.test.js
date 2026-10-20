import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTx, runOperation, DomainError } from '../src/index.js';
import {
  amountDue,
  checkDigit,
  debtOf,
  debtRestriction,
  ledger,
  payableRows,
  unitByReference,
  unitReference,
  validReference,
} from '../src/ledger.js';
import { parseAmount, parseBankStatement, parseDate } from '../src/bank.js';
import { seedTenant } from '../src/demo/seed.js';

const sign = (payload) => createHmac('sha256', 'test').update(payload).digest('base64url').slice(0, 16);
const tenant = () => seedTenant({ sign });
const run = (db, userId, name, input) => {
  const t = createTx({ ...db });
  const result = runOperation(name, t, { user: db.users.find((u) => u.id === userId), sign, trusted: {} }, input);
  return { result, next: t.next, side: t.side };
};
const unitOf = (db, residentId) => db.users.find((u) => u.id === residentId).unitId;

describe('recargos', () => {
  const base = (lateFeeGraceDays = 0) => ({
    settings: { monthlyFee: 1000, dueDay: 10, lateFee: 100, lateFeeGraceDays },
    units: [{ id: 'u1', label: 'Casa 1' }],
    payments: [],
  });

  test('se cobra después del día límite más la tolerancia', () => {
    const today = new Date(2026, 9, 12); // 12 de octubre
    assert.equal(ledger(base(0), 'u1', today).at(-1).lateFee, 100);
    assert.equal(ledger(base(5), 'u1', today).at(-1).lateFee, 0);
    assert.equal(ledger(base(0), 'u1', new Date(2026, 9, 10)).at(-1).lateFee, 0); // el día límite todavía no
    // Los meses anteriores siempre llevan recargo
    assert.deepEqual(
      ledger(base(5), 'u1', today).map((r) => r.amount),
      [1100, 1100, 1100, 1000],
    );
  });

  test('un recargo condonado ya no se cobra, pero la cuota sí', () => {
    const db = base();
    db.units[0].waivedLateFees = ['2026-08'];
    const row = ledger(db, 'u1', new Date(2026, 9, 20)).find((r) => r.month === '2026-08');
    assert.deepEqual([row.fee, row.lateFee, row.amount, row.waived], [1000, 0, 1000, true]);
  });

  test('el importe a pagar suma cuotas y recargos y rechaza meses pagados', () => {
    const db = base();
    db.payments.push({ id: 'p', unitId: 'u1', period: '2026-07', amount: 1000, status: 'approved' });
    const today = new Date(2026, 9, 20);
    assert.equal(amountDue(db, 'u1', ['2026-08', '2026-09'], today), 2200);
    assert.throws(() => amountDue(db, 'u1', ['2026-07'], today));
    assert.equal(debtOf(db, 'u1', today).amount, 3300);
  });

  test('el pago guarda el recargo y la condonación queda auditada', () => {
    const db = tenant();
    const unitId = unitOf(db, 'res1');
    const row = payableRows(db, unitId)[0];
    const { next } = run(db, 'res1', 'submitPayment', {
      periods: [row.month],
      method: 'transfer',
      reference: 'X',
      receipt: { id: 'f', name: 'c.png', type: 'image/png', dataUrl: 'data:image/png;base64,AA==' },
    });
    const p = next.payments.find((x) => x.unitId === unitId && x.period === row.month);
    assert.equal(p.amount, row.amount);
    assert.equal(p.lateFee, row.lateFee);

    const waived = run(db, 'adm1', 'waiveLateFee', { unitId, period: row.month });
    assert.equal(ledger(waived.next, unitId).find((r) => r.month === row.month).lateFee, 0);
    assert.equal(waived.side.audit[0].action, 'Recargo condonado');
    assert.throws(
      () => run(db, 'res1', 'waiveLateFee', { unitId, period: row.month }),
      (e) => e.status === 403,
    );
  });
});

describe('referencias de pago', () => {
  test('cada casa tiene una referencia única con dígito verificador', () => {
    const db = tenant();
    const refs = db.units.map((u) => unitReference(db, u.id));
    assert.equal(new Set(refs).size, refs.length);
    for (const [i, ref] of refs.entries()) {
      assert.match(ref, /^1\d{6}$/);
      assert.ok(validReference(ref));
      assert.equal(unitByReference(db, ref).id, db.units[i].id);
    }
    // Un dígito mal escrito se detecta
    const wrong = refs[0].slice(0, 6) + ((Number(refs[0][6]) + 1) % 10);
    assert.equal(validReference(wrong), false);
    assert.equal(unitByReference(db, wrong), null);
    assert.equal(checkDigit('100001'), refs[0][6]);
  });
});

describe('estado de cuenta del banco', () => {
  test('lee montos y fechas en formatos comunes', () => {
    assert.equal(parseAmount('$1,650.00'), 1650);
    assert.equal(parseAmount('(200.50)'), -200.5);
    assert.equal(parseDate('05/10/2026'), '2026-10-05');
    assert.equal(parseDate('2026-10-05'), '2026-10-05');
  });

  test('toma sólo los abonos, encuentra la referencia y da ids estables', () => {
    const csv = [
      'Estado de cuenta BBVA',
      'Fecha;Concepto;Referencia;Cargo;Abono;Saldo',
      '05/10/2026;SPEI RECIBIDO ANA TORRES;1000030;;"1,650.00";10,000.00',
      '06/10/2026;COMISION;;15.00;;9,985.00',
      '07/10/2026;DEPOSITO REF 1000054 CARLOS;;;1500;11,485.00',
      '07/10/2026;DEPOSITO REF 1000054 CARLOS;;;1500;12,985.00',
    ].join('\n');
    const { movements, error } = parseBankStatement(csv);
    assert.equal(error, null);
    assert.equal(movements.length, 3);
    assert.deepEqual(
      movements.map((m) => [m.date, m.amount, m.reference]),
      [
        ['2026-10-05', 1650, '1000030'],
        ['2026-10-07', 1500, '1000054'],
        ['2026-10-07', 1500, '1000054'],
      ],
    );
    assert.notEqual(movements[1].id, movements[2].id); // dos depósitos iguales siguen siendo dos
    assert.deepEqual(
      parseBankStatement(csv).movements.map((m) => m.id),
      movements.map((m) => m.id),
    );
  });

  test('avisa cuando el archivo no tiene el formato esperado', () => {
    assert.ok(parseBankStatement('').error);
    assert.ok(parseBankStatement('a,b,c\n1,2,3').error);
  });
});

describe('conciliación', () => {
  const mv = (id, amount, reference, description = 'SPEI') => ({ id, date: '2026-10-05', amount, reference, description });

  test('aplica depósitos exactos, aprueba comprobantes en revisión y separa lo que no cuadra', () => {
    const db = tenant();
    const ana = unitOf(db, 'res1');
    const carlos = unitOf(db, 'res2'); // tiene un comprobante en revisión
    const anaOwes = payableRows(db, ana).reduce((s, r) => s + r.amount, 0);
    const pending = db.payments.find((p) => p.unitId === carlos && p.status === 'pending');
    const { result, next } = run(db, 'adm1', 'reconcileBank', {
      movements: [
        mv('bm_a', anaOwes, unitReference(db, ana)),
        mv('bm_b', pending.amount, unitReference(db, carlos)),
        mv('bm_c', 999, unitReference(db, unitOf(db, 'res3'))),
        mv('bm_d', 1500, ''),
      ],
    });
    assert.deepEqual(result, { matched: 2, unmatched: 2, duplicates: 0, total: anaOwes + pending.amount });
    assert.equal(payableRows(next, ana).length, 0);
    assert.equal(next.payments.find((p) => p.id === pending.id).status, 'approved');
    const byId = Object.fromEntries(next.bankMovements.map((m) => [m.id, m]));
    assert.equal(byId.bm_a.status, 'matched');
    assert.equal(byId.bm_c.status, 'unmatched');
    assert.match(byId.bm_c.reason, /no coincide/);
    assert.match(byId.bm_d.reason, /referencia/);
    assert.ok(next.notifications.some((n) => n.userId === 'res1' && n.title === 'Recibimos tu transferencia'));

    // Volver a subir el mismo archivo no duplica pagos
    const again = run(next, 'adm1', 'reconcileBank', { movements: [mv('bm_a', anaOwes, unitReference(db, ana))] });
    assert.equal(again.result.duplicates, 1);
    assert.equal(again.next.payments.length, next.payments.length);
  });

  test('administración asigna o descarta a mano un depósito pendiente', () => {
    const db = tenant();
    const ana = unitOf(db, 'res1');
    const row = payableRows(db, ana)[0];
    const first = run(db, 'adm1', 'reconcileBank', { movements: [mv('bm_x', row.amount, ''), mv('bm_y', 10, '')] });
    const assigned = run(first.next, 'adm1', 'assignBankMovement', { id: 'bm_x', unitId: ana, periods: [row.month] });
    assert.equal(assigned.next.bankMovements.find((m) => m.id === 'bm_x').status, 'matched');
    assert.equal(ledger(assigned.next, ana).find((r) => r.month === row.month).state, 'paid');
    assert.throws(
      () => run(assigned.next, 'adm1', 'assignBankMovement', { id: 'bm_x', unitId: ana, periods: [row.month] }),
      (e) => e instanceof DomainError && e.status === 409,
    );
    const ignored = run(first.next, 'adm1', 'ignoreBankMovement', { id: 'bm_y' });
    assert.equal(ignored.next.bankMovements.find((m) => m.id === 'bm_y').status, 'ignored');
  });
});

describe('restricciones por adeudo', () => {
  const owing = () => {
    const db = tenant();
    const unitId = unitOf(db, 'res1');
    db.payments = db.payments.filter((p) => p.unitId !== unitId);
    db.settings = { ...db.settings, restrictions: { enabled: true, minMonths: 2, reservations: true, recurrentPasses: true } };
    return db;
  };
  const pass = (mode) => ({
    visitorName: 'Visita',
    type: 'amigo',
    mode,
    validFrom: new Date().toISOString(),
    validTo: new Date(Date.now() + 86400e3).toISOString(),
    maxUses: mode === 'single' ? 1 : 5,
    days: [],
    timeFrom: '00:00',
    timeTo: '23:59',
  });

  test('bloquea reservas y pases recurrentes, pero no las visitas de una vez', () => {
    const db = owing();
    assert.ok(debtRestriction(db, unitOf(db, 'res1'), 'reservations'));
    const date = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10);
    assert.throws(
      () => run(db, 'res1', 'createReservation', { amenityId: 'am3', date, from: '10:00', to: '11:00', guests: 2 }),
      (e) => e.code === 'debt_restricted',
    );
    assert.throws(
      () => run(db, 'res1', 'createPass', pass('multi')),
      (e) => e.code === 'debt_restricted',
    );
    assert.doesNotThrow(() => run(db, 'res1', 'createPass', pass('single')));
  });

  test('sin la regla activa no se restringe nada', () => {
    const db = owing();
    db.settings = { ...db.settings, restrictions: { ...db.settings.restrictions, enabled: false } };
    assert.equal(debtRestriction(db, unitOf(db, 'res1'), 'reservations'), null);
  });
});

test('no se puede aplicar a más meses de los que cubre el depósito', () => {
  const db = tenant();
  const unitId = 'u1'; // casa sin pagos
  const rows = payableRows(db, unitId);
  const first = run(db, 'adm1', 'reconcileBank', {
    movements: [{ id: 'bm_z', date: '2026-10-05', amount: rows[0].amount + 10, reference: '', description: '' }],
  });
  assert.throws(
    () => run(first.next, 'adm1', 'assignBankMovement', { id: 'bm_z', unitId, periods: rows.slice(0, 2).map((r) => r.month) }),
    (e) => e.code === 'amount_exceeded',
  );
  const ok = run(first.next, 'adm1', 'assignBankMovement', { id: 'bm_z', unitId, periods: [rows[0].month] });
  assert.equal(ok.next.bankMovements.find((m) => m.id === 'bm_z').surplus, 10);
});
