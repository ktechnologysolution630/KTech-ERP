import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { type Db } from '@/db/client';
import { D } from '@/domain/money';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import { createReceipt } from '@/server/services/receipt';
import { getStockPageData, listPoLinesForStock, upsertStockItem } from '@/server/services/stock';

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  return { db, f };
}

/** An approved PO for project A with one line of 40 bags of cement at ฿150. */
async function approvedPo(db: Db, f: SeededBasics, opts: { submitOnly?: boolean } = {}) {
  const po = await createPo(db, f.users.buyer, {
    projectId: f.projectA,
    vendorId: f.vendorCo,
    paymentType: 'CREDIT',
    creditDays: 30,
    vatMode: 'EXCLUSIVE',
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ itemId: f.itemCement, description: 'ปูนซีเมนต์ปอร์ตแลนด์', unitName: 'ถุง', qty: D(40), unitPrice: D(150), discount: D(0) }],
  });
  await submitPo(db, f.users.buyer, po.id);
  if (!opts.submitOnly) await approvePo(db, f.users.owner, po.id);
  const doc = await getPo(db, f.users.buyer, po.id);
  return { po, lineId: doc.lines[0]!.id };
}

describe('stock item form', () => {
  test('without a PO, a new item may start with an opening quantity in the central store', async () => {
    const { db, f } = await setup();
    const item = await upsertStockItem(db, f.users.buyer, { name: 'ทราย', unit: 'คิว', category: 'งานโครงสร้าง', quantity: 12 });
    const row = (await getStockPageData(db, f.users.owner)).items.find((i) => i.id === item.id)!;
    expect(row.totalQty).toBe(12);
    expect(row.balances).toEqual([expect.objectContaining({ projectId: null, quantity: 12 })]);
  });

  test('only approved PO lines are offered, with code, vendor and price', async () => {
    const { db, f } = await setup();
    await approvedPo(db, f, { submitOnly: true });
    expect(await listPoLinesForStock(db, f.users.buyer)).toHaveLength(0);

    const { po } = await approvedPo(db, f);
    const [option] = await listPoLinesForStock(db, f.users.buyer);
    expect(option).toMatchObject({ poNumber: po.number, projectCode: 'PJ-001', itemCode: 'MAT-001', qty: 40, unitPrice: 150, unit: 'ถุง' });
    expect(option.vendorName).toBeTruthy();
  });

  test('an item from a PO line takes its price, starts empty and gets stock only from the receipt — once', async () => {
    const { db, f } = await setup();
    const { po, lineId } = await approvedPo(db, f);

    const item = await upsertStockItem(db, f.users.buyer, {
      sku: 'MAT-001',
      name: 'ปูนซีเมนต์ (ตามป้ายร้าน)',
      unit: 'ถุง',
      category: 'งานโครงสร้าง',
      poLineId: lineId,
    });
    expect(item).toMatchObject({ sku: 'MAT-001', unitCost: '150.00' });
    expect((await getStockPageData(db, f.users.owner)).items.find((i) => i.id === item.id)!.totalQty).toBe(0);

    // Tied lines are no longer offered, and cannot be tied twice
    expect(await listPoLinesForStock(db, f.users.buyer)).toHaveLength(0);
    await expect(upsertStockItem(db, f.users.buyer, { name: 'ซ้ำ', unit: 'ถุง', category: 'อื่น', poLineId: lineId })).rejects.toMatchObject({ status: 409 });

    // The receipt goes into this item although the names differ; no second item is made
    await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-10', lines: [{ poLineId: lineId, qty: D(25) }] });
    const data = await getStockPageData(db, f.users.owner);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ id: item.id, totalQty: 25 });
    expect(data.items[0]!.balances).toEqual([expect.objectContaining({ projectId: f.projectA, quantity: 25 })]);
  });

  test('a quantity together with a PO is refused, so stock is never counted twice', async () => {
    const { db, f } = await setup();
    const { lineId } = await approvedPo(db, f);
    await expect(
      upsertStockItem(db, f.users.buyer, { name: 'ปูน', unit: 'ถุง', category: 'อื่น', poLineId: lineId, quantity: 40 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('a receipt without a tied item makes one and ties it, so later receipts land in the same item', async () => {
    const { db, f } = await setup();
    const { po, lineId } = await approvedPo(db, f);
    await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-10', lines: [{ poLineId: lineId, qty: D(10) }] });
    const [first] = (await getStockPageData(db, f.users.owner)).items;
    // Renaming the item no longer splits stock
    await upsertStockItem(db, f.users.buyer, { id: first!.id, sku: first!.sku, name: 'ปูนถุงเขียว', unit: 'ถุง', category: 'อื่น' });
    await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-11', lines: [{ poLineId: lineId, qty: D(5) }] });
    const items = (await getStockPageData(db, f.users.owner)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'ปูนถุงเขียว', totalQty: 15 });
  });

  test('categories must come from the list for new items; editing keeps the cost', async () => {
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

  test('site users see only their own projects’ PO lines', async () => {
    const { db, f } = await setup();
    await approvedPo(db, f);
    expect(await listPoLinesForStock(db, f.users.otherForeman)).toEqual([]);
  });
});
