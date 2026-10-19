import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_PASSWORD, createTestApp } from './helpers.js';

describe('portal de la empresa', () => {
  let t, staff;
  before(async () => {
    t = await createTestApp();
    staff = t.client();
    assert.equal((await staff.login('empresa@residencial.cloud', COMPANY_PASSWORD, 'platform')).status, 200);
  });
  after(() => t.close());

  test('las cuentas de residencial no entran al portal', async () => {
    const res = await t.client().post('/auth/login', { email: 'ana@correo.mx', password: 'Demo#2026', scope: 'platform' });
    assert.equal(res.status, 401);
    const ana = t.client();
    await ana.login('ana@correo.mx');
    assert.equal((await ana.post('/platform/invoices/generate')).status, 403);
  });

  test('ve todas las residencias sin datos operativos', async () => {
    const { body } = await staff.get('/me/snapshot');
    assert.equal(body.root.platform.residencias.length, 2);
    assert.equal(body.root.tenants.t1.passes, undefined);
    assert.ok(body.root.tenants.t1.users.length > 0);
  });

  test('suspender un residencial cierra sus sesiones y bloquea el acceso', async () => {
    const ana = t.client();
    await ana.login('ana@correo.mx');
    assert.equal((await staff.patch('/platform/residencias/t1/status', { status: 'suspended', reason: 'Adeudo' })).status, 204);
    assert.equal((await ana.get('/me/snapshot')).status, 401);
    assert.equal((await t.client().login('ana@correo.mx')).status, 403);
    assert.ok(
      t.repos.platform.recentMessages(20).some((m) => m.to === 'admin@residencial.mx' && m.subject.startsWith('Servicio suspendido')),
    );
    await staff.patch('/platform/residencias/t1/status', { status: 'active' });
    assert.equal((await t.client().login('ana@correo.mx')).status, 200);
  });

  test('crear un residencial invita a su administrador', async () => {
    const res = await staff.post('/platform/residencias', {
      name: 'Residencial Nuevo',
      address: 'Calle 1',
      plan: 'basic',
      unitCount: 5,
      unitPrefix: 'Casa',
      monthlyFee: 900,
      admin: { name: 'Nora Admin', email: 'nora@nuevo.mx', phone: '3311112222' },
    });
    assert.equal(res.status, 201);
    const { body } = await staff.get('/me/snapshot');
    const tenant = body.root.tenants[res.body.id];
    assert.equal(tenant.units.length, 5);
    assert.equal(tenant.users[0].auth.status, 'pending');
    assert.ok(body.root.platform.invoices.some((i) => i.tenantId === res.body.id && i.status === 'pending'));
    assert.ok(t.lastCode('+523311112222', 'invite-code'));
  });

  test('no se repiten cargos del mismo mes', async () => {
    const first = await staff.post('/platform/invoices/generate', { period: '2030-01' });
    const second = await staff.post('/platform/invoices/generate', { period: '2030-01' });
    assert.ok(first.body.created >= 2);
    assert.equal(second.body.created, 0);
  });
});
