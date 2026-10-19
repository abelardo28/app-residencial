// /api/v1/platform — portal de la empresa. Sólo personal de la empresa (con verificación en dos pasos).
import { z } from 'zod';
import { parse } from '../../lib/validate.js';

const text = (max) => z.string().trim().max(max);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const ResidencialBody = z.object({
  name: text(120).min(1),
  address: text(200).default(''),
  plan: text(40),
  unitCount: z.coerce.number().int().min(1).max(2000),
  unitPrefix: text(30).default('Casa'),
  monthlyFee: z.coerce.number().nonnegative().max(1_000_000),
  admin: z.object({ name: text(120).min(1), email: text(200), phone: text(30) }),
});
const StatusBody = z.object({ status: z.enum(['active', 'suspended']), reason: text(200).default('') });
const PlanBody = z.object({ plan: text(40) });
const PayBody = z.object({ method: z.enum(['transfer', 'card', 'cash', 'ecartpay']), reference: text(80).default('') });
const GenerateBody = z.object({ period: period.optional() });
const OverdueBody = z.object({ days: z.number().int().min(1).max(120).default(15) });
const PlanUpdateBody = z.object({
  name: text(60).min(1).optional(),
  price: z.number().nonnegative().max(1_000_000).optional(),
  maxUnits: z.number().int().min(1).max(100_000).optional(),
  features: z.array(text(120)).max(20).optional(),
});

export default async function platformRoutes(app, { platformService: s }) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireStaff);
  const ok = (reply) => reply.status(204).send();

  app.post('/residencias', async (req, reply) => reply.status(201).send(s.createResidencial(req.account, parse(ResidencialBody, req.body))));
  app.patch('/residencias/:id/status', async (req, reply) => {
    const { status, reason } = parse(StatusBody, req.body);
    s.setResidencialStatus(req.account, req.params.id, status, reason);
    return ok(reply);
  });
  app.patch('/residencias/:id/plan', async (req, reply) => (s.changePlan(req.account, req.params.id, parse(PlanBody, req.body).plan), ok(reply)));
  app.post('/residencias/suspend-overdue', async (req) => s.suspendOverdue(req.account, parse(OverdueBody, req.body).days));

  app.post('/invoices/generate', async (req) => s.generateInvoices(req.account, parse(GenerateBody, req.body).period));
  app.post('/invoices/:id/pay', async (req, reply) => (s.payInvoice(req.account, req.params.id, parse(PayBody, req.body)), ok(reply)));
  app.post('/invoices/:id/cancel', async (req, reply) => (s.cancelInvoice(req.account, req.params.id), ok(reply)));
  app.post('/invoices/:id/remind', async (req, reply) => (s.remindInvoice(req.account, req.params.id), ok(reply)));

  app.patch('/plans/:id', async (req, reply) => (s.updatePlan(req.account, req.params.id, parse(PlanUpdateBody, req.body)), ok(reply)));
}
