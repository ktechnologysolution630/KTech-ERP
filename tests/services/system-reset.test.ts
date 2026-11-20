import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { activityLogs, boqs, docCounters, items, pos, salesDocs, stockBalances, stockMovements, users, variationOrders, vendors } from '@/db/schema';
import { D } from '@/domain/money';
import { deleteSalesDocs } from '@/server/services/accounting-delete';
import { nextDocNumber } from '@/server/services/numbering';
import { approvePo, createPo, reviewPo, submitPo } from '@/server/services/po';
import { cancelSalesDoc, createSalesDoc } from '@/server/services/sales-docs';
import { previewSystemReset, resetSystem, SYSTEM_RESET_CONFIRM } from '@/server/services/system-reset';
import { seedBasics } from '../helpers/fixtures';
import { receiveAll } from '../helpers/receive';
import { createTestDb } from '../helpers/test-db';

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  return { db, f };
}

describe('resetting the whole system', () => {
  test('only the owner and admin, and only with the exact words', async () => {
    const { db, f } = await setup();
    await expect(resetSystem(db, f.users.finance, SYSTEM_RESET_CONFIRM)).rejects.toMatchObject({ status: 403 });
    await expect(previewSystemReset(db, f.users.buyerHead)).rejects.toMatchObject({ status: 403 });
    await expect(resetSystem(db, f.users.owner, 'ลบ')).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' });
  });

  test('removes every document, keeps BOQ, suppliers, items and users, and numbers start again', async () => {
    const { db, f } = await setup();
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
    await receiveAll(db, f.users.foreman, po.id);

    // A deleted document's number is normally never handed out again
    const sale = await createSalesDoc(db, f.users.finance, { kind: 'TI', docDate: '2026-11-10', customerName: 'ลูกค้า', vatMode: 'EXCLUSIVE', lines: [{ name: 'งาน', qty: 1, unitPrice: 1000 }] });
    await cancelSalesDoc(db, f.users.finance, sale.id, 'ทดสอบ');
    await deleteSalesDocs(db, f.users.owner, [sale.id]);

    const [vo] = await db.insert(variationOrders).values({ projectId: f.projectA, number: 'VO-6911-0001', title: 'เพิ่มห้องน้ำ', requestDate: '2026-11-18', requestedBy: f.users.pm.id }).returning();
    await db.insert(boqs).values({ projectId: f.projectA, number: 'BOQ-6911-0001', createdBy: f.users.pm.id, updatedBy: f.users.pm.id });
    await db.insert(boqs).values({ projectId: f.projectA, kind: 'VO', voId: vo!.id, number: 'BOQ-6911-0002', createdBy: f.users.pm.id, updatedBy: f.users.pm.id });
    await nextDocNumber(db, 'BOQ');
    await nextDocNumber(db, 'BOQ');

    const preview = await previewSystemReset(db, f.users.owner);
    expect(preview.documents.map((d) => d.label)).toEqual(expect.arrayContaining(['ใบสั่งซื้อ (PO)', 'ใบรับของ', 'ใบสั่งเปลี่ยนแปลงงาน (VO)']));
    expect(preview.counters).toBeGreaterThan(0);

    await resetSystem(db, f.users.admin, ` ${SYSTEM_RESET_CONFIRM} `);

    for (const table of [pos, salesDocs, variationOrders, stockMovements, stockBalances]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    // What the company set up stays
    expect(await db.select().from(boqs)).toHaveLength(2);
    expect(await db.select().from(vendors).where(eq(vendors.id, f.vendorCo))).toHaveLength(1);
    expect(await db.select().from(items).where(eq(items.id, f.itemCement))).toHaveLength(1);
    expect((await db.select().from(users)).length).toBeGreaterThanOrEqual(8);

    // Every document number starts again at 1, even ones deleted before; BOQ numbers keep counting
    expect(await db.select().from(docCounters).where(eq(docCounters.prefix, 'PO'))).toHaveLength(0);
    expect(await nextDocNumber(db, 'TI', new Date('2026-11-10T00:00:00+07:00'))).toBe(sale.number);
    expect(await nextDocNumber(db, 'BOQ')).toMatch(/-0003$/);

    const logs = await db.select().from(activityLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0]!).toMatchObject({ entityType: 'SYSTEM', action: 'RESET' });
  });
});
