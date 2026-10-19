// Sesión por cookie + protección CSRF.
// - La cookie `sid` es HttpOnly (JavaScript no la puede leer), SameSite=Strict y Secure en producción.
// - Toda petición que modifica datos debe traer la cabecera X-CSRF-Token que se entregó al iniciar sesión.
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import { safeEqual } from '../lib/crypto.js';
import { HttpError, forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'sid';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function auth(app, { config, authService }) {
  await app.register(cookie);
  app.decorateRequest('account', null);
  app.decorateRequest('session', null);

  app.decorateReply('setSessionCookie', function setSessionCookie(session) {
    return this.setCookie(SESSION_COOKIE, session.token, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      expires: new Date(session.expiresAt),
    });
  });
  app.decorateReply('clearSessionCookie', function clearSessionCookie() {
    return this.clearCookie(SESSION_COOKIE, { path: '/api' });
  });

  /** preHandler: exige sesión válida y, si la petición modifica datos, el token CSRF. */
  app.decorate('authenticate', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    try {
      const { session, account } = authService.resolveSession(token);
      request.session = session;
      request.account = account;
    } catch (err) {
      if (token) reply.clearSessionCookie();
      throw err;
    }
    if (!SAFE_METHODS.has(request.method) && !safeEqual(request.headers['x-csrf-token'], request.session.csrfToken)) {
      throw new HttpError(403, 'La sesión no es válida para esta acción. Recarga la página.', 'csrf');
    }
  });

  /** preHandler: sólo usuarios de un residencial (opcionalmente con ciertos roles). */
  app.decorate('requireTenant', (roles) => async (request) => {
    const acc = request.account;
    if (!acc) throw unauthorized();
    if (acc.scope !== 'tenant' || (roles && !roles.includes(acc.role))) throw forbidden();
  });

  /** preHandler: sólo personal de la empresa. */
  app.decorate('requireStaff', async (request) => {
    if (request.account?.scope !== 'platform') throw forbidden();
  });
}

export default fp(auth, { name: 'auth', dependencies: ['security'] });
