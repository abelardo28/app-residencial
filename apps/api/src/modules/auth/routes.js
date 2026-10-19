// /api/v1/auth — inicio de sesión, verificación en dos pasos, activación y cierre de sesión.
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { authRateLimit } from '../../plugins/security.js';
import { SESSION_COOKIE } from '../../plugins/auth.js';

const email = z.string().trim().max(200);
const LoginBody = z.object({ email, password: z.string().min(1).max(200), scope: z.enum(['tenant', 'platform']).default('tenant') });
const MfaBody = z.object({
  challengeId: z.string().min(1).max(64),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Código de 6 dígitos'),
});
const ActivationCheckBody = z.object({ email, token: z.string().min(1).max(200), code: z.string().trim().max(10).optional() });
const ActivationBody = ActivationCheckBody.extend({ code: z.string().trim().max(10), password: z.string().min(1).max(200) });

/** Datos de sesión que recibe la APP (el token de la cookie nunca viaja en el cuerpo). */
export const sessionView = (session, acc) => ({
  kind: acc.scope,
  tenantId: acc.tenantId,
  userId: acc.id,
  expiresAt: session.expiresAt,
  csrfToken: session.csrfToken,
});

export default async function authRoutes(app, { config, authService }) {
  const meta = (req) => ({ ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) });
  const strict = { config: authRateLimit(config) };
  const signIn = (reply, { session, account }) => {
    reply.setSessionCookie(session);
    return { session: sessionView(session, account) };
  };

  app.post('/login', strict, async (req, reply) => {
    const result = await authService.login(parse(LoginBody, req.body), meta(req));
    return result.mfa ? { mfa: result.mfa } : signIn(reply, result);
  });

  app.post('/mfa', strict, async (req, reply) => signIn(reply, authService.verifyMfa(parse(MfaBody, req.body), meta(req))));

  app.post('/activation/check', strict, async (req) => authService.checkActivation(parse(ActivationCheckBody, req.body)));

  app.post('/activation/complete', strict, async (req) => authService.completeActivation(parse(ActivationBody, req.body)));

  // Sesión actual. Responde 200 también sin sesión (`session: null`) para que la APP lo consulte al abrir.
  app.get('/session', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return { session: null };
    try {
      const { session, account } = authService.resolveSession(token);
      return { session: sessionView(session, account) };
    } catch (err) {
      reply.clearSessionCookie();
      return { session: null, message: err.message };
    }
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    let account = null;
    try {
      ({ account } = authService.resolveSession(token, { touch: false }));
    } catch {
      /* la sesión ya no era válida: sólo se borra la cookie */
    }
    authService.logout(token, account);
    reply.clearSessionCookie();
    return reply.status(204).send();
  });
}
