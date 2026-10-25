import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers.js';

describe('conceptos de cobro y áreas comunes', () => {
  let t, ana, admin;
  const tenantOf = async (client) => (await client.get('/me/snapshot')).body.root.tenants.t1;
  before(async () => {
    t = await createTestApp();
    [ana, admin] = [t.client(), t.client()];
    await ana.login('ana@correo.mx');
    await admin.login('admin@residencial.mx');
  });
  after(() => t.close());

  test('la administración crea un concepto y el residente lo paga con Ecart Pay', async () => {
    const created = await admin.post('/tenant/charges', { name: 'Fondo de reserva', amount: 700, kind: 'once', dueDate: '2099-12-31' });
    assert.equal(created.status, 200);
    const charge = created.body.result;
    assert.ok((await tenantOf(ana)).settings.charges.some((c) => c.id === charge.id));

    const checkout = await ana.post('/tenant/payments/ecartpay/checkout', { periods: [charge.id] });
    assert.equal(checkout.status, 200);
    assert.equal(checkout.body.amount, 700);
    assert.equal((await ana.post(`/tenant/payments/ecartpay/${checkout.body.id}/confirm`)).body.status, 'paid');
    const paid = (await tenantOf(ana)).payments.find((p) => p.chargeId === charge.id);
    assert.deepEqual([paid.concept, paid.status, paid.amount], ['Fondo de reserva', 'approved', 700]);
    // Ya pagado no se vuelve a cobrar
    assert.equal((await ana.post('/tenant/payments/ecartpay/checkout', { periods: [charge.id] })).status, 409);
  });

  test('un residente no puede crear conceptos ni la API acepta datos inválidos', async () => {
    assert.equal((await ana.post('/tenant/charges', { name: 'X', amount: 1, kind: 'once', dueDate: '2099-01-01' })).status, 403);
    assert.equal((await admin.post('/tenant/charges', { name: 'X', amount: -5, kind: 'once', dueDate: '2099-01-01' })).status, 400);
    assert.equal((await admin.post('/tenant/charges', { name: 'X', amount: 5, kind: 'monthly' })).status, 400);
  });

  test('áreas comunes: alta, edición y baja', async () => {
    const { body } = await admin.post('/tenant/amenities', { name: 'Ludoteca', capacity: 15, open: '10:00', close: '19:00' });
    const am = body.result;
    await admin.post('/tenant/amenities', { ...am, capacity: 20 });
    assert.equal((await tenantOf(ana)).settings.amenities.find((a) => a.id === am.id).capacity, 20);
    assert.equal((await admin.delete(`/tenant/amenities/${am.id}`)).status, 200);
    assert.ok(!(await tenantOf(ana)).settings.amenities.some((a) => a.id === am.id));
    assert.equal((await ana.post('/tenant/amenities', { name: 'Mía', capacity: 1, open: '10:00', close: '11:00' })).status, 403);
  });
});
