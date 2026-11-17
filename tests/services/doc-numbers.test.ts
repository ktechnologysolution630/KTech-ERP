import { describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { activityLogs, stockDocs } from '@/db/schema';
import { type Db } from '@/db/client';
import { D } from '@/domain/money';
import { docPeriod } from '@/domain/thai';
import { createPo, getPo } from '@/server/services/po';
import { createPr } from '@/server/services/pr';
import { listDocNumberStatus, renumberDocument, setNextDocNumber } from '@/server/services/doc-numbers';

const period = () => docPeriod(new Date());

async function newPo(db: Db, f: SeededBasics) {
  return createPo(db, f.users.buyer, {
    projectId: null,
    vendorId: f.vendorCo,
    paymentType: 'CREDIT',
    creditDays: 30,
    vatMode: 'NONE',
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ description: 'กระดาษ A4', unitName: 'รีม', qty: D(1), unitPrice: D(100), discount: D(0) }],
  });
}

describe('document numbers', () => {
  test('setting the next PO number gives the next PO that number, then counts on', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { nextNumber } = await setNextDocNumber(db, f.users.owner, { key: 'PO', next: 150 });
    expect(nextNumber).toBe(`PO-${period()}-0150`);
    expect((await newPo(db, f)).number).toBe(`PO-${period()}-0150`);
    expect((await newPo(db, f)).number).toBe(`PO-${period()}-0151`);
  });

  test('a next number below numbers already used skips them', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    for (let i = 0; i < 3; i++) await newPo(db, f); // 0001–0003
    await setNextDocNumber(db, f.users.admin, { key: 'PO', next: 2 });
    const status = (await listDocNumberStatus(db, f.users.owner)).find((s) => s.key === 'PO')!;
    // The page shows the number the PO will really get
    expect(status).toMatchObject({ lastNumber: `PO-${period()}-0001`, nextNumber: `PO-${period()}-0004`, nextSeq: 4 });
    expect((await newPo(db, f)).number).toBe(`PO-${period()}-0004`);
  });

  test('PR numbers are set per project', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(setNextDocNumber(db, f.users.owner, { key: 'PR', next: 20 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await setNextDocNumber(db, f.users.owner, { key: 'PR', next: 20, projectId: f.projectA });
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [{ description: 'ปูน', unitName: 'ถุง', qty: D(1) }],
    });
    expect(pr.number).toBe(`PR-PJ-001-${period().slice(2)}020`);
    expect((await listDocNumberStatus(db, f.users.owner)).find((s) => s.key === 'PR')).toMatchObject({ nextNumber: null });
  });

  test('renumbering a PO changes its number and the copies kept elsewhere, and is in its history', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await newPo(db, f);
    await db.insert(stockDocs).values({ number: 'GR-1', type: 'RECEIVE', docDate: '2026-11-17', poNumber: po.number, performedBy: f.users.buyer.id });

    const moved = await renumberDocument(db, f.users.owner, { key: 'PO', currentNumber: po.number, newNumber: 'PO-OLD-0100', reason: 'ให้ตรงกับระบบเดิม' });
    expect(moved).toEqual({ href: `/po/${po.id}`, number: 'PO-OLD-0100' });
    expect((await getPo(db, f.users.owner, po.id)).number).toBe('PO-OLD-0100');
    expect((await db.select().from(stockDocs).where(eq(stockDocs.number, 'GR-1')))[0]!.poNumber).toBe('PO-OLD-0100');
    const [log] = await db.select().from(activityLogs).where(and(eq(activityLogs.entityId, po.id), eq(activityLogs.action, 'renumber')));
    expect(log!.note).toBe(`เปลี่ยนเลขจาก ${po.number} เป็น PO-OLD-0100: ให้ตรงกับระบบเดิม`);
  });

  test('a number another document uses, an unknown number or a missing reason is refused', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const first = await newPo(db, f);
    const second = await newPo(db, f);
    await expect(renumberDocument(db, f.users.owner, { key: 'PO', currentNumber: second.number, newNumber: first.number, reason: 'ทดสอบ' })).rejects.toMatchObject({ code: 'NUMBER_TAKEN' });
    await expect(renumberDocument(db, f.users.owner, { key: 'PO', currentNumber: 'PO-0000-9999', newNumber: 'PO-X', reason: 'ทดสอบ' })).rejects.toMatchObject({ status: 404 });
    await expect(renumberDocument(db, f.users.owner, { key: 'PO', currentNumber: second.number, newNumber: 'PO-X', reason: ' ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('a document renumbered ahead of the count is skipped when the count gets there', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await newPo(db, f); // 0001
    await renumberDocument(db, f.users.owner, { key: 'PO', currentNumber: po.number, newNumber: `PO-${period()}-0002`, reason: 'ทดสอบ' });
    expect((await newPo(db, f)).number).toBe(`PO-${period()}-0003`);
  });

  test('only the owner and the admin may change numbers', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await newPo(db, f);
    for (const someone of [f.users.buyer, f.users.buyerHead, f.users.pm, f.users.finance]) {
      await expect(setNextDocNumber(db, someone, { key: 'PO', next: 5 })).rejects.toMatchObject({ status: 403 });
      await expect(renumberDocument(db, someone, { key: 'PO', currentNumber: po.number, newNumber: 'PO-X', reason: 'ทดสอบ' })).rejects.toMatchObject({ status: 403 });
      await expect(listDocNumberStatus(db, someone)).rejects.toMatchObject({ status: 403 });
    }
  });
});
