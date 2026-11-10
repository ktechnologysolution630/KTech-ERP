import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createStockCount, getStockPageData, recordStockMovement, upsertStockItem } from '@/server/services/stock';

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  const item = await upsertStockItem(db, f.users.buyer, { name: 'ปูนซีเมนต์', unit: 'ถุง', category: 'งานโครงสร้าง', unitCost: 150 });
  await recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'RECEIVE', quantity: 50 });
  return { db, f, item };
}

describe('stock count (นับสต็อก)', () => {
  test('records counted vs system quantity and leaves the balance alone', async () => {
    const { db, f, item } = await setup();
    const count = await createStockCount(db, f.users.foreman, {
      countedOn: '2026-11-10',
      note: 'นับประจำเดือน',
      lines: [{ stockItemId: item.id, projectId: f.projectA, countedQty: 47 }],
    });
    expect(count.countNumber).toMatch(/^SC-\d{4}-0001$/);

    const data = await getStockPageData(db, f.users.owner);
    expect(data.items.find((i) => i.id === item.id)!.totalQty).toBe(50);
    expect(data.counts[0]).toMatchObject({ countNumber: count.countNumber, countedOn: '2026-11-10', note: 'นับประจำเดือน' });
    expect(data.counts[0]!.lines).toEqual([expect.objectContaining({ systemQty: 50, countedQty: 47, differenceQty: -3, projectId: f.projectA })]);
  });

  test('a location without a balance counts against zero', async () => {
    const { db, f, item } = await setup();
    await createStockCount(db, f.users.owner, { countedOn: '2026-11-10', lines: [{ stockItemId: item.id, projectId: null, countedQty: 5 }] });
    const [c] = (await getStockPageData(db, f.users.owner)).counts;
    expect(c!.lines[0]).toMatchObject({ systemQty: 0, countedQty: 5, differenceQty: 5 });
  });

  test('refuses another project, negatives, duplicates and an empty count', async () => {
    const { db, f, item } = await setup();
    const line = { stockItemId: item.id, projectId: f.projectA, countedQty: 1 };
    await expect(createStockCount(db, f.users.otherForeman, { countedOn: '2026-11-10', lines: [line] })).rejects.toMatchObject({ status: 403 });
    await expect(createStockCount(db, f.users.foreman, { countedOn: '2026-11-10', lines: [{ ...line, countedQty: -1 }] })).rejects.toMatchObject({ status: 400 });
    await expect(createStockCount(db, f.users.foreman, { countedOn: '2026-11-10', lines: [line, line] })).rejects.toMatchObject({ status: 400 });
    await expect(createStockCount(db, f.users.foreman, { countedOn: '2026-11-10', lines: [] })).rejects.toMatchObject({ status: 400 });
  });

  test('site staff see only counts and lines of their own projects', async () => {
    const { db, f, item } = await setup();
    await createStockCount(db, f.users.foreman, { countedOn: '2026-11-10', lines: [{ stockItemId: item.id, projectId: f.projectA, countedQty: 50 }] });
    expect((await getStockPageData(db, f.users.otherForeman)).counts).toEqual([]);
    expect((await getStockPageData(db, f.users.foreman)).counts).toHaveLength(1);
  });

  test('adjustment documents carry their location and the item cost for valuing the difference', async () => {
    const { db, f, item } = await setup();
    const { requestStockAdjust } = await import('@/server/services/stock');
    await requestStockAdjust(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, countedQty: 47, reason: 'นับได้ 47' });
    const [r] = (await getStockPageData(db, f.users.owner)).adjustRequests;
    expect(r).toMatchObject({ projectId: f.projectA, unitCost: 150, differenceQty: -3 });
  });
});
