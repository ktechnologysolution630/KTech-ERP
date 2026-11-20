import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { boqCategoryOfLines, categoryOverAmount, computeBoqCategoryOverrun, computeBoqOverrun } from '@/domain/boq-overrun';
import { D } from '@/domain/money';
import { getProjectBoqSheet, saveProjectMainBoq } from '@/server/services/boq';
import {
  decideBoqOverrun,
  getPoBoqCheck,
  listBoqMaterialOptions,
  requestBoqOverrun,
} from '@/server/services/boq-overrun';
import { approvePo, createPo, getPo, rejectPo, submitPo, updatePo, reviewPo } from '@/server/services/po';

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
    await reviewPo(db, f.users.buyerHead, po1.id);
    await approvePo(db, f.users.owner, po1.id);

    const options = await listBoqMaterialOptions(db, f.users.buyer);
    expect(options.find((o) => o.id === pileLine.id)).toMatchObject({ budget: 200_000, committed: 140_000, remaining: 60_000 });

    const po2 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 5));
    await submitPo(db, f.users.buyer, po2.id);
    await reviewPo(db, f.users.buyerHead, po2.id);
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
    await reviewPo(db, f.users.buyerHead, po.id);
    const ap = await requestBoqOverrun(db, f.users.buyer, po.id, 'เพิ่ม 1 ต้น');
    await decideBoqOverrun(db, f.users.owner, ap.id, true, '');

    // Rejected back for edits and enlarged: same revision, larger overrun
    await rejectPo(db, f.users.owner, po.id, 'เพิ่มจำนวนตามหน้างาน');
    await updatePo(db, f.users.buyer, po.id, poInput(f.projectA, f.vendorCo, pileLine.id, 12));
    await submitPo(db, f.users.buyer, po.id);
    await reviewPo(db, f.users.buyerHead, po.id);
    await expect(approvePo(db, f.users.owner, po.id)).rejects.toMatchObject({ status: 409 });
  });

  test('rejecting an AP needs a reason and keeps the PO blocked', async () => {
    const { db, f, pileLine } = await setup();
    const po = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 12));
    await submitPo(db, f.users.buyer, po.id);
    await reviewPo(db, f.users.buyerHead, po.id);
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

describe('group (BOQ category) budget needs the owner', () => {
  test('items belong to the nearest category row above them in the same BOQ', () => {
    const cats = boqCategoryOfLines([
      { id: 'x', boqId: 'b1', isCategory: false, no: '', description: 'ก่อนหมวด' },
      { id: 'c1', boqId: 'b1', isCategory: true, no: '2', description: 'งานพื้นและวัสดุปู' },
      { id: 'a', boqId: 'b1', isCategory: false, no: '2.1', description: 'กระเบื้อง' },
      { id: 'y', boqId: 'b2', isCategory: false, no: '1', description: 'อีก BOQ' },
    ]);
    expect(cats.get('a')).toEqual({ id: 'c1', name: '2 งานพื้นและวัสดุปู' });
    expect(cats.has('x')).toBe(false);
    expect(cats.has('y')).toBe(false);
  });

  test('warns when the group goes over even though each line is within its own budget', () => {
    const cat = { id: 'c1', name: 'งานพื้นและวัสดุปู' };
    const r = computeBoqCategoryOverrun({
      categoryOf: new Map([['a', cat], ['b', cat]]),
      budgetByBoqLine: new Map([['a', 100_000], ['b', 50_000]]),
      committedElsewhereByBoqLine: new Map([['a', 90_000], ['b', 50_000]]),
      thisPoByBoqLine: new Map([['a', D(20_000)]]),
    });
    expect(r).toEqual([
      { categoryId: 'c1', name: 'งานพื้นและวัสดุปู', budget: '150000.00', committedElsewhere: '140000.00', thisPo: '20000.00', over: '10000.00', overByThisPo: '10000.00' },
    ]);
  });

  test('a PO is held to its own part when the group was already over', () => {
    const cat = { id: 'c1', name: 'g' };
    const r = computeBoqCategoryOverrun({
      categoryOf: new Map([['a', cat]]),
      budgetByBoqLine: new Map([['a', 100_000]]),
      committedElsewhereByBoqLine: new Map([['a', 150_000]]),
      thisPoByBoqLine: new Map([['a', D(5_000)]]),
    });
    expect(r[0]).toMatchObject({ over: '55000.00', overByThisPo: '5000.00' });
    expect(categoryOverAmount(r).toFixed(2)).toBe('5000.00');
  });

  test('within the group budget there is nothing to warn about', () => {
    const cat = { id: 'c1', name: 'g' };
    const r = computeBoqCategoryOverrun({
      categoryOf: new Map([['a', cat]]),
      budgetByBoqLine: new Map([['a', 100_000]]),
      committedElsewhereByBoqLine: new Map([['a', 50_000]]),
      thisPoByBoqLine: new Map([['a', D(50_000)]]),
    });
    expect(r).toEqual([]);
  });

  test('the PO page and the PO form options show the group spend', async () => {
    const { db, f, pileLine } = await setup();
    const po1 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 8));
    await submitPo(db, f.users.buyer, po1.id);

    const po2 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 3));
    await submitPo(db, f.users.buyer, po2.id);
    const check = await getPoBoqCheck(db, f.users.buyer, po2.id);
    expect(check.categories).toEqual([
      { categoryId: expect.any(String), name: '1 งานฐานราก', budget: '200000.00', committedElsewhere: '160000.00', thisPo: '60000.00', over: '20000.00', overByThisPo: '20000.00' },
    ]);

    const opts = await listBoqMaterialOptions(db, f.users.buyer);
    expect(opts.find((o) => o.id === pileLine.id)).toMatchObject({ categoryName: '1 งานฐานราก', categoryBudget: 200_000, categoryCommitted: 220_000 });
    // Editing po2: its own lines are not counted twice
    const editing = await listBoqMaterialOptions(db, f.users.buyer, { excludePoId: po2.id });
    expect(editing.find((o) => o.id === pileLine.id)).toMatchObject({ committed: 160_000, categoryCommitted: 160_000 });
  });
});

