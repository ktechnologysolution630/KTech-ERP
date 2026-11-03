import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { computeBoqOverrun } from '@/domain/boq-overrun';
import { D } from '@/domain/money';
import { getProjectBoqSheet, saveProjectMainBoq } from '@/server/services/boq';
import {
  decideBoqOverrun,
  getPoBoqCheck,
  listBoqMaterialOptions,
  requestBoqOverrun,
} from '@/server/services/boq-overrun';
import { approvePo, createPo, getPo, rejectPo, submitPo, updatePo } from '@/server/services/po';

describe('computeBoqOverrun', () => {
  const boqLines = [{ id: 'a', no: '1.1', description: 'เสาเข็ม', qty: 10, materialRate: 20_000 }];

  test('only the part of the excess caused by this PO counts', () => {
    const r = computeBoqOverrun({
      boqLines,
      thisPoByBoqLine: new Map([['a', D(100_000)]]),
      committedElsewhereByBoqLine: new Map([['a', D(150_000)]]),
    });
    expect(r.overAmount.toFixed(2)).toBe('50000.00');
    expect(r.lines[0]).toMatchObject({ budget: '200000.00', thisPo: '100000.00', over: '50000.00' });
  });

  test('a PO is never charged more than its own amount', () => {
    const r = computeBoqOverrun({
      boqLines,
      thisPoByBoqLine: new Map([['a', D(10_000)]]),
      committedElsewhereByBoqLine: new Map([['a', D(500_000)]]),
    });
    expect(r.overAmount.toFixed(2)).toBe('10000.00');
  });

  test('within budget returns nothing', () => {
    const r = computeBoqOverrun({
      boqLines,
      thisPoByBoqLine: new Map([['a', D(200_000)]]),
      committedElsewhereByBoqLine: new Map(),
    });
    expect(r.lines).toHaveLength(0);
    expect(r.overAmount.isZero()).toBe(true);
  });
});

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
    lines: [
      { isCategory: true, isBold: true, no: '1', description: 'งานฐานราก', qty: '', unit: '', materialRate: '', laborRate: '', note: '' },
      { isCategory: false, isBold: false, no: '1.1', description: 'เสาเข็ม', qty: 10, unit: 'ต้น', materialRate: 20_000, laborRate: 5_000, note: '' },
    ],
  });
  const sheet = await getProjectBoqSheet(db, f.users.pm, f.projectA);
  const pileLine = sheet.boq!.lines[1];
  return { db, f, pileLine, sheet };
}

function poInput(projectId: string, vendorId: string, boqLineId: string | null, qty: number) {
  return {
    projectId,
    vendorId,
    paymentType: 'CREDIT' as const,
    creditDays: 30,
    vatMode: 'EXCLUSIVE' as const,
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ boqLineId, description: 'เสาเข็มเจาะ', unitName: 'ต้น', qty: D(qty), unitPrice: D(20_000), discount: D(0) }],
  };
}

