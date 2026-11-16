import { describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { notifications, type NotificationLevel } from '@/db/schema';
import { type Db } from '@/db/client';
import { D } from '@/domain/money';
import { getProjectBoqSheet, saveProjectMainBoq } from '@/server/services/boq';
import { approvePr, cancelPr, closePr, createPr, getPr, rejectPr, submitPr, type PrLineInput } from '@/server/services/pr';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import { listBoqQtyOptions } from '@/server/services/pr-boq';
import { listPendingApprovals } from '@/server/services/approvals';
import { updateSettings } from '@/server/services/settings';

/** Project A's BOQ: steel 100 bars, and a project B BOQ line for the cross-project check */
async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  const boq = (no: string, description: string, qty: number, unit: string, materialRate: number) => ({
    isCategory: false,
    isBold: false,
    no,
    description,
    qty,
    unit,
    materialRate,
    laborRate: 0,
    note: '',
  });
  const header = {
    baseUpdatedAt: null,
    revision: 0,
    estimateDate: null,
    projectTitle: '',
    location: '',
    owner: '',
    workDetail: '',
    estimator: '',
    overheadPercent: 0,
    discountAmount: 0,
    vatPercent: 7,
    remarks: '',
  };
  await saveProjectMainBoq(db, f.users.pm, f.projectA, {
    ...header,
    lines: [
      { isCategory: true, isBold: true, no: '1', description: 'งานโครงสร้าง', qty: '', unit: '', materialRate: '', laborRate: '', note: '' },
      boq('1.1', 'เหล็กเส้น DB12', 100, 'เส้น', 200),
    ],
  });
  await saveProjectMainBoq(db, f.users.owner, f.projectB, { ...header, lines: [boq('1.1', 'ปูนซีเมนต์', 50, 'ถุง', 150)] });
  const steel = (await getProjectBoqSheet(db, f.users.pm, f.projectA)).boq!.lines[1]!;
  const cementB = (await getProjectBoqSheet(db, f.users.owner, f.projectB)).boq!.lines[0]!;
  return { db, f, steel, cementB };
}

const steelLine = (boqLineId: string, qty: number): PrLineInput => ({
  description: 'เหล็กเส้น DB12',
  unitName: 'เส้น',
  category: 'งานโครงสร้าง',
  qty: D(qty),
  boqLineId,
});

/** A goods PR the foreman writes and sends for approval */
async function submittedPr(db: Db, f: SeededBasics, lines: PrLineInput[]) {
  const pr = await createPr(db, f.users.foreman, { projectId: f.projectA, prType: 'GOODS', lines });
  await submitPr(db, f.users.foreman, pr.id);
  return pr;
}

async function prNotes(db: Db, userId: string, prNumber: string) {
  const rows = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.category, 'PR')));
  return rows.filter((r) => r.title.includes(prNumber)).map((r) => r.title);
}

/** Item quantity alerts a user received, oldest first */
async function qtyAlerts(db: Db, userId: string): Promise<NotificationLevel[]> {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows
    .filter((r) => r.category === 'BOQ' && r.title.includes('ขอซื้อ'))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => r.level);
}

function poFromPrLine(projectId: string, vendorId: string, prLineId: string, qty: number) {
  return {
    projectId,
    vendorId,
    paymentType: 'CREDIT' as const,
    creditDays: 30,
    vatMode: 'EXCLUSIVE' as const,
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ prLineId, description: 'เหล็กเส้น DB12', unitName: 'เส้น', qty: D(qty), unitPrice: D(200), discount: D(0) }],
  };
}

