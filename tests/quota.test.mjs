import test from 'node:test';
import assert from 'node:assert/strict';
import {dollarsToCents, balance} from '../web/quota.js';
test('USD parsing never uses floating-point multiplication on fractional input', () => {
  assert.equal(dollarsToCents('0.29'), 29);
  assert.equal(dollarsToCents('50.5'), 5050);
  for (const v of ['0', '-1', 'NaN', '1e3', '1.001', 'Infinity', '1000000.01', '']) assert.throws(() => dollarsToCents(v));
});
test('available includes reservations, and overage is visible without overflowing the bar', () => {
  const m = balance({quota_cents: 10000, charged_cents: 2000, reserved_cents: 3000});
  assert.equal(m.available, 5000); assert.equal(m.usedPercent, 20); assert.equal(m.reservedPercent, 30);
  const over = balance({quota_cents: 10000, charged_cents: 11000, reserved_cents: 3000});
  assert.equal(over.available, -4000); assert.equal(over.overage, 4000);
  assert.equal(over.usedPercent + over.reservedPercent, 100);
  assert.throws(() => balance({quota_cents: 100, charged_cents: -1, reserved_cents: 0}));
});
