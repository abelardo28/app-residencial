// /api/v1/tenant — una ruta por operación del residencial (contrato en @residencial/shared/routes.js)
// más los cobros con Ecart Pay.
import { z } from 'zod';
import { OPERATIONS, OPERATION_ROUTES } from '@residencial/shared';
import { parse } from '../../lib/validate.js';
import { OPERATION_SCHEMAS } from './schemas.js';

const MB = 1024 * 1024;
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const CheckoutBody = z.object({ periods: z.array(period).min(1).max(24) });
const CardBody = z.object({ saveCard: z.boolean().default(false) });
const TransferBody = z.object({ reference: z.string().trim().max(80).default(''), receipt: z.string().max(5 * MB) });
const AutopayBody = z.object({ enabled: z.boolean() });

export default async function tenantRoutes(app, { tenantService, subscriptionService: sub }) {
  for (const [name, route] of Object.entries(OPERATION_ROUTES)) {
    app.route({
      method: route.method,
      url: route.path,
      bodyLimit: 16 * MB, // fotos y adjuntos (hasta 3 de 3 MB) como data URL
      preHandler: [app.authenticate, app.requireTenant(OPERATIONS[name].roles)],
      handler: async (req) => {
        const input = parse(OPERATION_SCHEMAS[name], { ...(req.body || {}), ...req.params });
        return { result: tenantService.execute(req.account, name, input) };
      },
    });
  }

  const resident = { preHandler: [app.authenticate, app.requireTenant(['resident'])] };
  app.post('/payments/ecartpay/checkout', resident, async (req) =>
    tenantService.createCheckout(req.account, parse(CheckoutBody, req.body)),
  );
  app.post('/payments/ecartpay/:id/confirm', resident, async (req) => tenantService.confirmCheckout(String(req.params.id), req.account));

  // Suscripción del residencial con la empresa. Disponible aunque el servicio esté suspendido, para poder pagarla.
  const admin = { preHandler: [app.authenticate, app.requireTenant(['admin'])], config: { allowSuspended: true } };
  const id = (req) => String(req.params.id);
  app.post('/subscription/invoices/:id/checkout', admin, async (req) =>
    sub.startCardPayment(req.account, id(req), parse(CardBody, req.body || {})),
  );
  app.post('/subscription/checkouts/:id/confirm', admin, async (req) => sub.confirmCardPayment(id(req), req.account));
  app.post('/subscription/invoices/:id/transfer', { ...admin, bodyLimit: 6 * MB }, async (req, reply) => {
    sub.submitTransfer(req.account, id(req), parse(TransferBody, req.body));
    return reply.status(204).send();
  });
  app.put('/subscription/autopay', admin, async (req, reply) => {
    sub.setAutopay(req.account, parse(AutopayBody, req.body).enabled);
    return reply.status(204).send();
  });
  app.delete('/subscription/card', admin, async (req, reply) => {
    sub.removeCard(req.account);
    return reply.status(204).send();
  });
}

/** Aviso (webhook) de Ecart Pay. Necesita el cuerpo sin procesar para validar la firma. */
export async function ecartpayWebhookRoutes(app, { tenantService }) {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.post('/ecartpay', async (req) => tenantService.webhook(req.body, req.headers['x-ecartpay-signature']));
}
