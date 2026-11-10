import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { D } from '@/domain/money';
import { createPr, submitPr } from '@/server/services/pr';
import { getStockPageData, listPrLinesForStock, upsertStockItem } from '@/server/services/stock';

const prLine = {
  itemId: null as string | null,
  description: 'ปูนซีเมนต์ปอร์ตแลนด์',
  unitName: 'ถุง',
  qty: D(40),
  estUnitPrice: D(150),
  neededDate: '2026-11-15',
  note: '',
};

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  return { db, f };
}

describe('stock item form', () => {
  test('a new item with a quantity starts in the central store', async () => {
    const { db, f } = await setup();
    const item = await upsertStockItem(db, f.users.buyer, { name: 'ทราย', unit: 'คิว', category: 'งานโครงสร้าง', quantity: 12 });
    const row = (await getStockPageData(db, f.users.owner)).items.find((i) => i.id === item.id)!;
    expect(row.totalQty).toBe(12);
    expect(row.balances).toEqual([expect.objectContaining({ projectId: null, quantity: 12 })]);
  });

  test('a PR line gives the item its code, project store and estimated cost', async () => {
    const { db, f } = await setup();
    const pr = await createPr(db, f.users.foreman, { projectId: f.projectA, lines: [{ ...prLine, itemId: f.itemCement }] });

    // Drafts are not offered
    expect(await listPrLinesForStock(db, f.users.buyer)).toHaveLength(0);
    await submitPr(db, f.users.foreman, pr.id);
    const [option] = await listPrLinesForStock(db, f.users.buyer);
    expect(option).toMatchObject({ prNumber: pr.number, itemCode: 'MAT-001', qty: 40, unit: 'ถุง' });

    const item = await upsertStockItem(db, f.users.buyer, {
      sku: option.itemCode,
      name: option.description,
      unit: option.unit,
      category: 'งานโครงสร้าง',
      quantity: option.qty,
      prLineId: option.id,
    });
    expect(item).toMatchObject({ sku: 'MAT-001', unitCost: '150.00' });
    const data = await getStockPageData(db, f.users.owner);
    expect(data.items.find((i) => i.id === item.id)!.balances).toEqual([expect.objectContaining({ projectId: f.projectA, quantity: 40 })]);
    expect(data.movements[0]).toMatchObject({ referenceNumber: pr.number, quantity: 40 });
  });

  test('categories must come from the list for new items; editing keeps cost and an old category', async () => {
    const { db, f } = await setup();
    await expect(upsertStockItem(db, f.users.buyer, { name: 'x', unit: 'ชิ้น', category: 'มั่ว' })).rejects.toMatchObject({ status: 400 });

    const item = await upsertStockItem(db, f.users.buyer, { name: 'ตะปู', unit: 'กล่อง', category: 'อื่น', unitCost: 80 });
    const edited = await upsertStockItem(db, f.users.buyer, { id: item.id, sku: item.sku, name: 'ตะปู 2 นิ้ว', unit: 'กล่อง', category: 'อื่น' });
    expect(edited).toMatchObject({ name: 'ตะปู 2 นิ้ว', unitCost: '80.00' });
  });

  test('a negative quantity is refused', async () => {
    const { db, f } = await setup();
    await expect(upsertStockItem(db, f.users.buyer, { name: 'x', unit: 'ชิ้น', quantity: -1 })).rejects.toMatchObject({ status: 400 });
  });

  test('a site user only sees PR lines of their own projects', async () => {
    const { db, f } = await setup();
    const pr = await createPr(db, f.users.foreman, { projectId: f.projectA, lines: [prLine] });
    await submitPr(db, f.users.foreman, pr.id);
    expect(await listPrLinesForStock(db, f.users.otherForeman)).toEqual([]);
  });
});
