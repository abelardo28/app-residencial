import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankAccountLabel, bankAccounts } from '../src/index.js';

test('bankAccounts acepta el formato anterior de una sola cuenta', () => {
  const old = { bank: { name: 'BBVA', clabe: '012 180 0011 2233 4455', holder: 'A.C.' } };
  assert.deepEqual(
    bankAccounts(old).map((a) => [a.id, a.primary]),
    [['principal', true]],
  );
  assert.deepEqual(bankAccounts({ bank: { name: '', clabe: '', holder: '' } }), []);
});

test('la cuenta principal va primero y la etiqueta sólo muestra los últimos dígitos', () => {
  const list = bankAccounts({
    bankAccounts: [
      { id: 'a', alias: 'Reservas', name: 'Banorte', clabe: '072 180 0099 8877 6655', primary: false },
      { id: 'b', alias: '', name: 'BBVA', clabe: '012 180 0011 2233 4455', primary: true },
    ],
  });
  assert.deepEqual(
    list.map((a) => a.id),
    ['b', 'a'],
  );
  assert.equal(bankAccountLabel(list[1]), 'Reservas · Banorte ···6655');
  assert.equal(bankAccountLabel(list[0]), 'BBVA ···4455');
});
