import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTx, runOperation, DomainError } from '../src/index.js';
import { buildToken, parseInput, evaluatePass } from '../src/access.js';
import { ledger, payableMonths } from '../src/ledger.js';
import { monthKey, lastMonths } from '../src/format.js';
import { passwordIssues } from '../src/validation.js';
import { viewFor } from '../src/views.js';
import { seedTenant } from '../src/demo/seed.js';

const sign = (payload) => createHmac('sha256', 'test').update(payload).digest('base64url').slice(0, 16);
const tenant = () => seedTenant({ sign });
const as = (db, id) => ({ user: db.users.find((u) => u.id === id), sign, trusted: {} });
const run = (db, userId, name, input) => {
  const t = createTx({ ...db });
  const result = runOperation(name, t, as(db, userId), input);
  return { result, next: t.next, side: t.side };
};

describe('operaciones compartidas', () => {
  test('rechaza un rol sin permiso', () => {
    const db = tenant();
    assert.throws(
      () => run(db, 'res1', 'registerPackage', { unitId: 'u3', carrier: 'DHL' }),
      (e) => e instanceof DomainError && e.status === 403,
    );
  });

  test('las operaciones no mutan el estado original', () => {
    const db = tenant();
    const before = db.packages.length;
    const { next } = run(db, 'grd1', 'registerPackage', { unitId: 'u3', carrier: 'DHL' });
    assert.equal(db.packages.length, before);
    assert.equal(next.packages.length, before + 1);
    assert.ok(next.notifications.some((n) => n.userId === 'res1' && n.kind === 'package'));
  });

  test('un pase firmado se reconoce y uno alterado no', () => {
    const pass = { id: 'p1', code: 'ABC123', validTo: new Date(Date.now() + 3600e3).toISOString() };
    const token = buildToken(pass, sign);
    assert.equal(parseInput(token, sign).signatureOk, true);
    assert.equal(parseInput(token.replace('p1', 'p2'), sign).signatureOk, false);
  });

  test('un pase revocado no es válido', () => {
    const now = Date.now();
    const pass = {
      status: 'revoked',
      validFrom: new Date(now - 1e3).toISOString(),
      validTo: new Date(now + 1e6).toISOString(),
      uses: [],
      maxUses: 1,
      days: [],
    };
    assert.equal(evaluatePass(pass).ok, false);
  });

  test('no permite pagar dos veces el mismo mes', () => {
    const db = tenant();
    const m = monthKey();
    const { next } = run(db, 'res1', 'submitPayment', { periods: [m], method: 'cash' });
    assert.throws(() => run(next, 'res1', 'submitPayment', { periods: [m], method: 'cash' }), /ya está pagado o en revisión/);
  });

  test('un pago con Ecart Pay necesita la verificación del servidor', () => {
    const db = tenant();
    assert.throws(
      () => run(db, 'res1', 'submitPayment', { periods: [monthKey()], method: 'ecartpay', ecartpayId: 'x' }),
      (e) => e.status === 402,
    );
  });

  test('las reservaciones no se empalman', () => {
    const db = tenant();
    const am = db.settings.amenities[0];
    const input = { amenityId: am.id, date: '2030-01-10', from: am.open, to: am.close, guests: 1 };
    const { next } = run(db, 'res1', 'createReservation', input);
    assert.throws(
      () => run(next, 'res2', 'createReservation', input),
      (e) => e.code === 'slot_taken',
    );
  });
});

describe('estado de cuenta', () => {
  test('marca los meses pagados y pendientes', () => {
    const db = tenant();
    const months = lastMonths(4);
    const rows = ledger(db, 'u3');
    assert.deepEqual(
      rows.filter((r) => !r.chargeId).map((r) => r.month),
      months,
    );
    // Además de las cuotas, el concepto de ejemplo del residencial
    assert.ok(payableMonths(db, 'u3').every((m) => months.includes(m) || m === 'ch_imper'));
  });
});

describe('vistas por rol', () => {
  test('un residente sólo ve lo de su casa', () => {
    const db = tenant();
    const me = db.users.find((u) => u.id === 'res1');
    const v = viewFor(db, me);
    assert.ok(v.passes.every((p) => p.unitId === 'u3'));
    assert.ok(v.users.filter((u) => u.id !== 'res1').every((u) => !u.email && !u.phone));
  });
});

describe('contraseñas', () => {
  test('exige longitud, mayúsculas, números y símbolos y evita datos personales', () => {
    assert.ok(passwordIssues('corta').length >= 3);
    assert.equal(passwordIssues('Girasol#Azul2026', { name: 'Ana Torres', email: 'ana@correo.mx' }).length, 0);
    assert.ok(passwordIssues('Torres#Casa2026', { name: 'Ana Torres' }).length > 0);
  });
});
