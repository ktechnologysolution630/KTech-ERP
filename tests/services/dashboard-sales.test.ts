import { describe, expect, test } from 'vitest';
import { createSalesDoc } from '@/server/services/sales-docs';
import { getSalesStockSnapshot } from '@/server/services/dashboard';
import { recordStockMovement, setReorderPoints, upsertStockItem } from '@/server/services/stock';
import { bangkokDateString } from '@/domain/thai';
import { seedBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';

describe('executive dashboard: sales, gross profit and low stock', () => {
  test('sales and gross profit come from the books; items at or under the reorder point are listed', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const item = await upsertStockItem(db, f.users.buyer, { name: 'ปูนซีเมนต์', unit: 'ถุง', unitCost: 0 });
    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 20, unitCost: 120 });
    await setReorderPoints(db, f.users.buyer, [{ stockItemId: item.id, reorderPoint: 10 }]);
    const today = bangkokDateString();

    await createSalesDoc(db, f.users.finance, { kind: 'TI', docDate: today, customerName: 'ลูกค้า', vatMode: 'EXCLUSIVE', lines: [{ name: 'ปูนซีเมนต์', qty: 12, unitPrice: 200, stockItemId: item.id }] });
    const cancelled = await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: today, customerName: 'ลูกค้า', vatMode: 'NONE', lines: [{ name: 'ขายเศษวัสดุ', qty: 1, unitPrice: 500 }] });
    const { cancelSalesDoc } = await import('@/server/services/sales-docs');
    await cancelSalesDoc(db, f.users.finance, cancelled.id, 'ออกผิด');

    const s = await getSalesStockSnapshot(db, f.users.finance);
    expect(s.sales.thisMonth).toBe(2400);
    expect(s.sales.ytd).toBe(2400);
    expect(s.grossProfitYtd).toBe(2400 - 12 * 120);
    expect(s.lowStock.map((i) => [i.name, i.onHand, i.reorderPoint])).toEqual([['ปูนซีเมนต์', 8, 10]]);
    expect(s.stockValue).toBe(960);
    // The item picker on sales lines shows the same on-hand figure
    const { listStockItemsForSales } = await import('@/server/services/sales-docs');
    expect((await listStockItemsForSales(db, f.users.finance)).find((i) => i.id === item.id)?.onHand).toBe(8);
    await expect(getSalesStockSnapshot(db, f.users.foreman)).rejects.toMatchObject({ status: 403 });
  });
});