describe('PR over the BOQ quantity', () => {
  test('within the BOQ: the PM approves and the owner is not asked', async () => {
    const { db, f, steel } = await setup();
    const pr = await submittedPr(db, f, [steelLine(steel.id, 60)]);
    expect((await getPr(db, f.users.pm, pr.id)).boqCheck.needsOwner).toBe(false);

    await approvePr(db, f.users.pm, pr.id);
    expect((await getPr(db, f.users.pm, pr.id)).status).toBe('APPROVED');
    expect(await prNotes(db, f.users.owner.id, pr.number)).toEqual([]);
  });

  test('over the BOQ: the PR shows the excess, the PM approval sends it to the owner, and no PO can be made yet', async () => {
    const { db, f, steel } = await setup();
    const first = await submittedPr(db, f, [steelLine(steel.id, 60)]);
    await approvePr(db, f.users.pm, first.id);

    const second = await submittedPr(db, f, [steelLine(steel.id, 50)]);
    const before = await getPr(db, f.users.pm, second.id);
    expect(before.boqCheck.over).toMatchObject([{ boqLineId: steel.id, boqQty: '100', requestedElsewhere: '60', thisPr: '50', over: '10' }]);

    await approvePr(db, f.users.pm, second.id);
    const waiting = await getPr(db, f.users.owner, second.id);
    expect(waiting.status).toBe('OWNER_REVIEW');
    expect(waiting.pmApprovedByName).toBe('วิชัย ผู้จัดการโครงการ');
    const [ownerNote] = await prNotes(db, f.users.owner.id, second.number);
    expect(ownerNote).toContain('รอเจ้าของอนุมัติ');
    expect(ownerNote).toContain('10 เส้น');

    await expect(
      createPo(db, f.users.buyer, poFromPrLine(f.projectA, f.vendorCo, waiting.lines[0]!.id, 50)),
    ).rejects.toMatchObject({ code: 'PR_NOT_APPROVED' });
    // Only the owner decides at this step
    await expect(approvePr(db, f.users.pm, second.id)).rejects.toMatchObject({ status: 403 });
  });

  test('once the owner approves, purchasing orders it and the PO line draws on the BOQ line', async () => {
    const { db, f, steel } = await setup();
    const pr = await submittedPr(db, f, [steelLine(steel.id, 110)]);
    await approvePr(db, f.users.pm, pr.id);
    await approvePr(db, f.users.owner, pr.id);
    const approved = await getPr(db, f.users.owner, pr.id);
    expect(approved.status).toBe('APPROVED');
    expect(await prNotes(db, f.users.pm.id, pr.number)).toContainEqual(expect.stringContaining('เจ้าของอนุมัติซื้อเกิน BOQ แล้ว'));

    const po = await createPo(db, f.users.buyer, poFromPrLine(f.projectA, f.vendorCo, approved.lines[0]!.id, 110));
    expect((await getPo(db, f.users.buyer, po.id)).lines[0]!.boqLineId).toBe(steel.id);
  });

  test('the PM or the owner can turn it down', async () => {
    const { db, f, steel } = await setup();
    const atPm = await submittedPr(db, f, [steelLine(steel.id, 120)]);
    await rejectPr(db, f.users.pm, atPm.id, 'ขอเกินแบบ');
    expect((await getPr(db, f.users.pm, atPm.id)).status).toBe('REJECTED');

    const atOwner = await submittedPr(db, f, [steelLine(steel.id, 120)]);
    await approvePr(db, f.users.pm, atOwner.id);
    await expect(rejectPr(db, f.users.pm, atOwner.id, 'ไม่เอา')).rejects.toMatchObject({ status: 403 });
    await rejectPr(db, f.users.owner, atOwner.id, 'ใช้เท่า BOQ');
    expect((await getPr(db, f.users.pm, atOwner.id)).status).toBe('REJECTED');
    expect(await prNotes(db, f.users.pm.id, atOwner.number)).toContainEqual(expect.stringContaining('เจ้าของไม่อนุมัติซื้อเกิน BOQ'));
  });

  test('the owner does not see or decide a PR before the PM; it shows up once the PM passes it on', async () => {
    const { db, f, steel } = await setup();
    const pr = await submittedPr(db, f, [steelLine(steel.id, 150)]);
    const ownerSees = async () => (await listPendingApprovals(db, f.users.owner)).filter((a) => a.type === 'PR').map((a) => a.id);

    expect(await ownerSees()).toEqual([]);
    expect(await prNotes(db, f.users.owner.id, pr.number)).toEqual([]);
    await expect(approvePr(db, f.users.owner, pr.id)).rejects.toMatchObject({ status: 403 });
    await expect(rejectPr(db, f.users.owner, pr.id, 'ไม่เอา')).rejects.toMatchObject({ status: 403 });

    await approvePr(db, f.users.pm, pr.id);
    expect(await ownerSees()).toEqual([pr.id]);
  });

  test('on a project without a PM, the owner is told, sees the PR and approves it outright', async () => {
    const { db, f, cementB } = await setup();
    // Project B has no PM; 60 bags is over its BOQ of 50
    const pr = await createPr(db, f.users.otherForeman, {
      projectId: f.projectB,
      prType: 'GOODS',
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', category: 'งานโครงสร้าง', qty: D(60), boqLineId: cementB.id }],
    });
    await submitPr(db, f.users.otherForeman, pr.id);
    expect(await prNotes(db, f.users.owner.id, pr.number)).toEqual([expect.stringContaining('โครงการไม่มี PM')]);
    expect((await listPendingApprovals(db, f.users.owner)).map((a) => a.id)).toContain(pr.id);

    await approvePr(db, f.users.owner, pr.id);
    expect((await getPr(db, f.users.owner, pr.id)).status).toBe('APPROVED');
  });

  test('goods outside the BOQ need the owner too', async () => {
    const { db, f } = await setup();
    const pr = await submittedPr(db, f, [{ description: 'ตะปู', unitName: 'กล่อง', category: 'งานโครงสร้าง', qty: D(3), outsideBoq: true }]);
    const check = (await getPr(db, f.users.pm, pr.id)).boqCheck;
    expect(check).toMatchObject({ needsOwner: true, outside: [{ description: 'ตะปู', qty: '3', unit: 'กล่อง' }] });
    await approvePr(db, f.users.pm, pr.id);
    expect((await getPr(db, f.users.pm, pr.id)).status).toBe('OWNER_REVIEW');
  });

  test('once the project has a BOQ, a PR is sent only when every goods line names its BOQ line', async () => {
    const { db, f, cementB } = await setup();
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      prType: 'GOODS',
      lines: [{ description: 'ทราย', unitName: 'คิว', category: 'งานโครงสร้าง', qty: D(2) }],
    });
    await expect(submitPr(db, f.users.foreman, pr.id)).rejects.toMatchObject({ code: 'BOQ_LINE_REQUIRED' });
    // Another project's BOQ line is refused
    await expect(
      createPr(db, f.users.foreman, { projectId: f.projectA, prType: 'GOODS', lines: [steelLine(cementB.id, 1)] }),
    ).rejects.toMatchObject({ code: 'BOQ_LINE_MISMATCH' });
  });

  test('hired work is not checked against the BOQ', async () => {
    const { db, f, steel } = await setup();
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      prType: 'LABOR',
      lines: [{ description: 'ค่าแรงผูกเหล็ก', unitName: 'งาน', category: 'งานโครงสร้าง', qty: D(1), estUnitPrice: D(5000), boqLineId: steel.id }],
    });
    await submitPr(db, f.users.foreman, pr.id);
    const got = await getPr(db, f.users.pm, pr.id);
    expect(got.lines[0]!.boqLineId).toBeNull();
    await approvePr(db, f.users.pm, pr.id);
    expect((await getPr(db, f.users.pm, pr.id)).status).toBe('APPROVED');
  });

  test('the PR form lists the BOQ with what approved PRs already ask for', async () => {
    const { db, f, steel } = await setup();
    const pr = await submittedPr(db, f, [steelLine(steel.id, 30)]);
    await approvePr(db, f.users.pm, pr.id);
    const options = await listBoqQtyOptions(db, f.users.foreman);
    // The foreman only sees project A
    expect(options).toEqual([expect.objectContaining({ id: steel.id, unit: 'เส้น', qty: 100, requested: 30, remaining: 70 })]);
  });
});

