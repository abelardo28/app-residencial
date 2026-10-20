import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { payableRows, unitReference } from '@residencial/shared';
import { createTestApp } from './helpers.js';

describe('cobranza', () => {
  let t, ana, admin;
  before(async () => {
    t = await createTestApp();
    [ana, admin] = [t.client(), t.client()];
    await ana.login('ana@correo.mx');
    await admin.login('admin@residencial.mx');
  });
  after(() => t.close());

  const tenantOf = async (client) => (await client.get('/me/snapshot')).body.root.tenants.t1;

  test('el cobro con tarjeta incluye el recargo del mes vencido', async () => {
    const db = await tenantOf(admin);
    const [row] = payableRows(db, 'u3');
    const checkout = await ana.post('/tenant/payments/ecartpay/checkout', { periods: [row.month] });
    assert.equal(checkout.status, 200);
    assert.equal(checkout.body.amount, row.amount);
  });

  test('la conciliación aplica el depósito y no lo repite', async () => {
    const db = await tenantOf(admin);
    const owed = payableRows(db, 'u3').reduce((s, r) => s + r.amount, 0);
    const movements = [{ id: 'bm_test1', date: '2026-10-05', amount: owed, reference: unitReference(db, 'u3'), description: 'SPEI ANA' }];
    const res = await admin.post('/tenant/bank/reconcile', { movements });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.matched, 1);
    assert.equal((await admin.post('/tenant/bank/reconcile', { movements })).body.result.duplicates, 1);

    const mine = await tenantOf(ana);
    assert.equal(payableRows(mine, 'u3').length, 0);
    assert.deepEqual(mine.bankMovements, []); // el residente no ve el estado de cuenta
    assert.equal((await tenantOf(admin)).bankMovements.length, 1);
  });

  test('sólo administración concilia y condona', async () => {
    const movements = [{ id: 'bm_x', date: '2026-10-05', amount: 10, reference: '', description: '' }];
    assert.equal((await ana.post('/tenant/bank/reconcile', { movements })).status, 403);
    assert.equal((await ana.post('/tenant/units/u3/late-fees/waive', { period: '2026-10' })).status, 403);
    assert.equal((await admin.post('/tenant/units/u9/late-fees/waive', { period: '2026-10' })).status, 200);
  });

  test('un depósito sin referencia se asigna a mano', async () => {
    const db = await tenantOf(admin);
    const [row] = payableRows(db, 'u9');
    await admin.post('/tenant/bank/reconcile', {
      movements: [{ id: 'bm_noref', date: '2026-10-06', amount: row.amount, reference: '', description: 'DEPOSITO EFECTIVO' }],
    });
    const res = await admin.post('/tenant/bank/movements/bm_noref/assign', { unitId: 'u9', periods: [row.month] });
    assert.equal(res.status, 200);
    const after = await tenantOf(admin);
    assert.equal(after.bankMovements.find((m) => m.id === 'bm_noref').status, 'matched');
    assert.equal((await admin.post('/tenant/bank/movements/bm_noref/ignore')).status, 409);
  });

  test('las reglas de cobranza se validan', async () => {
    assert.equal((await admin.patch('/tenant/settings', { lateFeeGraceDays: 40 })).status, 400);
    const ok = await admin.patch('/tenant/settings', {
      lateFeeGraceDays: 5,
      restrictions: { enabled: true, minMonths: 3, reservations: true, recurrentPasses: false },
    });
    assert.equal(ok.status, 200);
    assert.equal((await tenantOf(admin)).settings.restrictions.minMonths, 3);
  });
});
