import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueForAutopay, dueForReminder, invoiceState, reactivatesAfterPayment, receiptError, subscriptionReference } from '../src/index.js';

const now = new Date('2026-10-20T15:00:00Z');
const inv = (over = {}) => ({ id: 'i', tenantId: 't1', period: '2026-10', status: 'pending', dueDate: '2026-10-22', ...over });

test('estados de un cargo de suscripción', () => {
  assert.equal(invoiceState(inv(), now), 'pending');
  assert.equal(invoiceState(inv({ dueDate: '2026-10-10' }), now), 'overdue');
  assert.equal(invoiceState(inv({ review: { submittedAt: 'x' } }), now), 'review');
  assert.equal(invoiceState(inv({ review: { rejectedAt: 'x' }, dueDate: '2026-10-10' }), now), 'overdue');
  assert.equal(invoiceState(inv({ status: 'paid' }), now), 'paid');
  assert.equal(subscriptionReference(inv()), 'SUS-T1-202610');
});

test('recordatorio y cobro automático', () => {
  const card = { autopay: true, card: { last4: '4242' } };
  assert.equal(dueForReminder(inv(), null, now), true);
  assert.equal(dueForReminder(inv({ dueDate: '2026-10-30' }), null, now), false);
  assert.equal(dueForReminder(inv({ remindedAt: 'x' }), null, now), false);
  assert.equal(dueForReminder(inv(), card, now), false, 'con cobro automático no se recuerda');
  assert.equal(dueForAutopay(inv(), card, now), true);
  assert.equal(dueForAutopay(inv({ autopayAttemptAt: '2026-10-20T01:00:00Z' }), card, now), false);
  assert.equal(dueForAutopay(inv({ review: { submittedAt: 'x' } }), card, now), false);
});

test('reactivación al ponerse al corriente y validación del comprobante', () => {
  const res = { id: 't1', status: 'suspended', statusReason: 'Adeudo mayor a 15 días' };
  assert.equal(reactivatesAfterPayment(res, [inv({ status: 'paid', dueDate: '2026-09-10' })], now), true);
  assert.equal(reactivatesAfterPayment(res, [inv({ dueDate: '2026-09-10' })], now), false);
  assert.equal(reactivatesAfterPayment({ ...res, statusReason: 'Otro motivo' }, [], now), false);
  assert.equal(receiptError('data:image/png;base64,aG9sYQ=='), null);
  assert.match(receiptError('data:text/html;base64,aG9sYQ=='), /imagen o un PDF/);
  assert.match(receiptError(''), /Adjunta/);
});