describe('item quantity alerts', () => {
  test('the PM and purchasing are told at 50%, 80%, 100% and over; the owner is not', async () => {
    const { db, f, steel } = await setup();
    for (const [qty, by] of [
      [50, f.users.pm],
      [30, f.users.pm],
      [20, f.users.pm],
    ] as const) {
      const pr = await submittedPr(db, f, [steelLine(steel.id, qty)]);
      await approvePr(db, by, pr.id);
    }
    const over = await submittedPr(db, f, [steelLine(steel.id, 5)]);
    await approvePr(db, f.users.pm, over.id); // waits on the owner, but already counts

    for (const told of [f.users.pm, f.users.buyer, f.users.buyerHead]) {
      expect(await qtyAlerts(db, told.id)).toEqual(['NOTICE', 'WARNING', 'CRITICAL', 'OVER']);
    }
    for (const other of [f.users.owner, f.users.finance, f.users.foreman, f.users.otherForeman]) {
      expect(await qtyAlerts(db, other.id)).toEqual([]);
    }
  });

  test('a cancelled or closed PR lowers the level so the next request alerts again', async () => {
    const { db, f, steel } = await setup();
    const pr = await submittedPr(db, f, [steelLine(steel.id, 50)]);
    await approvePr(db, f.users.pm, pr.id);
    await cancelPr(db, f.users.foreman, pr.id);
    const again = await submittedPr(db, f, [steelLine(steel.id, 50)]);
    await approvePr(db, f.users.pm, again.id);
    expect(await qtyAlerts(db, f.users.pm.id)).toEqual(['NOTICE', 'NOTICE']);

    // Closed with nothing ordered: the quantity is released
    await closePr(db, f.users.pm, again.id);
    const third = await submittedPr(db, f, [steelLine(steel.id, 60)]);
    await approvePr(db, f.users.pm, third.id);
    expect(await qtyAlerts(db, f.users.pm.id)).toEqual(['NOTICE', 'NOTICE', 'NOTICE']);
  });
});

describe('PO approval by the owner alone', () => {
  test('with the approval limit at 0, the head of purchasing cannot approve a 10,000 baht PO and the owner can', async () => {
    const { db, f } = await setup();
    await updateSettings(db, f.users.owner, { poApprovalLimit: 0 });
    const po = await createPo(db, f.users.buyer, {
      projectId: null,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'กระดาษ A4', unitName: 'รีม', qty: D(100), unitPrice: D(100), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await expect(approvePo(db, f.users.buyerHead, po.id)).rejects.toMatchObject({ status: 403 });
    await approvePo(db, f.users.owner, po.id);
    expect((await getPo(db, f.users.owner, po.id)).status).toBe('APPROVED');
  });
});