describe('owner approval when a PO goes over its BOQ category (หมวด) budget', () => {
  async function setupTwoLines() {
    const { db, f } = await setup();
    const sheet = await getProjectBoqSheet(db, f.users.pm, f.projectA);
    const lines = [
      ...sheet.boq!.lines.map((l) => ({ ...l })),
      { isCategory: false, isBold: false, no: '1.2', description: 'เหล็กเสริม', qty: 5, unit: 'ตัน', materialRate: 10_000, laborRate: 0, note: '' },
    ];
    await saveProjectMainBoq(db, f.users.pm, f.projectA, {
      baseUpdatedAt: sheet.boq!.updatedAt,
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
      lines,
    });
    const saved = await getProjectBoqSheet(db, f.users.pm, f.projectA);
    return { db, f, pileLine: saved.boq!.lines[1], steelLine: saved.boq!.lines[2] };
  }

  async function approveWithAp(db: Awaited<ReturnType<typeof setup>>['db'], f: Awaited<ReturnType<typeof setup>>['f'], poId: string) {
    const ap = await requestBoqOverrun(db, f.users.buyer, poId, 'จำเป็นตามหน้างาน');
    await decideBoqOverrun(db, f.users.owner, ap.id, true, '');
    await approvePo(db, f.users.owner, poId);
  }

  test('each line within budget but the category over: the owner must approve an AP first', async () => {
    const { db, f, pileLine, steelLine } = await setupTwoLines();
    // Category budget 200,000 + 50,000 = 250,000. Steel: 60,000 against 50,000 (line over, AP approved)
    const po1 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, steelLine.id!, 3));
    await submitPo(db, f.users.buyer, po1.id);
    await reviewPo(db, f.users.buyerHead, po1.id);
    await approveWithAp(db, f, po1.id);

    // Piles: 200,000 is exactly its line budget, but the category ends up at 260,000
    const po2 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id!, 10));
    await submitPo(db, f.users.buyer, po2.id);
    await reviewPo(db, f.users.buyerHead, po2.id);
    const check = await getPoBoqCheck(db, f.users.buyer, po2.id);
    expect(check).toMatchObject({ overAmount: 0, categoryOverAmount: 10_000, covered: false, canRequest: true });

    await expect(approvePo(db, f.users.owner, po2.id)).rejects.toMatchObject({ code: 'BOQ_OVERRUN', status: 409 });

    const ap = await requestBoqOverrun(db, f.users.buyer, po2.id, 'เสาเข็มเพิ่มตามหน้างาน');
    const [dto] = (await getPoBoqCheck(db, f.users.owner, po2.id)).requests;
    expect(dto).toMatchObject({ number: ap.number, overAmount: 0, categoryOverAmount: 10_000 });
    expect(dto.categories[0]).toMatchObject({ name: '1 งานฐานราก', overByThisPo: '10000.00' });

    // Only the owner decides
    await expect(decideBoqOverrun(db, f.users.buyerHead, ap.id, true, '')).rejects.toMatchObject({ status: 403 });
    await decideBoqOverrun(db, f.users.owner, ap.id, true, '');
    await approvePo(db, f.users.owner, po2.id);
    expect((await getPo(db, f.users.owner, po2.id)).status).toBe('APPROVED');
  });

  test('a PO within its category budget needs no AP', async () => {
    const { db, f, pileLine } = await setupTwoLines();
    const po = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id!, 10));
    await submitPo(db, f.users.buyer, po.id);
    await reviewPo(db, f.users.buyerHead, po.id);
    expect(await getPoBoqCheck(db, f.users.buyer, po.id)).toMatchObject({ categoryOverAmount: 0, covered: true, canRequest: false });
    await approvePo(db, f.users.owner, po.id);
    expect((await getPo(db, f.users.owner, po.id)).status).toBe('APPROVED');
  });
});
