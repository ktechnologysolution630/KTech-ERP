import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { notifications, payables, poLines, pos, type PoStatus } from '@/db/schema';
import { D } from '@/domain/money';
import { listActivity } from '@/server/services/activity';
import { addComment, listComments } from '@/server/services/attachments';
import { cancelInvoice, createInvoice } from '@/server/services/invoice';
import { listOpenPayables, requestPrepaid } from '@/server/services/payable';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import { deletePo, previewPoDeletion } from '@/server/services/po-delete';
import { cancelPv, createPv } from '@/server/services/pv';
import { createReceipt } from '@/server/services/receipt';
import { deleteVendors } from '@/server/services/vendor-delete';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
type Fixtures = Awaited<ReturnType<typeof seedBasics>>;

async function makePo(db: TestDb, f: Fixtures, paymentType: 'CREDIT' | 'PREPAID' = 'CREDIT') {
  return createPo(db, f.users.buyer, {
    projectId: f.projectA,
    vendorId: f.vendorCo,
    paymentType,
    ...(paymentType === 'CREDIT' ? { creditDays: 30 } : {}),
    vatMode: 'NONE',
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ description: 'ปูน', unitName: 'ถุง', qty: D(10), unitPrice: D(100), discount: D(0) }],
  });
}

async function makeApprovedPo(db: TestDb, f: Fixtures, paymentType: 'CREDIT' | 'PREPAID' = 'CREDIT') {
  const po = await makePo(db, f, paymentType);
  await submitPo(db, f.users.buyer, po.id);
  await approvePo(db, f.users.buyerHead, po.id);
  return po;
}

const statusOf = async (db: TestDb, id: string): Promise<PoStatus | undefined> => (await db.select({ status: pos.status }).from(pos).where(eq(pos.id, id)))[0]?.status;

