import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, PASSWORD, passInput } from './helpers.js';

describe('perfil propio, domicilios y pases', () => {
  let t, ana, admin;
  const tenantOf = async (client) => (await client.get('/me/snapshot')).body.root.tenants.t1;
  before(async () => {
    t = await createTestApp();
    [ana, admin] = [t.client(), t.client()];
    await ana.login('ana@correo.mx');
    await admin.login('admin@residencial.mx');
  });
  after(() => t.close());

  test('la persona cambia su nombre', async () => {
    assert.equal((await ana.patch('/me/profile', { name: 'Ana Torres Ruiz' })).status, 200);
    const me = (await tenantOf(ana)).users.find((u) => u.email === 'ana@correo.mx');
    assert.equal(me.name, 'Ana Torres Ruiz');
  });

  test('cambiar la contraseña pide la actual y cierra las otras sesiones', async () => {
    const other = t.client();
    await other.login('ana@correo.mx');
    assert.equal((await ana.post('/me/password', { current: 'equivocada', password: 'Nueva#Clave2027' })).status, 400);
    assert.equal((await ana.post('/me/password', { current: PASSWORD, password: 'corta' })).status, 400);
    assert.equal((await ana.post('/me/password', { current: PASSWORD, password: 'Nueva#Clave2027' })).status, 200);
    assert.equal((await ana.get('/me/snapshot')).status, 200, 'la sesión actual sigue abierta');
    assert.equal((await other.get('/me/snapshot')).status, 401, 'las demás se cierran');
    const fresh = t.client();
    assert.equal((await fresh.login('ana@correo.mx', 'Nueva#Clave2027')).status, 200);
  });

  test('administración agrega y elimina domicilios', async () => {
    const { body } = await admin.post('/tenant/units', { label: 'Casa 99', street: 'Privada Olivo' });
    const unit = body.result;
    assert.ok((await tenantOf(admin)).units.some((u) => u.id === unit.id));
    assert.equal((await ana.post('/tenant/units', { label: 'Casa 100' })).status, 403);
    assert.equal((await admin.delete(`/tenant/units/u3`)).status, 409);
    assert.equal((await admin.delete(`/tenant/units/${unit.id}`)).status, 200);
  });

  test('el residente cambia el código de un pase vigente', async () => {
    const created = (await ana.post('/tenant/passes', passInput())).body.result;
    const fresh = (await ana.post(`/tenant/passes/${created.id}/regenerate`)).body.result;
    assert.notEqual(fresh.code, created.code);
    const guard = t.client();
    await guard.login('caseta@residencial.mx');
    assert.equal((await guard.post('/tenant/access/check', { text: created.token })).body.result.ok, false);
    assert.equal((await guard.post('/tenant/access/check', { text: fresh.token })).body.result.ok, true);
  });
});
