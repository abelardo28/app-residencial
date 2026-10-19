// Conexión a SQLite (módulo nativo de Node, sin dependencias) y migraciones versionadas.
// Para producción con varias instancias se recomienda PostgreSQL: las consultas están concentradas
// en `src/repositories`, que es lo único que habría que adaptar.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

/** Aplica en orden las migraciones `NNN_nombre.sql` que aún no se han ejecutado. */
export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((r) => r.name),
  );
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !done.has(f))
    .sort();
  for (const file of pending) {
    transaction(db, () => {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    });
  }
  return pending;
}

/** Ejecuta `fn` dentro de una transacción; si lanza un error, se revierte todo. */
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const json = (value) => JSON.stringify(value ?? null);
export const parseJson = (text, fallback = null) => {
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};
