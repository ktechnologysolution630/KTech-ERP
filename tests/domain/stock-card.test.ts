import { describe, expect, test } from 'vitest';
import { buildStockCard, movingAverage, type CardMovement } from '@/domain/stock-card';

const mv = (o: Partial<CardMovement> & Pick<CardMovement, 'type' | 'quantity' | 'date'>): CardMovement => ({
  id: `${o.date}-${o.type}-${o.quantity}`,
  number: 'SM',
  reference: '',
  unitCost: 0,
  projectId: null,
  targetProjectId: null,
  notes: '',
  ...o,
});

describe('moving average cost', () => {
  test('averages what is on hand with what comes in', () => {
    expect(movingAverage(100, 10, 50, 13).toFixed(2)).toBe('11.00');
    expect(movingAverage(0, 10, 50, 13).toFixed(2)).toBe('13.00');
    expect(movingAverage(-5, 10, 50, 13).toFixed(2)).toBe('13.00');
  });
});

describe('stock card', () => {
  const P = 'project-a';
  const moves = [
    mv({ date: '2026-10-01', type: 'RECEIVE', quantity: 100, unitCost: 10 }),
    mv({ date: '2026-10-05', type: 'TRANSFER', quantity: 40, unitCost: 10, targetProjectId: P }),
    mv({ date: '2026-11-01', type: 'RECEIVE', quantity: 60, unitCost: 15 }),
    mv({ date: '2026-11-02', type: 'ISSUE', quantity: 20 }),
    mv({ date: '2026-11-03', type: 'ADJUST', quantity: -10 }),
  ];

  test('the central store: brought forward, in at cost, out at the running average', () => {
    const c = buildStockCard(moves, null, '2026-11-01');
    expect(c.opening).toEqual({ qty: 60, value: 600 });
    expect(c.rows.map((r) => [r.qtyIn, r.qtyOut, r.balanceQty, r.balanceValue, r.avgCost])).toEqual([
      [60, 0, 120, 1500, 12.5],
      [0, 20, 100, 1250, 12.5],
      [0, 10, 90, 1125, 12.5],
    ]);
    expect(c.closing).toEqual({ qty: 90, value: 1125, avgCost: 12.5 });
  });

  test('a transfer moves into the project store; across all stores it cancels out', () => {
    expect(buildStockCard(moves, P, '2026-01-01').closing).toMatchObject({ qty: 40, value: 400 });
    const all = buildStockCard(moves, 'ALL', '2026-01-01');
    expect(all.rows).toHaveLength(4);
    expect(all.closing.qty).toBe(130);
  });
});
