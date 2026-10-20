import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { monthKey } from '@residencial/shared';
import { COMPANY_PASSWORD, createTestApp } from './helpers.js';

const PNG = `data:image/png;base64,${Buffer.from('comprobante').toString('base64')}`;
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

describe('suscripción desde la app del administrador', () => {
  let t,
    admin,
    staff,
    seq = 0;
  /** Cargo pendiente nuevo para un residencial. */
  const invoice = (tenantId, over = {}) => {
    const inv = {
      id: `inv_test_${++seq}`,
      tenantId,
      period: `2030-${String(seq).padStart(2, '0')}`,
      amount: 2990,
      status: 'pending',
      dueDate: day(10),
      createdAt: new Date().toISOString(),
      ...over,
    };
    t.repos.platform.createInvoice(inv);
    return inv;
  };
  const inv = (id) => t.repos.platform.invoice(id);
  const sent = (to, text) => t.repos.platform.recentMessages(200).filter((m) => m.to === to && (m.subject || m.body).includes(text));

  before(async () => {
    t = await createTestApp();
    admin = t.client();
    staff = t.client();
    assert.equal((await admin.login('admin@residencial.mx')).status, 200);
    assert.equal((await staff.login('empresa@residencial.cloud', COMPANY_PASSWORD, 'platform')).status, 200);
  });
  after(() => t.close());

  test('el administrador ve sus cargos, la cuenta de la empresa y su cobro automático', async () => {
    const { body } = await admin.get('/me/snapshot');
    const p = body.root.platform;
    assert.ok(p.invoices.some((i) => i.period === monthKey() && i.status === 'pending'));
    assert.ok(p.company.bank.clabe);
    assert.deepEqual(p.billing, [{ tenantId: 't1', autopay: false, card: null, bank: p.company.bank }]);
    const ana = t.client();
    await ana.login('ana@correo.mx');
    const r = (await ana.get('/me/snapshot')).body.root.platform;
    assert.equal(r.company.bank, null);
    assert.deepEqual(r.billing, []);
    assert.equal((await ana.post(`/tenant/subscription/invoices/${p.invoices[0].id}/checkout`)).status, 403);
  });

  test('paga con tarjeta, guarda la tarjeta y activa el cobro automático', async () => {
    const current = (await admin.get('/me/snapshot')).body.root.platform.invoices.find((i) => i.period === monthKey());
    const c = await admin.post(`/tenant/subscription/invoices/${current.id}/checkout`, { saveCard: true });
    assert.equal(c.status, 200);
    assert.equal(c.body.amount, current.amount);
    assert.equal((await admin.post(`/tenant/subscription/checkouts/${c.body.id}/confirm`)).body.status, 'paid');
    assert.equal(inv(current.id).status, 'paid');
    assert.equal(inv(current.id).method, 'ecartpay');
    const b = (await admin.get('/me/snapshot')).body.root.platform.billing[0];
    assert.equal(b.autopay, true);
    assert.deepEqual(b.card, { brand: 'Visa', last4: '4242' });
    assert.equal(JSON.stringify(b).includes('card_'), false, 'el identificador de la tarjeta no sale del servidor');
    assert.equal(sent('admin@residencial.mx', 'Pago recibido').length, 1);
    // Confirmar de nuevo no registra el pago otra vez
    assert.equal((await admin.post(`/tenant/subscription/checkouts/${c.body.id}/confirm`)).body.registered, undefined);
    assert.equal((await admin.post(`/tenant/subscription/invoices/${current.id}/checkout`)).status, 409);
  });

  test('el cobro automático cobra una vez al día y avisa si la tarjeta se rechaza', async () => {
    const a = invoice('t1');
    let r = await t.app.ctx.subscriptionService.runJobs();
    assert.equal(r.charged, 1);
    assert.equal(inv(a.id).status, 'paid');

    const tok = t.repos.platform.billing('t1');
    t.repos.platform.saveBilling('t1', { ...tok, cardToken: 'card_declined' });
    const b = invoice('t1');
    r = await t.app.ctx.subscriptionService.runJobs();
    assert.equal(r.failed, 1);
    assert.equal(inv(b.id).status, 'pending');
    assert.equal(sent('admin@residencial.mx', 'No pudimos cobrar tu tarjeta').length, 1);
    r = await t.app.ctx.subscriptionService.runJobs();
    assert.equal(r.failed, 0, 'no se reintenta el mismo día');
    // Mañana sí se reintenta
    r = await t.app.ctx.subscriptionService.runJobs(new Date(Date.now() + 864e5));
    assert.equal(r.failed, 1);
    t.repos.platform.payInvoice(b.id, { method: 'cash', reference: '', paidAt: new Date().toISOString() });
  });

  test('desactivar el cobro automático y quitar la tarjeta', async () => {
    assert.equal((await admin.put('/tenant/subscription/autopay', { enabled: false })).status, 204);
    assert.equal(t.repos.platform.billing('t1').autopay, false);
    assert.equal((await admin.delete('/tenant/subscription/card')).status, 204);
    assert.equal(t.repos.platform.billing('t1').card, null);
    assert.equal((await admin.put('/tenant/subscription/autopay', { enabled: true })).status, 409);
  });

  test('recuerda el pago unos días antes del vencimiento, una sola vez', async () => {
    const a = invoice('t1', { dueDate: day(2) });
    const far = invoice('t1', { dueDate: day(20) });
    const r = await t.app.ctx.subscriptionService.runJobs();
    assert.equal(r.reminded, 1);
    assert.ok(inv(a.id).remindedAt);
    assert.equal(inv(far.id).remindedAt, null);
    const wa = t.repos.platform
      .recentMessages(50)
      .find((m) => m.channel === 'whatsapp' && m.to === '+525512340001' && m.body.includes('vence'));
    assert.equal(wa.meta.template, 'subscription');
    assert.equal((await t.app.ctx.subscriptionService.runJobs()).reminded, 0);
    const notes = (await admin.get('/me/snapshot')).body.root.tenants.t1.notifications;
    assert.ok(notes.some((n) => n.title === 'Tu suscripción está por vencer'));
    for (const i of [a, far]) t.repos.platform.voidInvoice(i.id);
  });

  test('transferencia: comprobante, rechazo con motivo y aprobación de la empresa', async () => {
    const a = invoice('t1');
    const url = `/tenant/subscription/invoices/${a.id}/transfer`;
    assert.equal((await admin.post(url, { reference: 'SPEI 123', receipt: 'data:text/plain;base64,aG9sYQ==' })).status, 400);
    assert.equal((await admin.post(url, { reference: 'SPEI 123', receipt: PNG })).status, 204);
    assert.equal(inv(a.id).review.reference, 'SPEI 123');
    assert.equal((await admin.post(url, { reference: 'otra', receipt: PNG })).status, 409, 'no se envía dos veces');
    assert.equal(sent('empresa@residencial.cloud', 'Comprobante por revisar').length, 1);

    assert.equal((await staff.post(`/platform/invoices/${a.id}/review/reject`, { reason: 'No se ve el monto' })).status, 204);
    assert.equal(inv(a.id).review.rejectReason, 'No se ve el monto');
    assert.equal(inv(a.id).review.receipt, null);
    assert.equal(sent('admin@residencial.mx', 'Revisa tu comprobante').length, 1);

    assert.equal((await admin.post(url, { reference: 'SPEI 456', receipt: PNG })).status, 204);
    assert.equal((await staff.post(`/platform/invoices/${a.id}/review/approve`)).status, 204);
    assert.equal(inv(a.id).status, 'paid');
    assert.equal(inv(a.id).method, 'transfer');
    assert.equal(inv(a.id).reference, 'SPEI 456');
    assert.equal((await staff.post(`/platform/invoices/${a.id}/review/approve`)).status, 409);
  });

  test('con el servicio suspendido el administrador sólo puede pagar, y al ponerse al corriente se reactiva', async () => {
    // Los Robles tiene el cargo del mes vencido
    assert.equal((await staff.post('/platform/residencias/suspend-overdue', { days: 1 })).body.suspended, 1);
    assert.equal((await t.client().login('admin@losrobles.mx')).status, 200);
    const ricardo = t.client();
    await ricardo.login('admin@losrobles.mx');
    const snap = (await ricardo.get('/me/snapshot')).body.root;
    assert.equal(snap.platform.residencias[0].status, 'suspended');
    const res = await ricardo.post('/tenant/notices', { title: 'Hola', body: 'x', category: 'general' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'tenant_suspended');

    const overdue = snap.platform.invoices.find((i) => i.status === 'pending');
    const c = await ricardo.post(`/tenant/subscription/invoices/${overdue.id}/checkout`, { saveCard: false });
    await ricardo.post(`/tenant/subscription/checkouts/${c.body.id}/confirm`);
    assert.equal(t.repos.tenants.find('t2').status, 'active');
    assert.equal(t.repos.platform.billing('t2').autopay, false, 'sin marcar la casilla no se guarda la tarjeta');
    assert.ok(sent('admin@losrobles.mx', 'Servicio reactivado').length >= 1);
  });

  test('una suspensión que no es por adeudo no se levanta sola al pagar', async () => {
    await staff.patch('/platform/residencias/t1/status', { status: 'suspended', reason: 'Solicitud del comité' });
    const a = invoice('t1', { dueDate: day(-30) });
    assert.equal((await staff.post(`/platform/invoices/${a.id}/pay`, { method: 'cash' })).status, 204);
    assert.equal(t.repos.tenants.find('t1').status, 'suspended');
    await staff.patch('/platform/residencias/t1/status', { status: 'active' });
  });
});
