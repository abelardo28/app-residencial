import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_INVITE } from '@residencial/shared/demo';
import { createTestApp } from './helpers.js';

describe('activación de cuenta por invitación', () => {
  let t;
  before(async () => (t = await createTestApp()));
  after(() => t.close());
  const email = 'mariana@correo.mx';
  const { token, code } = DEMO_INVITE;

  test('el enlace solo funciona con el correo correcto', async () => {
    const c = t.client();
    assert.equal((await c.post('/auth/activation/check', { email: 'otro@correo.mx', token })).status, 400);
    const ok = await c.post('/auth/activation/check', { email, token });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.name, 'Mariana López');
  });

  test('una cuenta pendiente no puede iniciar sesión', async () => {
    assert.equal((await t.client().login(email, 'Cualquiera#2026')).status, 401);
  });

  test('rechaza contraseñas débiles', async () => {
    const res = await t.client().post('/auth/activation/complete', { email, token, code, password: 'corta' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'weak_password');
  });

  test('activa la cuenta y el enlace queda inutilizado', async () => {
    const c = t.client();
    const password = 'Girasol#Azul2026';
    assert.equal((await c.post('/auth/activation/complete', { email, token, code, password })).status, 200);
    assert.equal((await c.post('/auth/activation/complete', { email, token, code, password })).status, 400);
    assert.equal((await c.login(email, password)).status, 200);
  });

  test('el administrador restablece una contraseña y cierra las sesiones', async () => {
    const carlos = t.client();
    await carlos.login('carlos@correo.mx');
    const admin = t.client();
    await admin.login('admin@residencial.mx');
    assert.equal((await admin.post('/tenants/t1/users/res2/reset-password')).status, 204);
    assert.equal((await carlos.get('/me/snapshot')).status, 401, 'la sesión anterior se cierra');
    assert.equal((await t.client().login('carlos@correo.mx')).status, 401, 'la contraseña anterior ya no sirve');
    const message = t.repos.platform.recentMessages(50).find((m) => m.to === 'carlos@correo.mx' && m.meta.kind === 'invite');
    assert.ok(message.meta.link.includes('#/activar?t='));
  });

  test('un residente no puede restablecer cuentas', async () => {
    const ana = t.client();
    await ana.login('ana@correo.mx');
    assert.equal((await ana.post('/tenants/t1/users/res3/reset-password')).status, 403);
  });
});