describe('deleting a PO', () => {
  test('only an admin may', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await makePo(db, f);
    for (const u of [f.users.foreman, f.users.pm, f.users.buyer, f.users.buyerHead, f.users.finance, f.users.owner]) {
      await expect(deletePo(db, u, po.id)).rejects.toMatchObject({ status: 403 });
      await expect(previewPoDeletion(db, u, po.id)).rejects.toMatchObject({ status: 403 });
    }
    expect(await statusOf(db, po.id)).toBe('DRAFT');
  });

  test('removes it with its lines and comments, clears its notifications, frees its vendor, and logs who did it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await makePo(db, f);
    await addComment(db, f.users.buyer, { entityType: 'PO', entityId: po.id, body: 'ทดสอบ' });
    await db.insert(notifications).values({ userId: f.users.buyerHead.id, title: 'รออนุมัติ', href: `/po/${po.id}` });

    expect((await previewPoDeletion(db, f.users.admin, po.id)).goesWith).toEqual([{ label: 'ความคิดเห็น', count: 1 }]);
    await deletePo(db, f.users.admin, po.id);

    expect(await statusOf(db, po.id)).toBeUndefined();
    expect(await db.select().from(poLines).where(eq(poLines.poId, po.id))).toEqual([]);
    expect(await listComments(db, 'PO', po.id)).toEqual([]);
    expect(await db.select().from(notifications).where(eq(notifications.href, `/po/${po.id}`))).toEqual([]);
    await expect(getPo(db, f.users.admin, po.id)).rejects.toMatchObject({ status: 404 });
    const [log] = await listActivity(db, 'PO', po.id);
    expect(log).toMatchObject({ action: 'DELETE', userId: f.users.admin.id });
    expect(log!.note).toContain(po.number);
    expect((await deleteVendors(db, f.users.admin, [f.vendorCo])).inUse.map((v) => v.id)).not.toContain(f.vendorCo);
  });

  test('a request to pay that is on no PV yet goes with it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await makeApprovedPo(db, f, 'PREPAID');
    await requestPrepaid(db, f.users.buyer, po.id);

    expect((await previewPoDeletion(db, f.users.admin, po.id)).goesWith).toEqual([{ label: 'รายการตั้งจ่ายที่ยังไม่ออก PV', count: 1 }]);
    await deletePo(db, f.users.admin, po.id);
    expect(await db.select().from(payables).where(eq(payables.poId, po.id))).toEqual([]);
  });

  test('goods received hold it, since they moved stock', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await makeApprovedPo(db, f);
    const doc = await getPo(db, f.users.buyer, po.id);
    await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-02', deliveryNoteNo: 'DN-01', lines: [{ poLineId: doc.lines[0]!.id, qty: D(1) }] });

    expect((await previewPoDeletion(db, f.users.admin, po.id)).holders).toEqual([{ label: 'ใบรับของ', number: 'DN-01', href: `/po/${po.id}`, cancelled: false }]);
    await expect(deletePo(db, f.users.admin, po.id)).rejects.toMatchObject({ code: 'PO_IN_USE', status: 409 });
    expect(await statusOf(db, po.id)).toBe('ORDERED');
  });

  test('a live invoice holds it, and once cancelled goes with it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await makeApprovedPo(db, f);
    const invoice = await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-1', invoiceDate: '2026-11-02', beforeVat: D(1000), vat: D(0) });

    const held = await previewPoDeletion(db, f.users.admin, po.id);
    expect(held.holders).toEqual([{ label: 'ใบแจ้งหนี้', number: 'IV-1', href: `/invoices/${invoice.id}`, cancelled: false }]);
    await expect(deletePo(db, f.users.admin, po.id)).rejects.toMatchObject({ code: 'PO_IN_USE' });

    await cancelInvoice(db, f.users.finance, invoice.id, 'ทดสอบ');
    expect((await previewPoDeletion(db, f.users.admin, po.id)).holders).toEqual([]);
    await deletePo(db, f.users.admin, po.id);
    expect(await statusOf(db, po.id)).toBeUndefined();
  });

  test('a PV holds it, even a cancelled one', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await makeApprovedPo(db, f);
    const invoice = await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-1', invoiceDate: '2026-11-02', beforeVat: D(1000), vat: D(0) });
    const [payable] = await listOpenPayables(db, f.users.finance, { vendorId: f.vendorCo });
    const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [payable!.id], whtRates: { [payable!.id]: 0 } });
    await cancelPv(db, f.users.finance, pv.id, 'ทำใหม่');
    await cancelInvoice(db, f.users.finance, invoice.id, 'ทดสอบ');

    expect((await previewPoDeletion(db, f.users.admin, po.id)).holders).toEqual([{ label: 'ใบสำคัญจ่าย PV', number: pv.number, href: `/pv/${pv.id}`, cancelled: true }]);
    await expect(deletePo(db, f.users.admin, po.id)).rejects.toMatchObject({ code: 'PO_IN_USE' });
    expect(await statusOf(db, po.id)).toBe('APPROVED');
  });

  test('a bad id or one already gone is not found', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await makePo(db, f);
    await expect(deletePo(db, f.users.admin, 'nope')).rejects.toMatchObject({ status: 404 });
    await deletePo(db, f.users.admin, po.id);
    await expect(deletePo(db, f.users.admin, po.id)).rejects.toMatchObject({ status: 404 });
  });

  test('every table that points at a PO is accounted for', async () => {
    const db = await createTestDb();
    // Adding one of these needs a decision in po-delete.ts, or a delete fails for a reason nobody is shown
    const result = await db.execute(`
      select distinct c.conrelid::regclass::text as table_name, c.confdeltype::text as on_delete
      from pg_constraint c
      where c.contype = 'f' and c.confrelid in ('pos'::regclass, 'po_lines'::regclass, 'po_installments'::regclass)
      order by 1, 2
    `);
    expect((result.rows as { table_name: string; on_delete: string }[]).map((r) => `${r.table_name}:${r.on_delete}`)).toEqual([
      'boq_overrun_requests:c',
      'close_short_requests:c',
      'invoices:a',
      'payables:a',
      'po_installments:c',
      'po_lines:c',
      'po_revisions:c',
      'prvs:a',
      'receipt_lines:a',
      'receipts:a',
    ]);
  });
});
