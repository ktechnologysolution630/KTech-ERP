import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { D } from '@/domain/money';
import { stockItems } from '@/db/schema';
import { approvePo, createPo, getPo, markOrdered, reviewPo, submitPo } from '@/server/services/po';
import { createReceipt } from '@/server/services/receipt';
import { approvePr, createPr, getPr, submitPr } from '@/server/services/pr';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('goods receipt → stock item code', () => {
  test('a stock item made by a receipt keeps the item master code of the PO line', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ itemId: f.itemCement, description: 'ปูนซีเมนต์ปอร์ตแลนด์', unitName: 'ถุง', qty: D(10), unitPrice: D(150), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await reviewPo(db, f.users.buyerHead, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    await markOrdered(db, f.users.buyer, po.id);
    const line = (await getPo(db, f.users.buyer, po.id)).lines[0]!;

    await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-02', lines: [{ poLineId: line.id, qty: D(10) }] });
    const items = await db.select().from(stockItems).where(eq(stockItems.name, 'ปูนซีเมนต์ปอร์ตแลนด์'));
    expect(items.map((i) => i.sku)).toEqual(['MAT-001']);
  });

  test('a PO line ordered from a PR line takes the item code the PR picked', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [{ itemId: f.itemCement, description: 'ปูนซีเมนต์ปอร์ตแลนด์', unitName: 'ถุง', qty: D(10), estUnitPrice: D(150) }],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const prLine = (await getPr(db, f.users.buyer, pr.id)).lines[0]!;
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ prLineId: prLine.id, description: 'ปูนซีเมนต์ปอร์ตแลนด์', unitName: 'ถุง', qty: D(10), unitPrice: D(150), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await reviewPo(db, f.users.buyerHead, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    await markOrdered(db, f.users.buyer, po.id);
    const line = (await getPo(db, f.users.buyer, po.id)).lines[0]!;
    await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-02', lines: [{ poLineId: line.id, qty: D(10) }] });
    const items = await db.select().from(stockItems).where(eq(stockItems.name, 'ปูนซีเมนต์ปอร์ตแลนด์'));
    expect(items.map((i) => i.sku)).toEqual(['MAT-001']);
  });
});
