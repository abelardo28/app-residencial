import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { botTurn } from '../src/whatsapp.js';
import { providerIn, todayFor } from '../src/access.js';
import { createTx } from '../src/tx.js';
import { runOperation } from '../src/operations.js';
import { seedTenant } from '../src/demo/seed.js';

const sign = (payload) => createHmac('sha256', 'test').update(payload).digest('base64url').slice(0, 16);
const ask = (db, text) =>
  botTurn({
    tenant: db,
    user: db.users.find((u) => u.id === 'res1'),
    text,
    exec: () => {},
    links: { app: (p) => p, pass: () => '' },
  }).replies.join('\n');
const garbageToday = (db) => {
  const t = createTx({ ...db });
  runOperation(
    'generalAccess',
    t,
    { user: db.users.find((u) => u.id === 'grd1'), sign, trusted: {} },
    { provider: 'Recolección de basura', plate: 'SM04821' },
  );
  return t.next;
};

test('reconoce el servicio en una pregunta libre', () => {
  const db = seedTenant({ sign });
  assert.equal(providerIn(db, '¿Ya pasó la basura?'), 'Recolección de basura');
  assert.equal(providerIn(db, 'ya vino el camion del GAS'), 'Gas');
  assert.equal(providerIn(db, 'hola'), undefined);
});

test('«¿ya pasó la basura?» responde si entró hoy o cuándo fue la última vez', () => {
  const db = seedTenant({ sign });
  assert.match(ask(db, '¿Ya pasó la basura?'), /Hoy todavía no entra \*Recolección de basura\*\. La última vez fue el/);
  const after = garbageToday(db);
  assert.match(ask(after, 'ya paso la basura'), /Sí, \*Recolección de basura\* entró hoy a las/);
  assert.ok(todayFor(after, 'u3').services.find((s) => s.name === 'Recolección de basura').today);
});

test('«¿ya entró alguien?» lista las visitas de la casa y los servicios de hoy', () => {
  const db = garbageToday(seedTenant({ sign }));
  const text = ask(db, '¿Ya entró alguien a mi casa?');
  assert.match(text, /Servicios de hoy\*\n• Recolección de basura/);
  assert.equal(ask(db, '4'), text);
});
