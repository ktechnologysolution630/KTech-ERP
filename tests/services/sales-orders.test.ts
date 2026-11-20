import { describe, expect, test } from 'vitest';
import { computeSalesTotals, lineAmount } from '@/domain/sales-doc';
import { cancelSalesDoc, createSalesDoc, getSalesDoc, updateSalesDoc } from '@/server/services/sales-docs';
import { listJournal } from '@/server/services/gl';
import { outputVatReport } from '@/server/services/ar';
import { recordStockMovement, upsertStockItem } from '@/server/services/stock';
import { CENTRAL_KEY, getStockCard } from '@/server/services/stock-card';
import { bangkokDateString } from '@/domain/thai';
import { seedBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';

describe('line discounts', () => {
  test('each line takes its own discount before the bill discount and VAT', () => {
    expect(lineAmount({ qty: 3, unitPrice: 100, discount: 50 }).toFixed(2)).toBe('250.00');
    expect(lineAmount({ qty: 1, unitPrice: 100, discount: 500 }).toFixed(2)).toBe('0.00');
    const t = computeSalesTotals({
      lines: [
        { qty: 3, unitPrice: 100, discount: 50 },
        { qty: 1, unitPrice: 1000 },
      ],
      discountType: 'PERCENT',
      discountValue: 10,
      vatMode: 'EXCLUSIVE',
      whtRate: 0,
    });
    expect([t.subtotal, t.discount, t.afterDiscount, t.vat, t.total].map((d) => d.toFixed(2))).toEqual(['1250.00', '125.00', '1125.00', '78.75', '1203.75']);
    const ex = computeSalesTotals({ lines: [{ qty: 1, unitPrice: 1000 }], discountType: 'AMOUNT', discountValue: 0, vatMode: 'EXEMPT', whtRate: 0 });
    expect([ex.vat, ex.total].map((d) => d.toFixed(2))).toEqual(['0.00', '1000.00']);
  });
});

describe('QT → SO → TI with stock cut and cost of sales', () => {
  test('a tax invoice from a sales order cuts stock at average cost and books COGS; cancelling puts it back', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const item = await upsertStockItem(db, f.users.buyer, { name: 'กระเบื้อง 60x60', unit: 'กล่อง', unitCost: 0 });
    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 10, unitCost: 300 });
    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 10, unitCost: 400 });

    const lines = [
      { name: 'กระเบื้อง 60x60', qty: 4, unit: 'กล่อง', unitPrice: 500, discount: 100, stockItemId: item.id },
      { name: 'ค่าติดตั้ง', qty: 1, unitPrice: 1000 },
    ];
    const qt = await createSalesDoc(db, f.users.finance, { kind: 'QT', docDate: '2026-11-10', customerName: 'ลูกค้า ก', lines });
    const so = await createSalesDoc(db, f.users.finance, { kind: 'SO', docDate: '2026-11-11', customerName: 'ลูกค้า ก', lines }, { sourceId: qt.id });
    expect(so.number).toMatch(/^SO-\d{4}-0001$/);
    // A sales order is not posted and does not touch stock; it can be changed in place
    await updateSalesDoc(db, f.users.finance, so.id, { kind: 'SO', docDate: '2026-11-11', customerName: 'ลูกค้า ก', lines });
    expect((await listJournal(db, f.users.finance, { source: 'SALES_DOC' })).rows).toHaveLength(0);

    // A sales order can't go back to a quotation
    await expect(createSalesDoc(db, f.users.finance, { kind: 'QT', docDate: '2026-11-11', customerName: 'ลูกค้า ก', lines }, { sourceId: so.id })).rejects.toMatchObject({ status: 400 });
    // Short stock refuses the whole invoice
    await expect(
      createSalesDoc(db, f.users.finance, { kind: 'TI', docDate: '2026-11-12', customerName: 'ลูกค้า ก', lines: [{ ...lines[0]!, qty: 50 }] }, { sourceId: so.id }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    const ti = await createSalesDoc(db, f.users.finance, { kind: 'TI', docDate: '2026-11-12', customerName: 'ลูกค้า ก', vatMode: 'EXCLUSIVE', lines }, { sourceId: so.id });
    const doc = await getSalesDoc(db, f.users.finance, ti.id);
    expect(doc).toMatchObject({ subtotal: '2900.00', beforeVat: '2900.00', vat: '203.00', total: '3103.00' });
    expect(doc.lines.map((l) => [l.discount, l.amount])).toEqual([
      ['100.00', '1900.00'],
      ['0.00', '1000.00'],
    ]);
    expect(doc.source).toMatchObject({ id: so.id, kind: 'SO' });
    expect((await getSalesDoc(db, f.users.finance, so.id)).children.map((c) => c.id)).toEqual([ti.id]);

    const onHand = async () => (await getStockCard(db, f.users.buyer, { stockItemId: item.id, store: CENTRAL_KEY, from: '2026-01-01', to: bangkokDateString() })).closing.qty;
    expect(Number(await onHand())).toBe(16);

    // Average 350 × 4 = 1,400 to cost of sales
    const j = await listJournal(db, f.users.finance, { source: 'SALES_DOC' });
    expect(j.rows[0]!.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['1130', 3103, 0],
      ['4100', 0, 2900],
      ['2120', 0, 203],
      ['5110', 1400, 0],
      ['1150', 0, 1400],
    ]);

    await cancelSalesDoc(db, f.users.finance, ti.id, 'ลูกค้ายกเลิก');
    expect(Number(await onHand())).toBe(20);
    expect((await listJournal(db, f.users.finance, { source: 'SALES_DOC' })).rows).toHaveLength(0);
  });
});

