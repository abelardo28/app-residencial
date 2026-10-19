// Tareas de base de datos: `npm run db:migrate` y `npm run db:seed`.
import { loadConfig } from '../config.js';
import { createContext } from '../app.js';
import { migrate, openDatabase } from './database.js';
import { seedDemo } from './seed.js';

const config = loadConfig();
const command = process.argv[2];

if (command === 'migrate') {
  const applied = migrate(openDatabase(config.DATABASE_PATH));
  console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'La base de datos ya está al día.');
} else if (command === 'seed') {
  if (config.isProd) throw new Error('No se cargan datos de demostración en producción.');
  const ctx = createContext(config);
  console.log((await seedDemo(ctx.repos, config)) ? 'Datos de demostración cargados.' : 'La base ya tenía datos; no se cambió nada.');
} else {
  console.error('Uso: node src/db/cli.js <migrate|seed>');
  process.exit(1);
}
