import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { decideStockAdjust, recordStockMovement, requestStockAdjust, upsertStockItem } from '@/server/services/stock';
import { ALL_KEY, CENTRAL_KEY, getStockCard } from '@/server/services/stock-card';
import { listJournal } from '@/server/services/gl';
import { bangkokDateString } from '@/domain/thai';

describe('moving average, stock card and AJ', () => {
  test('receipts average the cost; an approved AJ adjusts stock and posts to the books', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const item = await upsertStockItem(db, f.users.buyer, { name: 'เหล็กเส้น DB12', unit: 'เส้น', unitCost: 0 });
    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 100, unitCost: 200 });
    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 100, unitCost: 260 });
    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'TRANSFER', quantity: 50, targetProjectId: f.projectA });

    const req = await requestStockAdjust(db, f.users.buyer, { stockItemId: item.id, projectId: null, countedQty: 145, reason: 'นับจริงขาด 5 เส้น' });
    expect(req.requestNumber).toMatch(/^AJ-\d{4}-0001$/);
    await decideStockAdjust(db, f.users.owner, req.id, true);

    const today = bangkokDateString();
    const card = await getStockCard(db, f.users.buyer, { stockItemId: item.id, store: CENTRAL_KEY, from: '2026-01-01', to: today });
    expect(card.item.avgCost).toBe(230);
    expect(card.rows.map((r) => [r.qtyIn, r.qtyOut, r.balanceQty])).toEqual([
      [100, 0, 100],
      [100, 0, 200],
      [0, 50, 150],
      [0, 5, 145],
    ]);
    expect(card.closing).toEqual({ qty: 145, value: 33350, avgCost: 230 });
    const all = await getStockCard(db, f.users.buyer, { stockItemId: item.id, store: ALL_KEY, from: '2026-01-01', to: today });
    expect(all.closing.qty).toBe(195);

    const j = await listJournal(db, f.users.finance, { source: 'STOCK_ADJUST' });
    expect(j.rows[0]!.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['5310', 1150, 0],
      ['1150', 0, 1150],
    ]);

    // Site staff see their own store only
    await expect(getStockCard(db, f.users.otherForeman, { stockItemId: item.id, store: ALL_KEY, from: '2026-01-01', to: today })).rejects.toMatchObject({ status: 403 });
  });
});
