import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { monthKey } from '@residencial/shared';
import { createTestApp, passInput } from './helpers.js';

describe('operaciones del residencial', () => {
  let t, ana, jorge, admin;
  before(async () => {
    t = await createTestApp();
    [ana, jorge, admin] = [t.client(), t.client(), t.client()];
    await ana.login('ana@correo.mx');
    await jorge.login('caseta@residencial.mx');
    await admin.login('admin@residencial.mx');
  });
  after(() => t.close());

  test('un pase de una entrada sólo se usa una vez', async () => {
    const created = await ana.post('/tenant/passes', passInput());
    assert.equal(created.status, 200);
    const pass = created.body.result;
    const check = await jorge.post('/tenant/access/check', { text: pass.token });
    assert.equal(check.body.result.ok, true);
    assert.equal((await jorge.post('/tenant/access/entries', { passId: pass.id })).status, 200);
    const again = await jorge.post('/tenant/access/entries', { passId: pass.id });
    assert.equal(again.status, 409);
  });

  test('un QR alterado no se acepta', async () => {
    const { body } = await ana.post('/tenant/passes', passInput());
    const forged = body.result.token.slice(0, -2) + (body.result.token.endsWith('AA') ? 'BB' : 'AA');
    const check = await jorge.post('/tenant/access/check', { text: forged });
    assert.equal(check.body.result.ok, false);
  });

  test('el cliente no puede fijar campos del servidor', async () => {
    const { body } = await ana.post('/tenant/passes', passInput({ status: 'used', residentId: 'res2', unitId: 'u5', id: 'mio' }));
    assert.equal(body.result.status, 'active');
    assert.equal(body.result.residentId, 'res1');
    assert.equal(body.result.unitId, 'u3');
    assert.notEqual(body.result.id, 'mio');
  });

  test('cada rol sólo ejecuta sus operaciones', async () => {
    assert.equal((await ana.post('/tenant/access/entries', { visitorName: 'X', unitId: 'u3' })).status, 403);
    assert.equal((await jorge.post('/tenant/passes', passInput())).status, 403);
    assert.equal((await ana.patch('/tenant/settings', { monthlyFee: 1 })).status, 403);
  });

  test('un residente no puede cancelar el pase de otra casa', async () => {
    const carlos = t.client();
    await carlos.login('carlos@correo.mx');
    const { body } = await carlos.post('/tenant/passes', passInput());
    assert.equal((await ana.post(`/tenant/passes/${body.result.id}/revoke`)).status, 403);
  });

  test('la vista del residente no incluye datos de otras casas', async () => {
    const { body } = await ana.get('/me/snapshot');
    const db = body.root.tenants.t1;
    assert.ok(db.passes.every((p) => p.unitId === 'u3'));
    assert.ok(db.payments.every((p) => p.unitId === 'u3' || (p.unitId === null && !p.receipt && !p.residentId)));
    assert.ok(db.notifications.every((n) => n.userId === 'res1'));
    const other = db.users.find((u) => u.id === 'res4');
    assert.equal(other.email, undefined);
    assert.equal(other.phone, undefined);
    assert.deepEqual(body.root.platform.invoices, []);
  });

  test('el vigilante no recibe los pases ni los pagos', async () => {
    const { body } = await jorge.get('/me/snapshot');
    assert.deepEqual(body.root.tenants.t1.passes, []);
    assert.deepEqual(body.root.tenants.t1.payments, []);
  });

  test('datos inválidos responden 400 con el detalle', async () => {
    const res = await ana.post('/tenant/passes', passInput({ validFrom: 'mañana', type: 'nada' }));
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.field === 'validFrom'));
  });

  test('un pago "Ecart Pay" sólo lo registra el servidor tras verificarlo', async () => {
    const forged = await ana.post('/tenant/payments', { periods: [monthKey()], method: 'ecartpay', ecartpayId: 'ecp_falso' });
    assert.equal(forged.status, 400);

    const checkout = await ana.post('/tenant/payments/ecartpay/checkout', { periods: [monthKey()] });
    assert.equal(checkout.status, 200);
    const confirm = await ana.post(`/tenant/payments/ecartpay/${checkout.body.id}/confirm`);
    assert.equal(confirm.body.status, 'paid');
    assert.equal(confirm.body.registered, true);
    const twice = await ana.post(`/tenant/payments/ecartpay/${checkout.body.id}/confirm`);
    assert.equal(twice.body.status, 'paid');
    const { body } = await ana.get('/me/snapshot');
    const mine = body.root.tenants.t1.payments.filter((p) => p.ecartpayId === checkout.body.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'approved');
  });

  test('otro residente no puede confirmar un cobro ajeno', async () => {
    const carlos = t.client();
    await carlos.login('carlos@correo.mx');
    const checkout = await ana.post('/tenant/payments/ecartpay/checkout', { periods: [monthKey()] });
    // El mes ya se pagó en la prueba anterior
    assert.equal(checkout.status, 409);
    const c2 = await carlos.post('/tenant/payments/ecartpay/checkout', { periods: [monthKey()] });
    assert.equal((await ana.post(`/tenant/payments/ecartpay/${c2.body.id}/confirm`)).status, 404);
  });

  test('las operaciones quedan en la auditoría del residencial', async () => {
    await admin.patch('/tenant/settings', { lateFee: 150 });
    const { body } = await admin.get('/me/snapshot');
    assert.equal(body.root.tenants.t1.settings.lateFee, 150);
    assert.ok(body.root.platform.audit.some((e) => e.action === 'Configuración actualizada' && e.actor === 'Laura Méndez'));
  });
});

describe('aislamiento entre residenciales', () => {
  let t, ricardo;
  before(async () => {
    t = await createTestApp();
    ricardo = t.client();
    await ricardo.login('admin@losrobles.mx');
  });
  after(() => t.close());

  test('un administrador sólo ve su residencial', async () => {
    const { body } = await ricardo.get('/me/snapshot');
    assert.deepEqual(Object.keys(body.root.tenants), ['t2']);
    assert.equal(body.root.platform.residencias.length, 1);
    assert.ok(body.root.platform.invoices.every((i) => i.tenantId === 't2'));
  });

  test('no puede administrar cuentas de otro residencial', async () => {
    const invite = await ricardo.post('/tenants/t1/users', { name: 'Intruso', email: 'intruso@correo.mx', phone: '3312345678', role: 'admin' });
    assert.equal(invite.status, 403);
    assert.equal((await ricardo.post('/tenants/t1/users/res1/reset-password')).status, 403);
  });

  test('las operaciones no alcanzan registros de otro residencial', async () => {
    assert.equal((await ricardo.post('/tenant/notices/n1/read')).status, 404);
  });
});
