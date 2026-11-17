import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { D } from '@/domain/money';
import { getProjectBoqSheet, saveProjectMainBoq } from '@/server/services/boq';
import { prPdfSigners } from '@/server/services/doc-signers';
import { prLineRefs, renderDocPdf } from '@/server/services/pdf';
import { approvePr, createPr, getPr, submitPr } from '@/server/services/pr';

/** Project A with a BOQ of 100 steel bars, so a PR can stay inside it or go over */
async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
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
    lines: [{ isCategory: false, isBold: false, no: '1.1', description: 'เหล็กเส้น DB12', qty: 100, unit: 'เส้น', materialRate: 200, laborRate: 0, note: '' }],
  });
  const steel = (await getProjectBoqSheet(db, f.users.pm, f.projectA)).boq!.lines[0]!;
  return { db, f, steel };
}

/** The three printed boxes as label → who signed */
async function boxes(db: Awaited<ReturnType<typeof setup>>['db'], pr: Awaited<ReturnType<typeof getPr>>) {
  return (await prPdfSigners(db, pr)).map((s) => [s.label, s.name ?? null]);
}

describe('printed purchase requisition', () => {
  test('inside the BOQ the PM approves and signs the PM box; the executive box stays blank', async () => {
    const { db, f, steel } = await setup();
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      prType: 'GOODS',
      lines: [{ description: 'เหล็กเส้น DB12', unitName: 'เส้น', category: 'งานโครงสร้าง', qty: D(10), boqLineId: steel.id, itemId: f.itemCement }],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const doc = await getPr(db, f.users.pm, pr.id);

    expect(await boxes(db, doc)).toEqual([
      ['ผู้ขอซื้อ / ผู้จัดทำ', f.users.foreman.name],
      ['ผู้จัดการโครงการ (PM)', f.users.pm.name],
      ['ผู้บริหาร', null],
    ]);
    expect((await prLineRefs(db, pr.id)).get(doc.lines[0]!.id)).toEqual({ itemCode: 'MAT-001' });
    expect((await renderDocPdf(db, f.users.pm, 'pr', pr.id)).subarray(0, 4).toString()).toBe('%PDF');
  });

  test('over the BOQ the PM signs, then the owner signs the executive box once approved', async () => {
    const { db, f } = await setup();
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      prType: 'GOODS',
      lines: [{ description: 'ตะปู', unitName: 'กล่อง', category: 'งานโครงสร้าง', qty: D(3), outsideBoq: true }],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);

    const waiting = await getPr(db, f.users.owner, pr.id);
    expect(waiting.status).toBe('OWNER_REVIEW');
    expect(await boxes(db, waiting)).toEqual([
      ['ผู้ขอซื้อ / ผู้จัดทำ', f.users.foreman.name],
      ['ผู้จัดการโครงการ (PM)', f.users.pm.name],
      ['ผู้บริหาร', null],
    ]);

    await approvePr(db, f.users.owner, pr.id);
    expect(await boxes(db, await getPr(db, f.users.owner, pr.id))).toEqual([
      ['ผู้ขอซื้อ / ผู้จัดทำ', f.users.foreman.name],
      ['ผู้จัดการโครงการ (PM)', f.users.pm.name],
      ['ผู้บริหาร', f.users.owner.name],
    ]);
    // A line typed in, not picked from the item list, has no code
    expect([...(await prLineRefs(db, pr.id)).values()]).toEqual([{ itemCode: '' }]);
  });

  test('on a project without a PM the owner approves and signs the executive box', async () => {
    const { db, f } = await setup();
    const pr = await createPr(db, f.users.otherForeman, {
      projectId: f.projectB,
      prType: 'LABOR',
      lines: [{ description: 'ค่าแรงเทพื้น', unitName: 'ตร.ม.', category: 'งานโครงสร้าง', qty: D(20), estUnitPrice: D(150) }],
    });
    await submitPr(db, f.users.otherForeman, pr.id);
    await approvePr(db, f.users.owner, pr.id);

    expect(await boxes(db, await getPr(db, f.users.owner, pr.id))).toEqual([
      ['ผู้ขอจ้าง / ผู้จัดทำ', f.users.otherForeman.name],
      ['ผู้จัดการโครงการ (PM)', null],
      ['ผู้บริหาร', f.users.owner.name],
    ]);
    expect((await renderDocPdf(db, f.users.owner, 'pr', pr.id)).subarray(0, 4).toString()).toBe('%PDF');
  });
});
