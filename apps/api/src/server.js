// Punto de entrada: valida la configuración, levanta el servidor y cierra ordenadamente.
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { seedDemo } from './db/seed.js';

const config = loadConfig();
process.env.TZ = config.TZ;
const app = await buildApp(config);

if (config.SEED_DEMO && (await seedDemo(app.ctx.repos, config))) app.log.info('Datos de demostración cargados');

// Reintenta los mensajes pendientes (por ejemplo, si el proveedor no respondió)
const retry = setInterval(() => app.ctx.dispatch().catch((err) => app.log.error({ err }, 'Error en el despachador')), 30_000);

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Cerrando servidor');
  clearInterval(retry);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.fatal({ err }, 'No se pudo iniciar el servidor');
  process.exit(1);
}
