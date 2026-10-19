import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers.js';

describe('autenticación', () => {
  let t;
  before(async () => (t = await createTestApp()));
  after(() => t.close());

  test('un residente inicia sesión y recibe una cookie HttpOnly', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ana@correo.mx', password: 'Demo#2026' } });
    assert.equal(res.statusCode, 200);
    const cookie = res.cookies.find((c) => c.name === 'sid');
    assert.ok(cookie.httpOnly);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(res.json().session.userId, 'res1');
    assert.ok(!JSON.stringify(res.json()).includes(cookie.value), 'el token de sesión no viaja en el cuerpo');
  });

  test('correo inexistente y contraseña incorrecta dan el mismo mensaje', async () => {
    const c = t.client();
    const a = await c.post('/auth/login', { email: 'nadie@correo.mx', password: 'x' });
    const b = await c.post('/auth/login', { email: 'carlos@correo.mx', password: 'incorrecta' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
  });

  test('bloquea la cuenta después de 5 intentos fallidos', async () => {
    const c = t.client();
    for (let i = 0; i < 4; i++) assert.equal((await c.post('/auth/login', { email: 'roberto@correo.mx', password: 'mala' })).status, 401);
    assert.equal((await c.post('/auth/login', { email: 'roberto@correo.mx', password: 'mala' })).status, 423);
    // Ni con la contraseña correcta entra mientras está bloqueada
    assert.equal((await c.login('roberto@correo.mx')).status, 423);
  });

  test('el administrador necesita el código de verificación', async () => {
    const c = t.client();
    const first = await c.post('/auth/login', { email: 'admin@residencial.mx', password: 'Demo#2026' });
    assert.ok(first.body.mfa.challengeId);
    assert.equal(c.state.sid, null, 'sin código no hay sesión');
    const wrong = await c.post('/auth/mfa', { challengeId: first.body.mfa.challengeId, code: '000000' });
    assert.equal(wrong.status, 401);
    const code = t.lastCode('+525512340001', 'mfa');
    const ok = await c.post('/auth/mfa', { challengeId: first.body.mfa.challengeId, code });
    assert.equal(ok.status, 200);
    // El código es de un solo uso
    assert.equal((await t.client().post('/auth/mfa', { challengeId: first.body.mfa.challengeId, code })).status, 401);
  });

  test('las peticiones que modifican datos exigen el token CSRF', async () => {
    const c = t.client();
    await c.login('sofia@correo.mx');
    const res = await c.post('/tenant/sos', { kind: 'Prueba' }, { csrf: false });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'csrf');
  });

  test('cerrar sesión invalida la cookie en el servidor', async () => {
    const c = t.client();
    await c.login('carlos@correo.mx');
    const sid = c.state.sid;
    assert.equal((await c.get('/auth/session')).status, 200);
    assert.equal((await c.post('/auth/logout')).status, 204);
    c.state.sid = sid; // aunque alguien conserve la cookie, ya no sirve
    assert.equal((await c.get('/auth/session')).status, 401);
  });

  test('sin sesión no hay datos', async () => {
    assert.equal((await t.client().get('/me/snapshot')).status, 401);
  });
});
