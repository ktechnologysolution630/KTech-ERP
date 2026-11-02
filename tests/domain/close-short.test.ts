import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { rescaleInstallments } from '@/domain/close-short';

describe('rescaleInstallments', () => {
  test('rescale: deposit paid, rest scaled', () => {
    const r = rescaleInstallments(D(600), [
      { id: 'a', amount: D(200), status: 'PAID' },
      { id: 'b', amount: D(300), status: 'PENDING' },
      { id: 'c', amount: D(500), status: 'PENDING' },
    ]);
    expect(r.updates.map((u) => ({ id: u.id, amount: u.amount.toFixed(2), status: u.status }))).toEqual([
      { id: 'b', amount: '150.00', status: 'PENDING' },
      { id: 'c', amount: '250.00', status: 'PENDING' },
    ]);
    expect(r.refundDue.toFixed(2)).toBe('0.00');
  });

  test('rescale: paid more than new total → refund due, pending cancelled', () => {
    const r = rescaleInstallments(D(150), [
      { id: 'a', amount: D(200), status: 'PAID' },
      { id: 'b', amount: D(800), status: 'PENDING' },
    ]);
    expect(r.updates).toEqual([{ id: 'b', amount: D(0), status: 'CANCELLED' }]);
    expect(r.refundDue.toFixed(2)).toBe('50.00');
  });

  test('rescale: exact match of paid amount cancels remaining pending with 0 refund', () => {
    const r = rescaleInstallments(D(500), [
      { id: 'a', amount: D(200), status: 'PAID' },
      { id: 'b', amount: D(300), status: 'REQUESTED' },
      { id: 'c', amount: D(400), status: 'PENDING' },
      { id: 'd', amount: D(100), status: 'PENDING' },
    ]);
    expect(r.updates).toEqual([
      { id: 'c', amount: D(0), status: 'CANCELLED' },
      { id: 'd', amount: D(0), status: 'CANCELLED' },
    ]);
    expect(r.refundDue.toFixed(2)).toBe('0.00');
  });
});