describe('over-BOQ approval (AP)', () => {
  test('PO within budget approves; the next one over budget needs an approved AP', async () => {
    const { db, f, pileLine } = await setup();

    const po1 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 7));
    await submitPo(db, f.users.buyer, po1.id);
    await approvePo(db, f.users.owner, po1.id);

    const options = await listBoqMaterialOptions(db, f.users.buyer);
    expect(options.find((o) => o.id === pileLine.id)).toMatchObject({ budget: 200_000, committed: 140_000, remaining: 60_000 });

    const po2 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 5));
    await submitPo(db, f.users.buyer, po2.id);
    const check = await getPoBoqCheck(db, f.users.buyer, po2.id);
    expect(check).toMatchObject({ overAmount: 40_000, covered: false, canRequest: true });

    await expect(approvePo(db, f.users.owner, po2.id)).rejects.toMatchObject({ code: 'BOQ_OVERRUN', status: 409 });

    await expect(requestBoqOverrun(db, f.users.buyer, po2.id, '  ')).rejects.toMatchObject({ status: 400 });
    const ap = await requestBoqOverrun(db, f.users.buyer, po2.id, 'ชั้นดินลึกกว่าที่สำรวจ ต้องเพิ่มเสาเข็ม');
    expect(ap.number).toMatch(/^AP-\d{4}-0001$/);
    await expect(requestBoqOverrun(db, f.users.buyer, po2.id, 'ซ้ำ')).rejects.toMatchObject({ status: 409 });

    await expect(decideBoqOverrun(db, f.users.buyerHead, ap.id, true, '')).rejects.toMatchObject({ status: 403 });
    await decideBoqOverrun(db, f.users.owner, ap.id, true, '');
    await approvePo(db, f.users.owner, po2.id);
    expect((await getPo(db, f.users.owner, po2.id)).status).toBe('APPROVED');
  });

  test('an AP for a smaller overrun does not cover a later increase', async () => {
    const { db, f, pileLine } = await setup();
    const po = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 11));
    await submitPo(db, f.users.buyer, po.id);
    const ap = await requestBoqOverrun(db, f.users.buyer, po.id, 'เพิ่ม 1 ต้น');
    await decideBoqOverrun(db, f.users.owner, ap.id, true, '');

    // Rejected back for edits and enlarged: same revision, larger overrun
    await rejectPo(db, f.users.owner, po.id, 'เพิ่มจำนวนตามหน้างาน');
    await updatePo(db, f.users.buyer, po.id, poInput(f.projectA, f.vendorCo, pileLine.id, 12));
    await submitPo(db, f.users.buyer, po.id);
    await expect(approvePo(db, f.users.owner, po.id)).rejects.toMatchObject({ status: 409 });
  });

  test('rejecting an AP needs a reason and keeps the PO blocked', async () => {
    const { db, f, pileLine } = await setup();
    const po = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 12));
    await submitPo(db, f.users.buyer, po.id);
    const ap = await requestBoqOverrun(db, f.users.buyer, po.id, 'เพิ่มเติม');
    await expect(decideBoqOverrun(db, f.users.owner, ap.id, false, '')).rejects.toMatchObject({ status: 400 });
    await decideBoqOverrun(db, f.users.owner, ap.id, false, 'ให้ทำ VO แทน');
    await expect(approvePo(db, f.users.owner, po.id)).rejects.toMatchObject({ status: 409 });
    expect((await getPoBoqCheck(db, f.users.buyer, po.id)).canRequest).toBe(true);
  });

  test('BOQ lines used by a PO keep their id across saves and cannot be deleted', async () => {
    const { db, f, pileLine, sheet } = await setup();
    await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 1));

    const base = {
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
    const lines = sheet.boq!.lines.map((l) => ({ ...l }));
    lines[1].qty = 12;
    const saved = await saveProjectMainBoq(db, f.users.pm, f.projectA, {
      ...base,
      baseUpdatedAt: sheet.boq!.updatedAt,
      lines,
    });
    expect(saved.lines[1].id).toBe(pileLine.id);

    await expect(
      saveProjectMainBoq(db, f.users.pm, f.projectA, { ...base, baseUpdatedAt: saved.updatedAt, lines: [lines[0]] }),
    ).rejects.toMatchObject({ code: 'BOQ_LINE_IN_USE', status: 409 });
  });

  test('PO lines must point at a material line of the same project', async () => {
    const { db, f, pileLine, sheet } = await setup();
    await expect(
      createPo(db, f.users.buyer, poInput(f.projectB, f.vendorCo, pileLine.id, 1)),
    ).rejects.toMatchObject({ code: 'BOQ_LINE_MISMATCH' });
    await expect(
      createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, sheet.boq!.lines[0].id, 1)),
    ).rejects.toMatchObject({ code: 'BOQ_LINE_MISMATCH' });
  });
});
