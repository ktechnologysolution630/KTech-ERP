import { describe, expect, test } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  activityLogs,
  advanceExpenses,
  advances,
  arInvoices,
  arReceipts,
  assets,
  attachments,
  boqOverrunRequests,
  comments,
  customers,
  dailyReports,
  invoices,
  milestones,
  payables,
  poLines,
  pos,
  projects,
  prs,
  prvs,
  pvLines,
  pvs,
  receipts,
  receiptSubstitutes,
  stockAdjustRequests,
  stockBalances,
  stockItems,
  stockMovements,
  whtCerts,
} from '@/db/schema';
import { type Db } from '@/db/client';
import { D } from '@/domain/money';
import { createTestDb } from '../helpers/test-db';
import { EARLY_PAY_REASON, receiveAll } from '../helpers/receive';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { addAttachment, addComment, readStoredFile } from '@/server/services/attachments';
import { createInvoice } from '@/server/services/invoice';
import { createProject, getProjectDetail, setProjectCover } from '@/server/services/master';
import { listOpenPayables } from '@/server/services/payable';
import { approvePo, createPo, getPo, markOrdered, submitPo } from '@/server/services/po';
import { approvePr, createPr, getPr, submitPr } from '@/server/services/pr';
import { deleteProject, previewProjectDeletion } from '@/server/services/project-delete';
import { approvePv, cancelPv, createPv, markPvPaid, submitPv } from '@/server/services/pv';
import { createReceipt } from '@/server/services/receipt';
import { createTask } from '@/server/services/tasks';
import '@/server/services/wht-cert';

const exists = async (db: Db, id: string) => (await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id))).length === 1;

/** A credit purchase of one project from PR to PO, with goods received and the supplier's bill entered. */
async function billedPurchase(db: Db, f: SeededBasics, projectId: string, requester: SeededBasics['users']['foreman'], approver: SeededBasics['users']['pm'], invoiceNo: string) {
  const line = { description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(10) };
  const pr = await createPr(db, requester, { projectId, lines: [{ ...line, estUnitPrice: D(100) }] });
  await submitPr(db, requester, pr.id);
  await approvePr(db, approver, pr.id);
  const prDoc = await getPr(db, f.users.buyer, pr.id);
  const po = await createPo(db, f.users.buyer, {
    projectId,
    vendorId: f.vendorCo,
    paymentType: 'CREDIT',
    creditDays: 30,
    vatMode: 'INCLUSIVE',
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ ...line, prLineId: prDoc.lines[0]!.id, unitPrice: D(107), discount: D(0) }],
  });
  await submitPo(db, f.users.buyer, po.id);
  await approvePo(db, f.users.buyerHead, po.id);
  await markOrdered(db, f.users.buyer, po.id);
  const poDoc = await getPo(db, f.users.buyer, po.id);
  await createReceipt(db, requester, { poId: po.id, receivedAt: '2026-11-02', lines: [{ poLineId: poDoc.lines[0]!.id, qty: D(10) }] });
  await receiveAll(db, f.users.owner, po.id);
  await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo, invoiceDate: '2026-11-03', beforeVat: D(1000), vat: D(70) });
  return { prId: pr.id, poId: po.id, poLineId: poDoc.lines[0]!.id };
}

const payableOf = async (db: Db, poId: string) => (await db.select().from(payables).where(eq(payables.poId, poId)))[0]!;

