// /api/v1/tenants/:tenantId/users — alta e invitación de cuentas, restablecimiento y suspensión.
// Quién puede hacerlo lo decide el servicio (administrador del residencial o personal de la empresa).
import { z } from 'zod';
import { ROLES } from '@residencial/shared';
import { parse } from '../../lib/validate.js';

const InviteBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(30),
  role: z.enum(ROLES),
  unitId: z.string().max(64).optional(),
  vehicles: z.array(z.string().max(12)).max(10).optional(),
  shift: z.string().max(40).optional(),
});
const SuspensionBody = z.object({ suspended: z.boolean() });

export default async function accountsRoutes(app, { accountsService }) {
  app.addHook('preHandler', app.authenticate);
  const p = (req) => [req.account, req.params.tenantId, req.params.userId];

  app.post('/', async (req, reply) =>
    reply.status(201).send(accountsService.invite(req.account, req.params.tenantId, parse(InviteBody, req.body))),
  );
  app.post('/:userId/invite', async (req, reply) => (accountsService.resendInvite(...p(req)), reply.status(204).send()));
  app.post('/:userId/reset-password', async (req, reply) => (accountsService.resetPassword(...p(req)), reply.status(204).send()));
  app.post(
    '/:userId/suspension',
    async (req, reply) => (accountsService.setSuspended(...p(req), parse(SuspensionBody, req.body).suspended), reply.status(204).send()),
  );
  app.post('/:userId/unlock', async (req, reply) => (accountsService.unlock(...p(req)), reply.status(204).send()));
  app.delete('/:userId', async (req, reply) => (accountsService.remove(...p(req)), reply.status(204).send()));
}
