import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { stockDocs, stockItems, stockMovements } from '@/db/schema';
import { getStockPageData, upsertStockItem } from '@/server/services/stock';
import { createStockDoc, listStockDocs, receiptLineValue } from '@/server/services/stock-docs';
import { seedBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';

const balance = async (db: Awaited<ReturnType<typeof createTestDb>>, actor: Parameters<typeof getStockPageData>[1], itemId: string, projectId: string | null) =>
  (await getStockPageData(db, actor)).items.find((i) => i.id === itemId)?.balances.find((b) => b.projectId === projectId)?.quantity ?? 0;

describe('stock documents', () => {
  test('a receipt line is carried at its cost before VAT plus extra cost', () => {
    const v = receiptLineValue({ quantity: 10, unitPrice: 100, discount: 50, extraCost: 30 }, 'VAT7');
    expect(v.beforeVat.toFixed(2)).toBe('950.00');
    expect(v.vat.toFixed(2)).toBe('66.50');
    expect(v.net.toFixed(2)).toBe('1046.50');
    expect(v.unitCost.toFixed(2)).toBe('98.00');
    const inc = receiptLineValue({ quantity: 1, unitPrice: 107 }, 'INCLUSIVE');
    expect(inc.beforeVat.toFixed(2)).toBe('100.00');
    expect(inc.vat.toFixed(2)).toBe('7.00');
  });

  test('receive several lines (one new item), then issue, transfer and borrow', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const cement = await upsertStockItem(db, f.users.buyer, { name: 'ปูนซีเมนต์', unit: 'ถุง', category: 'งานโครงสร้าง', unitCost: 150 });

    const gr = await createStockDoc(db, f.users.buyer, {
      type: 'RECEIVE',
      docDate: '2026-11-10',
      projectId: null,
      warehouseName: 'คลังกลาง ชั้น 1',
      vendorId: f.vendorCo,
      poNumber: 'PO-TEST',
      taxType: 'VAT7',
      lines: [
        { stockItemId: cement.id, quantity: 10, unitPrice: 160, discount: 0, extraCost: 20 },
        { newItem: { sku: 'SAND-01', name: 'ทรายหยาบ', unit: 'คิว' }, quantity: 2, unitPrice: 500 },
      ],
    });
    expect(gr.number).toMatch(/^GR/);
    const [doc] = await db.select().from(stockDocs).where(eq(stockDocs.id, gr.id));
    expect(doc).toMatchObject({ type: 'RECEIVE', beforeVat: '2600.00', vat: '182.00', net: '2802.00', poNumber: 'PO-TEST' });
    expect(doc!.supplierName).not.toBe('');
    expect(await balance(db, f.users.buyer, cement.id, null)).toBe(10);
    const [sand] = await db.select().from(stockItems).where(eq(stockItems.sku, 'SAND-01'));
    expect(await balance(db, f.users.buyer, sand!.id, null)).toBe(2);
    const lines = await db.select().from(stockMovements).where(eq(stockMovements.docId, gr.id));
    expect(lines).toHaveLength(2);
    // (10 × 160 + 20) / 10
    expect(lines.find((l) => l.stockItemId === cement.id)!.unitCost).toBe('162.00');

    await createStockDoc(db, f.users.buyer, { type: 'TRANSFER', docDate: '2026-11-10', projectId: null, targetProjectId: f.projectA, lines: [{ stockItemId: cement.id, quantity: 6 }] });
    await createStockDoc(db, f.users.foreman, {
      type: 'ISSUE',
      docDate: '2026-11-11',
      projectId: f.projectA,
      issueKind: 'MATERIAL_ISSUE',
      useProjectId: f.projectA,
      zone: 'ชั้น 2',
      lines: [{ stockItemId: cement.id, quantity: 4 }],
    });
    expect(await balance(db, f.users.buyer, cement.id, f.projectA)).toBe(2);
    const brw = await createStockDoc(db, f.users.buyer, { type: 'BORROW', docDate: '2026-11-12', projectId: null, targetProjectId: f.projectB, lines: [{ stockItemId: cement.id, quantity: 4 }] });
    expect(brw.number).toMatch(/^BRW/);
    expect(await balance(db, f.users.buyer, cement.id, null)).toBe(0);

    const page = await getStockPageData(db, f.users.buyer);
    expect(page.movements.some((m) => m.docType === 'BORROW' && m.referenceNumber === brw.number)).toBe(true);

    const history = await listStockDocs(db, f.users.buyer);
    expect(history.map((h) => h.type)).toEqual(['BORROW', 'ISSUE', 'TRANSFER', 'RECEIVE']);
    expect(history[3]).toMatchObject({ number: gr.number, lineCount: 2, net: 2802, reference: 'PO PO-TEST' });
    // Site staff see only documents touching their projects
    expect((await listStockDocs(db, f.users.foreman)).map((h) => h.type).sort()).toEqual(['ISSUE', 'TRANSFER']);

    // Too much on one line stops the whole document
    await expect(
      createStockDoc(db, f.users.foreman, { type: 'ISSUE', docDate: '2026-11-12', projectId: f.projectA, issueKind: 'OTHER', lines: [{ stockItemId: cement.id, quantity: 1 }, { stockItemId: cement.id, quantity: 5 }] }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await balance(db, f.users.buyer, cement.id, f.projectA)).toBe(2);

    // Site staff cannot register a new item while receiving
    await expect(
      createStockDoc(db, f.users.foreman, { type: 'RECEIVE', docDate: '2026-11-12', projectId: f.projectA, supplierName: 'ร้านใกล้ไซต์', lines: [{ newItem: { sku: 'X-1', name: 'ตะปู', unit: 'กก.' }, quantity: 1 }] }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
