// Composición de la API: crea dependencias, registra plugins y rutas. No abre puertos (ver server.js),
// así las pruebas pueden usar `app.inject()` sin red.
import Fastify from 'fastify';
import { migrate, openDatabase } from './db/database.js';
import { createEventBus } from './lib/events.js';
import { createDispatcher, createProviders } from './messaging/dispatcher.js';
import { createTemplates } from './messaging/templates.js';
import { createEcartPay } from './payments/ecartpay.js';
import { accountsRepository } from './repositories/accounts.js';
import { platformRepository } from './repositories/platform.js';
import { sessionsRepository } from './repositories/sessions.js';
import { tenantsRepository } from './repositories/tenants.js';
import { whatsappRepository } from './repositories/whatsapp.js';
import securityPlugin from './plugins/security.js';
import authPlugin from './plugins/auth.js';
import { createAuthService } from './modules/auth/service.js';
import { createAccountsService } from './modules/accounts/service.js';
import { createTenantService } from './modules/tenant/service.js';
import { createPlatformService } from './modules/platform/service.js';
import { createWhatsappService } from './modules/whatsapp/service.js';
import authRoutes from './modules/auth/routes.js';
import meRoutes from './modules/me/routes.js';
import tenantRoutes, { ecartpayWebhookRoutes } from './modules/tenant/routes.js';
import accountsRoutes from './modules/accounts/routes.js';
import platformRoutes from './modules/platform/routes.js';
import eventsRoutes from './modules/events/routes.js';
import devRoutes from './modules/dev/routes.js';
import deviceRoutes from './modules/devices/routes.js';
import whatsappWebhookRoutes from './modules/whatsapp/routes.js';

/** Crea las dependencias de la aplicación (base de datos, repositorios y servicios). */
export function createContext(config, { db = openDatabase(config.DATABASE_PATH), log = console } = {}) {
  migrate(db);
  const repos = {
    db,
    accounts: accountsRepository(db),
    sessions: sessionsRepository(db),
    tenants: tenantsRepository(db),
    platform: platformRepository(db),
    whatsapp: whatsappRepository(db),
  };
  const events = createEventBus();
  const templates = createTemplates(config.APP_URL);
  const dispatch = createDispatcher({ repos, providers: createProviders(config, log), log });
  const deps = { repos, config, templates, dispatch, events };

  const authService = createAuthService(deps);
  const accountsService = createAccountsService(deps);
  const tenantService = createTenantService({ ...deps, ecartpay: createEcartPay(config) });
  const platformService = createPlatformService({ ...deps, accountsService });
  const whatsappService = createWhatsappService({ ...deps, tenantService, log });
  return { ...deps, authService, accountsService, tenantService, platformService, whatsappService };
}

export async function buildApp(config, options = {}) {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
      ...(config.isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    forceCloseConnections: true, // cierra también las conexiones de avisos en tiempo real
  });
  const ctx = options.context ?? createContext(config, { db: options.db, log: app.log });
  app.decorate('ctx', ctx);

  await app.register(securityPlugin, { config });
  await app.register(authPlugin, { config, authService: ctx.authService });

  await app.register(
    async (api) => {
      api.get('/health', async () => {
        ctx.repos.db.prepare('SELECT 1').get();
        return { status: 'ok' };
      });
      await api.register(authRoutes, { prefix: '/auth', ...ctx });
      await api.register(meRoutes, { prefix: '/me', ...ctx });
      await api.register(tenantRoutes, { prefix: '/tenant', ...ctx });
      await api.register(accountsRoutes, { prefix: '/tenants/:tenantId/users', ...ctx });
      await api.register(platformRoutes, { prefix: '/platform', ...ctx });
      await api.register(eventsRoutes, { prefix: '/events', ...ctx });
      await api.register(ecartpayWebhookRoutes, { prefix: '/webhooks', ...ctx });
      await api.register(whatsappWebhookRoutes, { prefix: '/webhooks/whatsapp', ...ctx });
      await api.register(deviceRoutes, { prefix: '/devices', ...ctx });
      if (!config.isProd && config.MESSAGING_PROVIDER === 'console') await api.register(devRoutes, { prefix: '/dev', ...ctx });
    },
    { prefix: '/api/v1' },
  );

  // Limpieza periódica de sesiones y retos vencidos
  const purge = setInterval(() => {
    const now = new Date().toISOString();
    ctx.repos.sessions.purgeExpired(now);
    ctx.repos.accounts.purgeExpiredChallenges(now);
    ctx.repos.whatsapp.purge(new Date(Date.now() - 7 * 86400e3).toISOString());
  }, 10 * 60e3);
  purge.unref();
  app.addHook('onClose', async () => {
    clearInterval(purge);
    if (!options.db) ctx.repos.db.close();
  });
  return app;
}