describe('TI → RC collects the receivable', () => {
  test('a receipt from a tax invoice clears ลูกหนี้, stays out of output VAT, and cannot collect more than the invoice', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const lines = [{ name: 'ค่าบริการติดตั้ง', qty: 1, unitPrice: 10000 }];
    const ti = await createSalesDoc(db, f.users.finance, { kind: 'TI', docDate: '2026-11-12', customerName: 'ลูกค้า ก', vatMode: 'EXCLUSIVE', lines });

    const rc = await createSalesDoc(
      db,
      f.users.finance,
      { kind: 'RC', docDate: '2026-11-15', customerName: 'ลูกค้า ก', vatMode: 'EXCLUSIVE', payMethod: 'TRANSFER', lines: [{ name: 'รับชำระ', qty: 1, unitPrice: 6000 }] },
      { sourceId: ti.id },
    );
    const j = await listJournal(db, f.users.finance, { source: 'SALES_DOC' });
    const rcEntry = j.rows.find((r) => r.sourceNumber === rc.number)!;
    // 6,000 + VAT 420 = 6,420 received: Dr bank / Cr ลูกหนี้, no second sale or VAT
    expect(rcEntry.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['1120', 6420, 0],
      ['1130', 0, 6420],
    ]);

    const vat = await outputVatReport(db, f.users.finance, 2026, 11);
    expect(vat.rows.map((r) => r.number)).toEqual([ti.number]);

    // 10,700 − 6,420 = 4,280 left on the invoice
    await expect(
      createSalesDoc(
        db,
        f.users.finance,
        { kind: 'RC', docDate: '2026-11-16', customerName: 'ลูกค้า ก', vatMode: 'EXCLUSIVE', payMethod: 'TRANSFER', lines: [{ name: 'รับชำระ', qty: 1, unitPrice: 5000 }] },
        { sourceId: ti.id },
      ),
    ).rejects.toMatchObject({ code: 'OVER_RECEIPT' });
    await createSalesDoc(
      db,
      f.users.finance,
      { kind: 'RC', docDate: '2026-11-16', customerName: 'ลูกค้า ก', vatMode: 'EXCLUSIVE', payMethod: 'TRANSFER', lines: [{ name: 'รับชำระ', qty: 1, unitPrice: 4000 }] },
      { sourceId: ti.id },
    );
  });
});