describe('deleting a project', () => {
  test('an unused project goes, along with its uploaded cover', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const p = await createProject(db, f.users.admin, { name: 'สร้างผิด' });
    const cover = new File([new Uint8Array([1, 2])], 'c.png', { type: 'image/png' });
    const url = await setProjectCover(db, f.users.admin, p.id, { kind: 'upload', file: cover });

    expect((await previewProjectDeletion(db, f.users.admin, p.id)).items).toEqual([]);
    await deleteProject(db, f.users.admin, p.id, p.code);

    expect(await exists(db, p.id)).toBe(false);
    expect(await readStoredFile(db, url.split('id=')[1]!)).toBeNull();
    const [log] = await db.select().from(activityLogs).where(and(eq(activityLogs.entityId, p.id), eq(activityLogs.action, 'project.delete')));
    expect(log?.note).toContain(p.code);
  });

  test('only owner and admin may delete or preview, and only they are offered it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const p = await createProject(db, f.users.admin, { name: 'สร้างผิด' });
    const [row] = await db.select().from(projects).where(eq(projects.id, f.projectA));

    for (const actor of [f.users.pm, f.users.foreman]) {
      await expect(deleteProject(db, actor, f.projectA, row!.code)).rejects.toMatchObject({ status: 403 });
      await expect(previewProjectDeletion(db, actor, f.projectA)).rejects.toMatchObject({ status: 403 });
      expect((await getProjectDetail(db, actor, f.projectA)).canDelete).toBe(false);
    }
    for (const actor of [f.users.buyer, f.users.buyerHead, f.users.finance]) {
      await expect(deleteProject(db, actor, f.projectA, row!.code)).rejects.toMatchObject({ status: 403 });
    }
    expect((await getProjectDetail(db, f.users.owner, p.id)).canDelete).toBe(true);
    expect((await getProjectDetail(db, f.users.admin, p.id)).canDelete).toBe(true);

    await deleteProject(db, f.users.owner, p.id, p.code);
    expect(await exists(db, p.id)).toBe(false);
    expect(await exists(db, f.projectA)).toBe(true);
  });

  test('the typed code is checked on the server', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const p = await createProject(db, f.users.admin, { name: 'สร้างผิด' });

    await expect(deleteProject(db, f.users.admin, p.id, '')).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' });
    await expect(deleteProject(db, f.users.admin, p.id, 'ผิด')).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' });
    expect(await exists(db, p.id)).toBe(true);
  });

  test('a project with paid documents goes with all of them; other projects and the assets stay', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { admin, finance, owner, foreman, pm, otherForeman, buyer } = f.users;
    const [row] = await db.select().from(projects).where(eq(projects.id, f.projectA));
    const code = row!.code;

    // Purchasing through to a paid PV with withholding tax
    const a = await billedPurchase(db, f, f.projectA, foreman, pm, 'IV-A');
    const payableA = await payableOf(db, a.poId);
    const pv = await createPv(db, finance, { vendorId: f.vendorCo, payableIds: [payableA.id], whtRates: { [payableA.id]: 3 } });
    await submitPv(db, finance, pv.id);
    await approvePv(db, owner, pv.id, EARLY_PAY_REASON);
    await markPvPaid(db, finance, pv.id, { paidAt: '2026-11-05', payMethod: 'TRANSFER' });
    expect(await db.select().from(whtCerts).where(eq(whtCerts.pvId, pv.id))).toHaveLength(1);

    // Another project's purchase, reaching into this one through a PR line
    const b = await billedPurchase(db, f, f.projectB, otherForeman, owner, 'IV-B');
    const [prLine] = (await getPr(db, buyer, a.prId)).lines;
    await db.update(poLines).set({ prLineId: prLine!.id }).where(eq(poLines.id, b.poLineId));

    // Work and files
    await createTask(db, admin, f.projectA, { title: 'งานแรก' });
    const [report] = await db.insert(dailyReports).values({ projectId: f.projectA, number: 'DR-1', reportDate: '2026-11-01', createdBy: foreman.id }).returning();
    const photo = await addAttachment(db, admin, { entityType: 'DAILY_REPORT', entityId: report!.id, file: new File(['x'], 'p.png', { type: 'image/png' }), kind: 'PHOTO' });
    const onPr = await addAttachment(db, admin, { entityType: 'PR', entityId: a.prId, file: new File(['y'], 'a.pdf', { type: 'application/pdf' }) });
    await addComment(db, admin, { entityType: 'PROJECT', entityId: f.projectA, body: 'แชท' });
    const onOther = await addAttachment(db, admin, { entityType: 'PR', entityId: b.prId, file: new File(['z'], 'b.pdf', { type: 'application/pdf' }) });

    // Money from the customer, and cash advances
    const [customer] = await db.insert(customers).values({ code: 'C-1', name: 'ลูกค้า' }).returning();
    const [milestone] = await db.insert(milestones).values({ projectId: f.projectA, kind: 'RECEIVE', seq: 1, title: 'งวด 1', amount: '1000.00', createdBy: admin.id }).returning();
    const [ar] = await db
      .insert(arInvoices)
      .values({ customerId: customer!.id, milestoneId: milestone!.id, docDate: '2026-11-01', dueDate: '2026-12-01', status: 'PAID', number: 'AR-1', createdBy: finance.id })
      .returning();
    await db.insert(arReceipts).values({ number: 'RC-1', invoiceId: ar!.id, receiptDate: '2026-11-02', amountReceived: '1070.00', beforeVat: '1000.00', vat: '70.00', createdBy: finance.id });
    const [advance] = await db.insert(advances).values({ number: 'ADV-1', payeeId: foreman.id, projectId: f.projectA, requestDate: '2026-11-01', purpose: 'ค่าน้ำมัน', amount: '500.00', createdBy: foreman.id }).returning();
    const [otherAdvance] = await db.insert(advances).values({ number: 'ADV-2', payeeId: otherForeman.id, projectId: f.projectB, requestDate: '2026-11-01', purpose: 'ค่าส่ง', amount: '500.00', createdBy: otherForeman.id }).returning();
    const [ownSubstitute] = await db.insert(receiptSubstitutes).values({ payerId: foreman.id, projectId: f.projectA, advanceId: advance!.id, docDate: '2026-11-01' }).returning();
    const [otherSubstitute] = await db.insert(receiptSubstitutes).values({ payerId: otherForeman.id, projectId: f.projectB, advanceId: advance!.id, docDate: '2026-11-01' }).returning();
    const [otherExpense] = await db
      .insert(advanceExpenses)
      .values({ advanceId: otherAdvance!.id, spentOn: '2026-11-01', description: 'ค่าส่ง', amount: '100.00', substituteId: ownSubstitute!.id, createdBy: otherForeman.id })
      .returning();

    // Claims, including one from another project pointing at this project's PO
    await db.insert(prvs).values({ prvNumber: 'PRV-A', date: '2026-11-01', projectId: f.projectA, payeeName: 'ผู้รับเหมา', totalAmount: '100.00', netAmount: '100.00', requestedBy: foreman.id });
    const [otherPrv] = await db
      .insert(prvs)
      .values({ prvNumber: 'PRV-B', date: '2026-11-01', projectId: f.projectB, poId: a.poId, payeeName: 'ผู้รับเหมา', totalAmount: '100.00', netAmount: '100.00', requestedBy: otherForeman.id })
      .returning();
    await db.insert(boqOverrunRequests).values({ number: 'OR-1', projectId: f.projectA, poId: a.poId, poRevision: 0, overAmount: '1.00', lines: [], reason: 'เกิน', requestedBy: buyer.id });

    // Stock: its own movements and balance go, transfers stay in the other location's history
    const [item] = await db.insert(stockItems).values({ sku: 'S-1', name: 'ปูน' }).returning();
    await db.insert(stockBalances).values([
      { stockItemId: item!.id, projectId: f.projectA, quantity: '5.000' },
      { stockItemId: item!.id, projectId: f.projectB, quantity: '7.000' },
    ]);
    const movement = (n: string, projectId: string | null, type: 'RECEIVE' | 'TRANSFER', targetProjectId: string | null = null) => ({
      movementNumber: n,
      stockItemId: item!.id,
      projectId,
      type,
      targetProjectId,
      quantity: '1.000',
      performedBy: buyer.id,
    });
    await db.insert(stockMovements).values([
      movement('M-OWN', f.projectA, 'RECEIVE'),
      movement('M-OUT', f.projectA, 'TRANSFER', f.projectB),
      movement('M-IN', f.projectB, 'TRANSFER', f.projectA),
      movement('M-OTHER', f.projectB, 'RECEIVE'),
    ]);
    await db.insert(stockAdjustRequests).values({ requestNumber: 'SA-1', stockItemId: item!.id, projectId: f.projectA, currentQty: '5.000', adjustedQty: '4.000', differenceQty: '-1.000', reason: 'นับใหม่', requestedBy: buyer.id });

    // An asset on site is company property
    const [asset] = await db.insert(assets).values({ code: 'AS-1', name: 'เครื่องตัด', projectId: f.projectA, createdBy: admin.id }).returning();

    const preview = await previewProjectDeletion(db, admin, f.projectA);
    expect(preview.blockers).toEqual([]);
    expect(preview.assetsToOffice).toBe(1);
    // The item above, and the cement that the purchase's receipt put into the project's stock
    expect(preview.stockBalancesLeft).toBe(2);
    expect(preview.items.map((i) => i.label)).toEqual(expect.arrayContaining(['ใบสั่งซื้อ (PO)', 'ใบสำคัญจ่าย (PV)', 'งาน', 'ไฟล์และรูปภาพ']));
    expect(preview.taxRecords).toEqual(
      expect.arrayContaining([
        { label: 'ใบสำคัญจ่ายที่จ่ายเงินแล้ว', count: 1 },
        { label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', count: 1 },
        { label: 'ใบเสร็จรับเงิน/ใบกำกับภาษีขาย', count: 1 },
      ]),
    );

    await deleteProject(db, admin, f.projectA, ` ${code} `);

    expect(await exists(db, f.projectA)).toBe(false);
    expect(await db.select().from(prs).where(eq(prs.projectId, f.projectA))).toEqual([]);
    expect(await db.select().from(pos).where(eq(pos.projectId, f.projectA))).toEqual([]);
    expect(await db.select().from(pvs).where(eq(pvs.id, pv.id))).toEqual([]);
    expect(await db.select().from(whtCerts).where(eq(whtCerts.pvId, pv.id))).toEqual([]);
    expect(await db.select().from(payables).where(eq(payables.id, payableA.id))).toEqual([]);
    expect(await db.select().from(invoices).where(eq(invoices.poId, a.poId))).toEqual([]);
    expect(await db.select().from(receipts).where(eq(receipts.poId, a.poId))).toEqual([]);
    expect(await db.select().from(arInvoices).where(eq(arInvoices.id, ar!.id))).toEqual([]);
    expect(await db.select().from(advances).where(eq(advances.id, advance!.id))).toEqual([]);
    expect(await db.select().from(receiptSubstitutes).where(eq(receiptSubstitutes.id, ownSubstitute!.id))).toEqual([]);
    expect(await db.select().from(comments).where(eq(comments.entityId, f.projectA))).toEqual([]);
    expect(await db.select().from(attachments).where(eq(attachments.id, photo.id))).toEqual([]);
    expect(await db.select().from(attachments).where(eq(attachments.id, onPr.id))).toEqual([]);
    expect(await readStoredFile(db, photo.url.split('id=')[1]!)).toBeNull();

    // Other project: its documents, files and balance are untouched, and links into the deleted one are cleared
    expect(await exists(db, f.projectB)).toBe(true);
    expect(await db.select({ id: pos.id }).from(pos).where(eq(pos.id, b.poId))).toHaveLength(1);
    expect((await payableOf(db, b.poId)).gross).toBe('1070.00');
    expect((await db.select().from(poLines).where(eq(poLines.id, b.poLineId)))[0]?.prLineId).toBeNull();
    expect((await db.select().from(prvs).where(eq(prvs.id, otherPrv!.id)))[0]?.poId).toBeNull();
    expect((await db.select().from(receiptSubstitutes).where(eq(receiptSubstitutes.id, otherSubstitute!.id)))[0]?.advanceId).toBeNull();
    expect((await db.select().from(advanceExpenses).where(eq(advanceExpenses.id, otherExpense!.id)))[0]?.substituteId).toBeNull();
    expect(await db.select().from(attachments).where(eq(attachments.id, onOther.id))).toHaveLength(1);
    expect((await db.select().from(stockBalances).where(eq(stockBalances.stockItemId, item!.id))).map((x) => x.quantity)).toEqual(['7.000']);

    const moves = await db.select().from(stockMovements).where(eq(stockMovements.stockItemId, item!.id));
    expect(moves.map((m) => m.movementNumber).sort()).toEqual(['M-IN', 'M-OTHER', 'M-OUT']);
    const out = moves.find((m) => m.movementNumber === 'M-OUT')!;
    expect(out).toMatchObject({ projectId: null, targetProjectId: f.projectB });
    expect(out.notes).toContain(code);
    const into = moves.find((m) => m.movementNumber === 'M-IN')!;
    expect(into).toMatchObject({ projectId: f.projectB, targetProjectId: null });
    expect(into.notes).toContain(code);

    expect((await db.select().from(assets).where(eq(assets.id, asset!.id)))[0]?.projectId).toBeNull();
    const [log] = await db.select().from(activityLogs).where(and(eq(activityLogs.entityId, f.projectA), eq(activityLogs.action, 'project.delete')));
    expect(log?.userId).toBe(admin.id);
  });

  test('a PV shared with another project stops the delete and changes nothing, until it is cancelled', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { admin, finance, foreman, pm, otherForeman, owner } = f.users;
    const [row] = await db.select().from(projects).where(eq(projects.id, f.projectA));

    const a = await billedPurchase(db, f, f.projectA, foreman, pm, 'IV-A');
    const b = await billedPurchase(db, f, f.projectB, otherForeman, owner, 'IV-B');
    const payableA = await payableOf(db, a.poId);
    const payableB = await payableOf(db, b.poId);
    const pv = await createPv(db, finance, { vendorId: f.vendorCo, payableIds: [payableA.id, payableB.id], whtRates: { [payableA.id]: 0, [payableB.id]: 0 } });

    const preview = await previewProjectDeletion(db, admin, f.projectA);
    expect(preview.blockers).toHaveLength(1);
    expect(preview.blockers[0]).toContain(pv.number);
    await expect(deleteProject(db, admin, f.projectA, row!.code)).rejects.toMatchObject({ code: 'PROJECT_IN_USE', status: 409 });
    expect(await exists(db, f.projectA)).toBe(true);
    expect(await db.select().from(pvLines).where(eq(pvLines.pvId, pv.id))).toHaveLength(2);

    // Once cancelled the PV stays on record for the other project, without this project's line
    await cancelPv(db, finance, pv.id, 'แยกจ่าย');
    expect((await previewProjectDeletion(db, admin, f.projectA)).blockers).toEqual([]);
    await deleteProject(db, admin, f.projectA, row!.code);
    expect(await exists(db, f.projectA)).toBe(false);
    expect((await db.select().from(pvLines).where(eq(pvLines.pvId, pv.id))).map((l) => l.payableId)).toEqual([payableB.id]);
    expect((await listOpenPayables(db, finance, {})).map((p) => p.id)).toContain(payableB.id);
  });

  test('a PV paid together with another project can never be removed this way', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { admin, finance, foreman, pm, otherForeman, owner } = f.users;
    const [row] = await db.select().from(projects).where(eq(projects.id, f.projectA));

    const a = await billedPurchase(db, f, f.projectA, foreman, pm, 'IV-A');
    const b = await billedPurchase(db, f, f.projectB, otherForeman, owner, 'IV-B');
    const payableA = await payableOf(db, a.poId);
    const payableB = await payableOf(db, b.poId);
    const pv = await createPv(db, finance, { vendorId: f.vendorCo, payableIds: [payableA.id, payableB.id], whtRates: { [payableA.id]: 0, [payableB.id]: 0 } });
    await submitPv(db, finance, pv.id);
    await approvePv(db, owner, pv.id, EARLY_PAY_REASON);
    await markPvPaid(db, finance, pv.id, { paidAt: '2026-11-05', payMethod: 'TRANSFER' });

    expect((await previewProjectDeletion(db, admin, f.projectA)).blockers[0]).toContain('ยกเลิก');
    await expect(deleteProject(db, admin, f.projectA, row!.code)).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });
    expect((await db.select().from(pvs).where(eq(pvs.id, pv.id)))[0]?.status).toBe('PAID');
    expect(await exists(db, f.projectA)).toBe(true);
  });

  test('every table that points at a project is handled by the delete', async () => {
    const db = await createTestDb();
    // Adding one of these needs a decision in project-delete.ts: remove with the project, clear the link, or keep
    const result = await db.execute(sql`
      select distinct c.conrelid::regclass::text as table_name, c.confdeltype as on_delete
      from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'projects'::regclass
      order by 1
    `);
    const rows = result.rows as { table_name: string; on_delete: string }[];
    expect(rows.filter((r) => r.on_delete !== 'c').map((r) => r.table_name).sort()).toEqual(
      ['advances', 'ar_invoices', 'assets', 'boq_overrun_requests', 'payables', 'pos', 'prs', 'prvs', 'receipt_substitutes', 'stock_adjust_requests', 'stock_docs', 'stock_movements'].sort(),
    );
    expect(rows.filter((r) => r.on_delete === 'c').map((r) => r.table_name).sort()).toEqual(
      ['boqs', 'daily_reports', 'milestones', 'notifications', 'project_events', 'project_handovers', 'project_members', 'project_tasks', 'stock_balances', 'stock_count_lines', 'variation_orders', 'warranty_defects'].sort(),
    );
  });
});
