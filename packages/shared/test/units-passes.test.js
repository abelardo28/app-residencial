import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTx, runOperation, DomainError } from '../src/index.js';
import { evaluatePass, parseInput } from '../src/access.js';
import { unitByReference, unitReference } from '../src/ledger.js';
import { seedTenant } from '../src/demo/seed.js';

const sign = (payload) => createHmac('sha256', 'test').update(payload).digest('base64url').slice(0, 16);
const run = (db, userId, name, input) => {
  const t = createTx({ ...db });
  const result = runOperation(name, t, { user: db.users.find((u) => u.id === userId), sign, trusted: {} }, input);
  return { result, next: t.next };
};
const db = seedTenant({ sign });
const admin = db.users.find((u) => u.role === 'admin').id;

describe('domicilios', () => {
  test('agregar y quitar casas no cambia la referencia de las demás', () => {
    const before = Object.fromEntries(db.units.map((u) => [u.id, unitReference(db, u.id)]));
    const { result: added, next } = run(db, admin, 'saveUnit', { label: 'Casa 13', street: 'Privada Encino' });
    // Simula el orden de la base de datos (lo más reciente primero)
    const reordered = { ...next, units: [...next.units].reverse() };
    for (const [id, ref] of Object.entries(before)) assert.equal(unitReference(reordered, id), ref);
    assert.equal(unitByReference(reordered, unitReference(reordered, added.id)).id, added.id);
    assert.notEqual(unitReference(reordered, added.id), before.u12);
    const removed = run(next, admin, 'deleteUnit', { id: added.id }).next;
    for (const [id, ref] of Object.entries(before)) assert.equal(unitReference(removed, id), ref);
  });

  test('no se duplica un nombre ni se elimina una casa con residentes o historial', () => {
    assert.throws(() => run(db, admin, 'saveUnit', { label: 'casa 1' }), /Ya existe/);
    assert.throws(() => run(db, admin, 'deleteUnit', { id: 'u3' }), /residente/);
    const renamed = run(db, admin, 'saveUnit', { id: 'u3', label: 'Casa 3-A' }).next;
    assert.equal(renamed.units.find((u) => u.id === 'u3').label, 'Casa 3-A');
    const resident = db.users.find((u) => u.role === 'resident').id;
    assert.throws(() => run(db, resident, 'saveUnit', { label: 'Mía' }), DomainError);
  });
});

describe('cambiar el código de un pase', () => {
  const resident = db.users.find((u) => u.role === 'resident');
  const input = {
    visitorName: 'Mario',
    type: 'familiar',
    mode: 'multi',
    validFrom: new Date(Date.now() - 3600e3).toISOString(),
    validTo: new Date(Date.now() + 5 * 864e5).toISOString(),
    maxUses: 5,
    days: [],
    timeFrom: '00:00',
    timeTo: '23:59',
  };

  test('el código y el QR anteriores dejan de funcionar; el nuevo conserva los datos', () => {
    const { result: old, next } = run(db, resident.id, 'createPass', input);
    const { result: fresh, next: after } = run(next, resident.id, 'regeneratePass', { id: old.id });
    assert.notEqual(fresh.code, old.code);
    assert.notEqual(fresh.token, old.token);
    assert.deepEqual([fresh.visitorName, fresh.validTo, fresh.maxUses], ['Mario', old.validTo, 5]);
    const stale = after.passes.find((p) => p.id === parseInput(old.token, sign).id);
    assert.match(evaluatePass(stale).reason, /generó uno nuevo/);
    assert.equal(evaluatePass(after.passes.find((p) => p.id === fresh.id)).ok, true);
    // Un pase ya reemplazado no se vuelve a regenerar
    assert.throws(() => run(after, resident.id, 'regeneratePass', { id: old.id }), /vigente/);
  });

  test('sólo quien creó el pase puede cambiar su código', () => {
    const { result: old, next } = run(db, resident.id, 'createPass', input);
    const other = db.users.find((u) => u.role === 'resident' && u.id !== resident.id).id;
    assert.throws(() => run(next, other, 'regeneratePass', { id: old.id }), /Sólo quien creó/);
  });
});
