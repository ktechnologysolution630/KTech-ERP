import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { receipts, stockDocs, stockItems, stockMovements } from '@/db/schema';
import { D } from '@/domain/money';
import { createInvoice } from '@/server/services/invoice';
import { approvePo, createPo, getPo, reviewPo, submitPo } from '@/server/services/po';
import { cancelReceipt, createReceipt } from '@/server/services/receipt';
import { getStockPageData, recordStockMovement, upsertStockItem } from '@/server/services/stock';
import { createStockDoc } from '@/server/services/stock-docs';
import { deleteReceipts, deleteStockDocs, deleteStockItems, deleteStockMovements } from '@/server/services/stock-delete';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  return { db, f };
}

const balance = async (db: Db, f: SeededBasics, itemId: string, projectId: string | null) =>
  (await getStockPageData(db, f.users.buyer)).items.find((i) => i.id === itemId)?.balances.find((b) => b.projectId === projectId)?.quantity ?? 0;

/** A credit PO for 10 bags of cement on project A, received in full: 10 bags in project A's store */
async function receivedPo(db: Db, f: SeededBasics) {
  const po = await createPo(db, f.users.buyer, {
    projectId: f.projectA,
    vendorId: f.vendorCo,
    paymentType: 'CREDIT',
    creditDays: 30,
    vatMode: 'INCLUSIVE',
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ description: 'ปูนซีเมนต์', qty: D(10), unitName: 'ถุง', unitPrice: D(107), discount: D(0) }],
  });
  await submitPo(db, f.users.buyer, po.id);
  await reviewPo(db, f.users.buyerHead, po.id);
  await approvePo(db, f.users.buyerHead, po.id);
  const lineId = (await getPo(db, f.users.buyer, po.id)).lines[0]!.id;
  const rec = await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-01', lines: [{ poLineId: lineId, qty: '10' }] });
  const [moved] = await db.select().from(stockMovements).where(eq(stockMovements.referenceId, rec.id));
  return { poId: po.id, lineId, receiptId: rec.id, itemId: moved!.stockItemId };
}

const receivedQty = async (db: Db, f: SeededBasics, poId: string) => (await getPo(db, f.users.buyer, poId)).lines[0]!.receivedQty;

describe('deleting a PO goods receipt', () => {
  test('takes the goods back out of stock, and the PO can receive them again', async () => {
    const { db, f } = await setup();
    const { poId, lineId, receiptId, itemId } = await receivedPo(db, f);
    expect(await balance(db, f, itemId, f.projectA)).toBe(10);

    await expect(deleteReceipts(db, f.users.finance, [receiptId])).rejects.toMatchObject({ status: 403 });
    expect((await deleteReceipts(db, f.users.owner, [receiptId])).deleted).toHaveLength(1);

    expect(await db.select().from(receipts).where(eq(receipts.id, receiptId))).toHaveLength(0);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.referenceId, receiptId))).toHaveLength(0);
    expect(await balance(db, f, itemId, f.projectA)).toBe(0);
    expect(Number(await receivedQty(db, f, poId))).toBe(0);
    await createReceipt(db, f.users.foreman, { poId, receivedAt: '2026-11-02', lines: [{ poLineId: lineId, qty: '10' }] });
    expect(await balance(db, f, itemId, f.projectA)).toBe(10);
  });

  test('stays when part of the goods was already issued', async () => {
    const { db, f } = await setup();
    const { receiptId, itemId } = await receivedPo(db, f);
    await createStockDoc(db, f.users.foreman, { type: 'ISSUE', docDate: '2026-11-03', projectId: f.projectA, issueKind: 'MATERIAL_ISSUE', useProjectId: f.projectA, lines: [{ stockItemId: itemId, quantity: 4 }] });

    const result = await deleteReceipts(db, f.users.owner, [receiptId]);
    expect(result.deleted).toEqual([]);
    expect(result.kept[0]!.reason).toContain('ถูกเบิกหรือโอนออกไปแล้ว');
    // Nothing moved
    expect(await balance(db, f, itemId, f.projectA)).toBe(6);
    expect(await db.select().from(receipts).where(eq(receipts.id, receiptId))).toHaveLength(1);
  });

  test('stays while the vendor has billed for the goods', async () => {
    const { db, f } = await setup();
    const { poId, receiptId } = await receivedPo(db, f);
    await createInvoice(db, f.users.finance, { poId, invoiceNo: 'IV-1', invoiceDate: '2026-11-02', beforeVat: D(1000), vat: D(70) });
    expect((await deleteReceipts(db, f.users.owner, [receiptId])).kept[0]!.reason).toContain('ยกเลิกใบแจ้งหนี้ผู้ขายก่อน');
  });

  test('cancelling a receipt now takes its goods back out of stock too', async () => {
    const { db, f } = await setup();
    const { receiptId, itemId } = await receivedPo(db, f);
    await cancelReceipt(db, f.users.owner, receiptId, 'รับผิดใบ');
    expect(await balance(db, f, itemId, f.projectA)).toBe(0);
    await expect(cancelReceipt(db, f.users.owner, receiptId, 'ซ้ำ')).rejects.toMatchObject({ status: 409 });
    // A cancelled receipt can then be deleted, with nothing left to take out
    expect((await deleteReceipts(db, f.users.owner, [receiptId])).deleted).toHaveLength(1);
  });
});

