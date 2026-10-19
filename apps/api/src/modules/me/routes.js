// /api/v1/me — la vista de datos del usuario con sesión, ya filtrada según su rol.
import { sessionView } from '../auth/routes.js';

export default async function meRoutes(app, { tenantService, platformService }) {
  app.get('/snapshot', { preHandler: app.authenticate }, async (req, reply) => {
    const acc = req.account;
    reply.header('Cache-Control', 'no-store');
    return {
      session: sessionView(req.session, acc),
      root: acc.scope === 'platform' ? platformService.snapshot() : tenantService.snapshot(acc),
    };
  });
}
