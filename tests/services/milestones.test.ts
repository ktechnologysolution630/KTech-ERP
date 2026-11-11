import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { saveProjectMainBoq } from '@/server/services/boq';
import { updateProjectDetails } from '@/server/services/master';
import {
  advanceMilestone,
  cancelMilestone,
  createMilestone,
  deleteMilestone,
  generateMilestonesFromBoq,
  getMilestoneSheet,
  listMilestoneProjects,
  updateMilestone,
} from '@/server/services/milestones';

async function withBoq() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  await updateProjectDetails(db, f.users.owner, f.projectA, { budget: 1_000_000 });
  await saveProjectMainBoq(db, f.users.pm, f.projectA, {
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
    lines: [
      { isCategory: true, isBold: true, no: '1', description: 'งานฐานราก', qty: '', unit: '', materialRate: '', laborRate: '', note: '' },
      { isCategory: false, isBold: false, no: '1.1', description: 'เสาเข็ม', qty: 10, unit: 'ต้น', materialRate: 20_000, laborRate: 5_000, note: '' },
      { isCategory: true, isBold: true, no: '2', description: 'งานโครงสร้าง', qty: '', unit: '', materialRate: '', laborRate: '', note: '' },
      { isCategory: false, isBold: false, no: '2.1', description: 'คอนกรีต', qty: 100, unit: 'ลบ.ม.', materialRate: 2_000, laborRate: 500, note: '' },
    ],
  });
  return { db, f };
}

describe('milestone service', () => {
  test('generate from BOQ: PAY uses direct cost, RECEIVE includes VAT, retention applied', async () => {
    const { db, f } = await withBoq();
    expect(await generateMilestonesFromBoq(db, f.users.pm, f.projectA, 'PAY', 5)).toBe(2);
    await generateMilestonesFromBoq(db, f.users.pm, f.projectA, 'RECEIVE', 5);

    const pay = await getMilestoneSheet(db, f.users.pm, f.projectA, 'PAY');
    expect(pay.rows.map((r) => [r.seq, r.title, r.amount, r.retentionAmount, r.netAmount])).toEqual([
      [1, 'งานฐานราก', 250_000, 12_500, 237_500],
      [2, 'งานโครงสร้าง', 250_000, 12_500, 237_500],
    ]);
    expect(pay.summary).toMatchObject({ budget: 1_000_000, planned: 500_000, unplanned: 500_000, plannedPercent: 50 });

    const receive = await getMilestoneSheet(db, f.users.pm, f.projectA, 'RECEIVE');
    expect(receive.rows.reduce((a, r) => a + r.amount, 0)).toBe(535_000);

    const list = await listMilestoneProjects(db, f.users.owner, 'PAY');
    expect(list.find((p) => p.id === f.projectA)).toMatchObject({ milestoneCount: 2, planned: 500_000 });
  });

  test('lifecycle: manage claims, owner approves, finance pays; edits lock after claim', async () => {
    const { db, f } = await withBoq();
    const { id } = await createMilestone(db, f.users.pm, f.projectA, 'PAY', {
      title: 'งวดที่ 1 งานเตรียมการ',
      amount: 100_000,
      retentionPercent: 5,
      vendorId: f.vendorPerson,
    });

    await expect(advanceMilestone(db, f.users.finance, id)).rejects.toMatchObject({ status: 403 });
    // From a phone or tablet the claim waits for a computer
    await expect(advanceMilestone(db, f.users.pm, id, '2026-11-05', { approvalOnly: true })).rejects.toMatchObject({ code: 'VIEW_ONLY_DEVICE' });
    expect(await advanceMilestone(db, f.users.pm, id, '2026-11-05')).toBe('CLAIMED');
    await expect(updateMilestone(db, f.users.pm, id, { title: 'x', amount: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(deleteMilestone(db, f.users.pm, id)).rejects.toMatchObject({ status: 409 });

    await expect(advanceMilestone(db, f.users.pm, id)).rejects.toMatchObject({ status: 403 });
    // Approving is what a phone may do
    expect(await advanceMilestone(db, f.users.owner, id, undefined, { approvalOnly: true })).toBe('APPROVED');
    await expect(advanceMilestone(db, f.users.finance, id, '2026-11-20', { approvalOnly: true })).rejects.toMatchObject({ code: 'VIEW_ONLY_DEVICE' });
    expect(await advanceMilestone(db, f.users.finance, id, '2026-11-20')).toBe('PAID');
    await expect(advanceMilestone(db, f.users.owner, id)).rejects.toMatchObject({ status: 409 });
    await expect(cancelMilestone(db, f.users.pm, id, 'x')).rejects.toMatchObject({ status: 409 });

    const sheet = await getMilestoneSheet(db, f.users.finance, f.projectA, 'PAY');
    expect(sheet.rows[0]).toMatchObject({ status: 'PAID', claimedAt: '2026-11-05', paidAt: '2026-11-20' });
    expect(sheet.summary).toMatchObject({ paidNet: 95_000, retentionHeld: 5_000 });
  });

  test('regenerating from BOQ is refused once a milestone was claimed', async () => {
    const { db, f } = await withBoq();
    await generateMilestonesFromBoq(db, f.users.pm, f.projectA, 'PAY', 0);
    const sheet = await getMilestoneSheet(db, f.users.pm, f.projectA, 'PAY');
    await advanceMilestone(db, f.users.pm, sheet.rows[0].id);
    await expect(generateMilestonesFromBoq(db, f.users.pm, f.projectA, 'PAY', 0)).rejects.toMatchObject({
      status: 409,
    });
    // RECEIVE plan is independent of PAY
    await expect(generateMilestonesFromBoq(db, f.users.pm, f.projectA, 'RECEIVE', 0)).resolves.toBe(2);
  });

  test('validation and access', async () => {
    const { db, f } = await withBoq();
    await expect(
      createMilestone(db, f.users.pm, f.projectA, 'PAY', { title: 'x', amount: 0 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createMilestone(db, f.users.pm, f.projectA, 'PAY', { title: 'x', amount: 10, retentionPercent: 120 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createMilestone(db, f.users.pm, f.projectA, 'RECEIVE', { title: 'x', amount: 10, vendorId: f.vendorCo }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createMilestone(db, f.users.foreman, f.projectA, 'PAY', { title: 'x', amount: 10 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(getMilestoneSheet(db, f.users.pm, f.projectB, 'PAY')).rejects.toMatchObject({ status: 403 });
    await expect(generateMilestonesFromBoq(db, f.users.admin, f.projectB, 'PAY', 5)).rejects.toMatchObject({
      status: 400,
    });
  });
});