describe('deleting stock documents, movements and items', () => {
  test('an issue, a transfer and a receipt each put the balance back as it was', async () => {
    const { db, f } = await setup();
    const cement = await upsertStockItem(db, f.users.buyer, { name: 'ปูนซีเมนต์', unit: 'ถุง', category: 'งานโครงสร้าง', unitCost: 150 });
    const gr = await createStockDoc(db, f.users.buyer, { type: 'RECEIVE', docDate: '2026-11-10', projectId: null, vendorId: f.vendorCo, taxType: 'NONE', lines: [{ stockItemId: cement.id, quantity: 10, unitPrice: 160 }] });
    const tr = await createStockDoc(db, f.users.buyer, { type: 'TRANSFER', docDate: '2026-11-10', projectId: null, targetProjectId: f.projectA, lines: [{ stockItemId: cement.id, quantity: 6 }] });
    const iss = await createStockDoc(db, f.users.foreman, { type: 'ISSUE', docDate: '2026-11-11', projectId: f.projectA, issueKind: 'MATERIAL_ISSUE', useProjectId: f.projectA, lines: [{ stockItemId: cement.id, quantity: 4 }] });
    expect([await balance(db, f, cement.id, null), await balance(db, f, cement.id, f.projectA)]).toEqual([4, 2]);

    // The receipt cannot go while its bags sit on site
    expect((await deleteStockDocs(db, f.users.owner, [gr.id])).kept[0]!.reason).toContain('ถูกเบิกหรือโอนออกไปแล้ว');

    expect((await deleteStockDocs(db, f.users.owner, [iss.id])).deleted).toEqual([{ id: iss.id, number: iss.number }]);
    expect(await balance(db, f, cement.id, f.projectA)).toBe(6);
    expect((await deleteStockDocs(db, f.users.owner, [tr.id])).deleted).toHaveLength(1);
    expect([await balance(db, f, cement.id, null), await balance(db, f, cement.id, f.projectA)]).toEqual([10, 0]);
    expect((await deleteStockDocs(db, f.users.owner, [gr.id])).deleted).toHaveLength(1);
    expect(await balance(db, f, cement.id, null)).toBe(0);
    expect(await db.select().from(stockDocs)).toHaveLength(0);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.stockItemId, cement.id))).toHaveLength(0);
  });

  test('a document the accounts have posted stays', async () => {
    const { db, f } = await setup();
    const cement = await upsertStockItem(db, f.users.buyer, { name: 'ปูนซีเมนต์', unit: 'ถุง', category: 'งานโครงสร้าง', unitCost: 150 });
    const gr = await createStockDoc(db, f.users.buyer, { type: 'RECEIVE', docDate: '2026-11-10', projectId: null, vendorId: f.vendorCo, taxType: 'NONE', lines: [{ stockItemId: cement.id, quantity: 10, unitPrice: 160 }] });
    await db.update(stockDocs).set({ accountingStatus: 'POSTED' }).where(eq(stockDocs.id, gr.id));
    expect((await deleteStockDocs(db, f.users.owner, [gr.id])).kept[0]!.reason).toBe('บัญชีลงบันทึกแล้ว ลบไม่ได้');
  });

  test('a movement keyed in by hand goes; one from a document points to the document', async () => {
    const { db, f } = await setup();
    const cement = await upsertStockItem(db, f.users.buyer, { name: 'ปูนซีเมนต์', unit: 'ถุง', category: 'งานโครงสร้าง', unitCost: 150 });
    await recordStockMovement(db, f.users.buyer, { stockItemId: cement.id, projectId: null, type: 'RECEIVE', quantity: 5, unitCost: 150 });
    const gr = await createStockDoc(db, f.users.buyer, { type: 'RECEIVE', docDate: '2026-11-10', projectId: null, vendorId: f.vendorCo, taxType: 'NONE', lines: [{ stockItemId: cement.id, quantity: 3, unitPrice: 160 }] });
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.stockItemId, cement.id));
    const manual = moves.find((m) => !m.docId)!;
    const fromDoc = moves.find((m) => m.docId)!;

    const result = await deleteStockMovements(db, f.users.owner, [manual.id, fromDoc.id]);
    expect(result.deleted.map((d) => d.id)).toEqual([manual.id]);
    expect(result.kept[0]!.reason).toContain(gr.number);
    expect(await balance(db, f, cement.id, null)).toBe(3);
  });

  test('an item nothing moved goes; one with history stays', async () => {
    const { db, f } = await setup();
    const unused = await upsertStockItem(db, f.users.buyer, { name: 'ทรายละเอียด', unit: 'คิว', category: 'งานโครงสร้าง', unitCost: 0 });
    const used = await upsertStockItem(db, f.users.buyer, { name: 'ปูนซีเมนต์', unit: 'ถุง', category: 'งานโครงสร้าง', unitCost: 150 });
    await recordStockMovement(db, f.users.buyer, { stockItemId: used.id, projectId: null, type: 'RECEIVE', quantity: 5, unitCost: 150 });

    const result = await deleteStockItems(db, f.users.owner, [unused.id, used.id]);
    expect(result.deleted.map((d) => d.id)).toEqual([unused.id]);
    expect(result.kept[0]!.reason).toContain('มีประวัติการเคลื่อนไหว');
    expect(await db.select().from(stockItems).where(eq(stockItems.id, unused.id))).toHaveLength(0);
  });
});
