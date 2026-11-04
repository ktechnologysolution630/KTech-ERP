import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { prs, type SessionUser } from '@/db/schema';
import { filterApprovals, groupApprovalsByProject, type ApprovalItem } from '@/domain/approvals';
import { D } from '@/domain/money';
import { requestAdvance } from '@/server/services/advances';
import { decideApproval, isApprover, listPendingApprovals } from '@/server/services/approvals';
import { createPr, submitPr } from '@/server/services/pr';
import { createPrv, transitionPrv } from '@/server/services/prv';
import { recordStockMovement, requestStockAdjust, upsertStockItem } from '@/server/services/stock';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

const line = { description: 'ปูน', unitName: 'ถุง', qty: D(10), estUnitPrice: D(100), neededDate: '2026-11-15', note: '' };

describe('approval centre', () => {
  const seedPr = async (projectId: 'projectA' | 'projectB' = 'projectA') => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, projectId === 'projectA' ? f.users.foreman : f.users.otherForeman, { projectId: f[projectId], lines: [line] });
    await submitPr(db, projectId === 'projectA' ? f.users.foreman : f.users.otherForeman, pr.id);
    return { db, f, pr };
  };
  const numbers = async (db: Awaited<ReturnType<typeof createTestDb>>, u: SessionUser) => (await listPendingApprovals(db, u)).map((i) => i.number);

  test('lists a document only for those who may decide it', async () => {
    const { db, f, pr } = await seedPr();
    expect(await numbers(db, f.users.pm)).toEqual([pr.number]);
    expect(await numbers(db, f.users.owner)).toEqual([pr.number]);
    for (const other of [f.users.foreman, f.users.buyer, f.users.finance]) expect(await numbers(db, other)).toEqual([]);

    const [row] = await listPendingApprovals(db, f.users.pm);
    expect(row).toMatchObject({ type: 'PR', id: pr.id, projectId: f.projectA, projectName: 'โครงการก่อสร้างคลังสินค้า A', requesterName: 'สมชาย หน้างาน', href: `/pr/${pr.id}` });
  });

  test('a PM does not see another project', async () => {
    const { db, f } = await seedPr('projectB');
    expect(await numbers(db, f.users.pm)).toEqual([]);
  });

  test('approving goes through the document workflow and leaves the list; a second decision is refused', async () => {
    const { db, f, pr } = await seedPr();
    await decideApproval(db, f.users.pm, { type: 'PR', id: pr.id, approve: true });

    const [row] = await db.select().from(prs).where(eq(prs.id, pr.id));
    expect(row!.status).toBe('APPROVED');
    expect(await numbers(db, f.users.pm)).toEqual([]);
    await expect(decideApproval(db, f.users.pm, { type: 'PR', id: pr.id, approve: false, note: 'ช้าไป' })).rejects.toMatchObject({ status: 409 });
  });

  test('rejecting needs a reason, which is kept', async () => {
    const { db, f, pr } = await seedPr();
    await expect(decideApproval(db, f.users.pm, { type: 'PR', id: pr.id, approve: false, note: '  ' })).rejects.toMatchObject({ status: 400 });
    await decideApproval(db, f.users.pm, { type: 'PR', id: pr.id, approve: false, note: 'ราคาสูงไป' });
    const [row] = await db.select().from(prs).where(eq(prs.id, pr.id));
    expect(row).toMatchObject({ status: 'REJECTED', rejectReason: 'ราคาสูงไป' });
  });

  test('deciding is still refused without the permission, even with a crafted request', async () => {
    const { db, f, pr } = await seedPr();
    await expect(decideApproval(db, f.users.foreman, { type: 'PR', id: pr.id, approve: true })).rejects.toMatchObject({ status: 403 });
    await expect(decideApproval(db, f.users.pm, { type: 'PR', id: 'not-a-uuid', approve: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(decideApproval(db, f.users.pm, { type: 'NOPE' as never, id: pr.id, approve: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('your own advance is not offered to you, and has no project group when it has no project', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const own = await requestAdvance(db, f.users.owner, { purpose: 'ของตัวเอง', amount: 500 });
    const other = await requestAdvance(db, f.users.foreman, { purpose: 'ค่าน้ำมัน', amount: 2000 });

    expect(await numbers(db, f.users.owner)).toEqual([other.number]);
    const [row] = await listPendingApprovals(db, f.users.admin).then((r) => r.filter((i) => i.number === own.number));
    expect(row).toMatchObject({ type: 'ADVANCE', projectId: null, projectName: 'ไม่ระบุโครงการ', amount: 500 });
  });

  test('your own stock adjustment is offered only to someone else', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const item = await upsertStockItem(db, f.users.buyer, { sku: 'MAT-1', name: 'ปูน', unit: 'ถุง', unitCost: 140 });
    await recordStockMovement(db, f.users.admin, { stockItemId: item.id, projectId: f.projectA, type: 'RECEIVE', quantity: 20 });
    const req = await requestStockAdjust(db, f.users.admin, { stockItemId: item.id, projectId: f.projectA, countedQty: 18, reason: 'ถุงแตก' });

    expect(await numbers(db, f.users.admin)).toEqual([]);
    expect(await numbers(db, f.users.owner)).toEqual([req.requestNumber]);
    await decideApproval(db, f.users.owner, { type: 'STOCK_ADJUST', id: req.id, approve: true });
    expect(await numbers(db, f.users.owner)).toEqual([]);
  });

  test('a claim moves through both reviewers, and a stale screen cannot skip a step', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const prv = await createPrv(db, f.users.foreman, {
      projectId: f.projectA,
      vendorId: f.vendorPerson,
      category: 'CONTRACTOR_PROGRESS',
      installmentNo: 1,
      retentionPercent: 5,
      whtRate: 3,
      vatRate: 7,
      notes: '',
      items: [{ description: 'ค่าแรง', quantity: 1, unit: 'งาน', unitPrice: 1000, progressPercent: 100 }],
    });
    await transitionPrv(db, f.users.foreman, prv.id, 'submit');
    expect((await listPendingApprovals(db, f.users.pm)).map((i) => i.type)).toEqual(['PRV_VERIFY']);

    await decideApproval(db, f.users.pm, { type: 'PRV_VERIFY', id: prv.id, approve: true });
    expect(await numbers(db, f.users.pm)).toEqual([]);
    expect((await listPendingApprovals(db, f.users.owner)).map((i) => i.type)).toEqual(['PRV_APPROVE']);

    // The owner's old screen still shows the verify step: it must not approve for payment
    await expect(decideApproval(db, f.users.owner, { type: 'PRV_VERIFY', id: prv.id, approve: true })).rejects.toMatchObject({ status: 409 });
    await decideApproval(db, f.users.owner, { type: 'PRV_APPROVE', id: prv.id, approve: true });
    expect(await numbers(db, f.users.owner)).toEqual([]);
  });

  test('the menu is for roles that approve something', async () => {
    const f = await seedBasics(await createTestDb());
    expect(isApprover(f.users.pm)).toBe(true);
    expect(isApprover(f.users.finance)).toBe(true);
    expect(isApprover(f.users.foreman)).toBe(false);
    expect(isApprover(f.users.buyer)).toBe(false);
  });
});

describe('grouping and filtering', () => {
  const doc = (over: Partial<ApprovalItem>): ApprovalItem => ({
    type: 'PR',
    id: 'x',
    number: 'PR-1',
    title: 'งาน',
    projectId: 'a',
    projectName: 'ข โครงการ',
    date: '2026-11-04',
    requesterName: 'สมชาย',
    amount: null,
    href: '/pr/x',
    ...over,
  });

  test('one row per project with distinct types, documents without a project last', () => {
    const groups = groupApprovalsByProject([
      doc({ projectId: null, projectName: 'ไม่ระบุโครงการ', type: 'PV' }),
      doc({}),
      doc({ type: 'PO' }),
      doc({ type: 'PR', number: 'PR-2' }),
      doc({ projectId: 'b', projectName: 'ก โครงการ' }),
    ]);
    expect(groups.map((g) => [g.projectName, g.items.length])).toEqual([
      ['ก โครงการ', 1],
      ['ข โครงการ', 3],
      ['ไม่ระบุโครงการ', 1],
    ]);
    expect(groups[1]!.typeLabels).toEqual(['ใบขอซื้อ (PR)', 'ใบสั่งซื้อ (PO)']);
  });

  test('search and date range, with inclusive ends', () => {
    const items = [doc({ number: 'PR-1', date: '2026-11-01' }), doc({ number: 'PO-9', date: '2026-11-03', type: 'PO', requesterName: 'วิชัย' })];
    const run = (query: string, from = '', to = '') => filterApprovals(items, { query, from, to }).map((i) => i.number);
    expect(run('')).toEqual(['PR-1', 'PO-9']);
    expect(run('po-9')).toEqual(['PO-9']);
    expect(run('วิชัย')).toEqual(['PO-9']);
    expect(run('ใบสั่งซื้อ')).toEqual(['PO-9']);
    expect(run('', '2026-11-03')).toEqual(['PO-9']);
    expect(run('', '', '2026-11-01')).toEqual(['PR-1']);
    expect(run('ไม่มี')).toEqual([]);
  });
});
