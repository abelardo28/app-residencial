// Cabeceras de seguridad, CORS, límite de solicitudes y formato de errores.
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { errorHandler } from '../lib/errors.js';

async function security(app, { config }) {
  // La API sólo responde JSON: la política de contenido más estricta posible.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });
  await app.register(rateLimit, {
    global: true,
    max: config.isTest ? 10_000 : 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/api/v1/events'),
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Ruta no encontrada.' } }));
}

export default fp(security, { name: 'security' });

/** Límite estricto para rutas de autenticación (intentos por IP). */
export const authRateLimit = (config) => ({ rateLimit: { max: config.isTest ? 1000 : 10, timeWindow: '1 minute' } });
