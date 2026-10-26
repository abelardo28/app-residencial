import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { payableRows } from '@residencial/shared';
import { createTestApp } from './helpers.js';

describe('tarjetas guardadas y cuentas para transferencias', () => {
  let t, ana, carlos, admin;
  const tenantOf = async (client) => (await client.get('/me/snapshot')).body.root.tenants.t1;
  const owed = async (client) => {
    const ten = await tenantOf(client);
    const me = ten.users.find((u) => u.unitId && u.email);
    return payableRows(ten, me.unitId).map((r) => r.key);
  };
  before(async () => {
    t = await createTestApp();
    [ana, carlos, admin] = [t.client(), t.client(), t.client()];
    await ana.login('ana@correo.mx');
    await carlos.login('carlos@correo.mx');
    await admin.login('admin@residencial.mx');
  });
  after(() => t.close());

  test('el residente ve sus tarjetas sin el identificador de Ecart Pay; administración no las recibe', async () => {
    const cards = (await tenantOf(ana)).cards;
    assert.equal(cards.length, 1);
    assert.equal(cards[0].last4, '4242');
    assert.equal(cards[0].token, undefined);
    assert.deepEqual((await tenantOf(admin)).cards, []);
    assert.deepEqual((await tenantOf(carlos)).cards, []);
  });

  test('paga con la tarjeta guardada y el pago queda aprobado', async () => {
    const [first] = await owed(ana);
    assert.ok(first, 'Ana tiene algo por pagar en los datos de ejemplo');
    const res = await ana.post('/tenant/payments/ecartpay/card', { periods: [first], cardId: 'card_res1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'paid');
    const pay = (await tenantOf(ana)).payments.find((p) => p.method === 'ecartpay' && p.card === 'Visa ···4242');
    assert.equal(pay.status, 'approved');
    // El mismo cargo no se cobra dos veces
    assert.equal((await ana.post('/tenant/payments/ecartpay/card', { periods: [first], cardId: 'card_res1' })).status, 409);
  });

  test('nadie cobra con la tarjeta de otra persona', async () => {
    const [first] = await owed(carlos);
    assert.equal((await carlos.post('/tenant/payments/ecartpay/card', { periods: [first], cardId: 'card_res1' })).status, 404);
    assert.equal((await carlos.post('/tenant/cards/card_res1/default')).status, 404);
    assert.equal((await carlos.delete('/tenant/cards/card_res1')).status, 404);
  });

  test('al pagar puede guardar la tarjeta; la primera queda como predeterminada', async () => {
    const [first] = await owed(carlos);
    const checkout = await carlos.post('/tenant/payments/ecartpay/checkout', { periods: [first], saveCard: true });
    assert.equal(checkout.status, 200);
    assert.equal((await carlos.post(`/tenant/payments/ecartpay/${checkout.body.id}/confirm`)).body.status, 'paid');
    const cards = (await tenantOf(carlos)).cards;
    assert.equal(cards.length, 1);
    assert.equal(cards[0].isDefault, true);
  });

  test('cambia la predeterminada y elimina tarjetas', async () => {
    const [next] = await owed(ana);
    const c = await ana.post('/tenant/payments/ecartpay/checkout', { periods: [next], saveCard: true });
    await ana.post(`/tenant/payments/ecartpay/${c.body.id}/confirm`);
    assert.equal((await tenantOf(ana)).cards.length, 1, 'la misma tarjeta no se guarda dos veces');
    assert.equal((await ana.delete('/tenant/cards/card_res1')).status, 200);
    assert.deepEqual((await tenantOf(ana)).cards, []);
  });

  test('administración configura varias cuentas y siempre hay una principal', async () => {
    const accounts = [
      { alias: 'Mantenimiento', name: 'BBVA', clabe: '012180001122334455', holder: 'Colonos A.C.' },
      { alias: 'Reservas', name: 'Banorte', clabe: '072180009988776655', holder: 'Colonos A.C.', primary: true },
    ];
    assert.equal((await admin.patch('/tenant/settings', { bankAccounts: accounts })).status, 200);
    const { settings } = await tenantOf(ana);
    assert.equal(settings.bankAccounts.length, 2);
    assert.deepEqual(
      settings.bankAccounts.map((a) => a.primary),
      [false, true],
    );
    assert.equal(settings.bank.clabe, '072180009988776655', 'la cuenta principal se repite en `bank`');
    assert.equal((await ana.patch('/tenant/settings', { bankAccounts: accounts })).status, 403);
  });
});
