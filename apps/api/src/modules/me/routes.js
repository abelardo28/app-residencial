// /api/v1/me — la vista de datos del usuario con sesión (ya filtrada según su rol) y su propio perfil.
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { authRateLimit } from '../../plugins/security.js';
import { sessionView } from '../auth/routes.js';

const ProfileBody = z.object({ name: z.string().trim().min(1).max(120) });
const PasswordBody = z.object({ current: z.string().min(1).max(200), password: z.string().min(1).max(200) });

export default async function meRoutes(app, { config, authService, tenantService, platformService }) {
  const own = { preHandler: app.authenticate, config: { allowSuspended: true } };
  app.get('/snapshot', own, async (req, reply) => {
    const acc = req.account;
    reply.header('Cache-Control', 'no-store');
    return {
      session: sessionView(req.session, acc),
      root: acc.scope === 'platform' ? platformService.snapshot() : tenantService.snapshot(acc),
    };
  });

  app.patch('/profile', own, async (req) => authService.updateProfile(req.account, parse(ProfileBody, req.body)));

  app.post('/password', { ...own, config: { ...own.config, ...authRateLimit(config) } }, async (req) =>
    authService.changePassword(req.account, req.session.token, parse(PasswordBody, req.body)),
  );
}
