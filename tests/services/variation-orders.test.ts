import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { D } from '@/domain/money';
import { revisedEndDate, summarizeContract, voTypeLabel } from '@/domain/variation-order';
import { listBoqMaterialOptions } from '@/server/services/boq-overrun';
import { updateProjectDetails } from '@/server/services/master';
import { createPo } from '@/server/services/po';
import {
  cancelVo,
  createVo,
  decideVo,
  getVoBoqSheet,
  getVoDocument,
  listProjectVos,
  saveVoBoq,
  saveVoDocument,
  submitVo,
  updateVo,
} from '@/server/services/variation-orders';
import type { SaveBoqInput } from '@/server/services/boq';

function voBoq(qty: number, base: string | null = null): SaveBoqInput {
  return {
    baseUpdatedAt: base,
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
      { isCategory: false, isBold: false, no: '1', description: 'เสาเข็มเพิ่ม', qty, unit: 'ต้น', materialRate: 20_000, laborRate: 0, note: '' },
    ],
  };
}

describe('variation order maths', () => {
  test('contract value counts only approved VOs', () => {
    const s = summarizeContract(1_000_000, [
      { addAmount: 300_000, deductAmount: 50_000, daysImpact: 30, status: 'APPROVED' },
      { addAmount: 99_999, deductAmount: 0, daysImpact: 10, status: 'PENDING' },
      { addAmount: 77_777, deductAmount: 0, daysImpact: 5, status: 'REJECTED' },
    ]);
    expect(s.current.toNumber()).toBe(1_250_000);
    expect(s.pendingCount).toBe(1);
    expect(s.extensionDays).toBe(30);
    expect(revisedEndDate('2027-01-31', 30)).toBe('2027-03-02');
    expect(voTypeLabel(D(1), D(0))).toBe('งานเพิ่ม');
    expect(voTypeLabel(D(0), D(1))).toBe('งานลด');
    expect(voTypeLabel(D(1), D(1))).toBe('งานเพิ่ม-ลด');
  });
});

describe('variation order service', () => {
  test('VO BOQ drives the add amount; owner approval updates the contract', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await updateProjectDetails(db, f.users.owner, f.projectA, { budget: 1_000_000, endDate: '2027-01-31' });

    const vo = await createVo(db, f.users.pm, f.projectA, {
      title: 'เพิ่มเสาเข็ม 5 ต้น',
      description: 'ดินอ่อนกว่าที่สำรวจ',
      voType: 'ADD_DEDUCT',
      deductAmount: 20_000,
      deductNote: 'ตัดงานรั้วชั่วคราว',
      scheduleImpact: true,
      daysAdded: 14,
    });
    expect(vo.number).toMatch(/^VO-\d{4}-0001$/);

    const boq = await saveVoBoq(db, f.users.pm, vo.id, voBoq(5));
    expect(boq.grandTotal).toBe(107_000);

    let list = await listProjectVos(db, f.users.pm, f.projectA);
    expect(list.vos[0]).toMatchObject({ voType: 'ADD_DEDUCT', addAmount: 100_000, deductAmount: 20_000, netAmount: 80_000, netWithVat: 85_600, boqLineCount: 1 });
    expect(list.contract.current).toBe(1_000_000);

    await submitVo(db, f.users.pm, vo.id);
    await expect(saveVoBoq(db, f.users.pm, vo.id, voBoq(6, boq.updatedAt))).rejects.toMatchObject({ status: 409 });
    await expect(decideVo(db, f.users.pm, vo.id, true, '')).rejects.toMatchObject({ status: 403 });
    await decideVo(db, f.users.owner, vo.id, true, '');

    list = await listProjectVos(db, f.users.owner, f.projectA);
    expect(list.contract).toMatchObject({
      original: 1_000_000,
      approvedAdd: 100_000,
      approvedDeduct: 20_000,
      current: 1_080_000,
      extensionDays: 14,
      revisedEndDate: '2027-02-14',
    });
    await expect(cancelVo(db, f.users.pm, vo.id)).rejects.toMatchObject({ status: 409 });
    expect((await getVoBoqSheet(db, f.users.pm, vo.id)).canEdit).toBe(false);
  });

  test('approved VO BOQ lines become purchasable budget; pending ones do not', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const vo = await createVo(db, f.users.pm, f.projectA, { title: 'งานเพิ่ม', description: 'x' });
    const boq = await saveVoBoq(db, f.users.pm, vo.id, voBoq(2));
    const lineId = boq.lines[0].id;
    const po = (projectId: string) => ({
      projectId,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT' as const,
      creditDays: 30,
      vatMode: 'EXCLUSIVE' as const,
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ boqLineId: lineId, description: 'เสาเข็ม', unitName: 'ต้น', qty: D(1), unitPrice: D(20_000), discount: D(0) }],
    });

    await submitVo(db, f.users.pm, vo.id);
    await expect(createPo(db, f.users.buyer, po(f.projectA))).rejects.toMatchObject({ code: 'BOQ_LINE_MISMATCH' });
    expect((await listBoqMaterialOptions(db, f.users.buyer)).some((o) => o.id === lineId)).toBe(false);

    await decideVo(db, f.users.owner, vo.id, true, '');
    const options = await listBoqMaterialOptions(db, f.users.buyer);
    expect(options.find((o) => o.id === lineId)).toMatchObject({ source: vo.number, budget: 40_000 });
    await expect(createPo(db, f.users.buyer, po(f.projectA))).resolves.toMatchObject({ number: expect.any(String) });
  });

  test('rejected VOs can be revised and resubmitted; empty VOs cannot be submitted', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const vo = await createVo(db, f.users.pm, f.projectA, { title: 'ว่าง', description: 'x' });
    await expect(submitVo(db, f.users.pm, vo.id)).rejects.toMatchObject({ code: 'EMPTY_VO' });

    await updateVo(db, f.users.pm, vo.id, { title: 'ขยายเวลา', description: 'ฝนตก', scheduleImpact: true, daysAdded: 7 });
    await submitVo(db, f.users.pm, vo.id);
    await expect(updateVo(db, f.users.pm, vo.id, { title: 'x', description: 'x' })).rejects.toMatchObject({ status: 409 });
    await expect(decideVo(db, f.users.owner, vo.id, false, '')).rejects.toMatchObject({ status: 400 });
    await decideVo(db, f.users.owner, vo.id, false, 'แนบเหตุผลประกอบ');

    await updateVo(db, f.users.pm, vo.id, { title: 'ขยายเวลา (ฝนตกหนัก)', description: 'ฝนตก', scheduleImpact: true, daysAdded: 7 });
    await submitVo(db, f.users.pm, vo.id);
    expect((await listProjectVos(db, f.users.pm, f.projectA)).vos[0].status).toBe('PENDING');

    await expect(createVo(db, f.users.foreman, f.projectA, { title: 'x', description: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(createVo(db, f.users.pm, f.projectA, { title: 'x', description: '' })).rejects.toMatchObject({ code: 'INVALID_VO' });
  });

  test('VO form saves header and BOQ together; type, schedule and references are enforced', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const header = { title: 'งานผนังเพิ่ม', description: 'ลูกค้าขอเพิ่มผนังห้องเก็บของ', addAmount: 50_000, vatPercent: 0 };

    // Without BOQ item lines the entered add amount is used
    const manual = await saveVoDocument(db, f.users.pm, f.projectA, null, { vo: header, boq: null });
    expect((await getVoDocument(db, f.users.pm, manual.id)).input).toMatchObject({ addAmount: 50_000, voType: 'ADD' });

    // BOQ item lines override it with the before-VAT total; the BOQ VAT follows the VO's
    const priced = await saveVoDocument(db, f.users.pm, f.projectA, null, { vo: header, boq: voBoq(2) });
    const doc = await getVoDocument(db, f.users.pm, priced.id);
    expect(doc.input).toMatchObject({ addAmount: 40_000, vatPercent: 0 });
    expect(doc.boq).toMatchObject({ grandTotal: 40_000, vatPercent: 0 });

    // Header-only edit keeps the BOQ-driven amount even if the form sends a stale manual one
    await updateVo(db, f.users.pm, priced.id, { ...header, addAmount: 1 });
    expect((await getVoDocument(db, f.users.pm, priced.id)).input.addAmount).toBe(40_000);

    await expect(
      saveVoDocument(db, f.users.pm, f.projectA, null, { vo: { ...header, voType: 'DEDUCT', deductAmount: 5_000 }, boq: voBoq(1) }),
    ).rejects.toMatchObject({ code: 'INVALID_VO' });
    await expect(
      saveVoDocument(db, f.users.pm, f.projectA, null, { vo: { ...header, deductAmount: 5_000 }, boq: null }),
    ).rejects.toMatchObject({ code: 'INVALID_VO' });
    await expect(
      saveVoDocument(db, f.users.pm, f.projectA, null, { vo: { ...header, affectedTaskId: crypto.randomUUID() }, boq: null }),
    ).rejects.toMatchObject({ code: 'INVALID_VO' });
    await expect(
      saveVoDocument(db, f.users.pm, f.projectA, null, {
        vo: { ...header, scheduleImpact: true, impactStartDate: '2026-12-10', impactEndDate: '2026-12-01' },
        boq: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_VO' });
    // Affected activity is free text, with or without a linked task; dropped when the plan is unaffected
    const typed = await saveVoDocument(db, f.users.pm, f.projectA, null, {
      vo: { ...header, scheduleImpact: true, affectedActivity: '  งานเทพื้นชั้น 2  ' },
      boq: null,
    });
    expect((await getVoDocument(db, f.users.pm, typed.id)).input).toMatchObject({ affectedActivity: 'งานเทพื้นชั้น 2', affectedTaskId: null });
    const noImpact = await saveVoDocument(db, f.users.pm, f.projectA, null, {
      vo: { ...header, scheduleImpact: false, affectedActivity: 'งานเทพื้นชั้น 2' },
      boq: null,
    });
    expect((await getVoDocument(db, f.users.pm, noImpact.id)).input.affectedActivity).toBe('');
    await expect(
      saveVoDocument(db, f.users.pm, f.projectA, null, { vo: { ...header, scheduleImpact: true, affectedActivity: 'ก'.repeat(301) }, boq: null }),
    ).rejects.toMatchObject({ code: 'INVALID_VO' });

    // A VO id from another project is not editable through this project
    await expect(saveVoDocument(db, f.users.owner, f.projectB, priced.id, { vo: header, boq: null })).rejects.toMatchObject({ status: 404 });

    // Days count only when the VO is marked as affecting the schedule
    const noPlan = await saveVoDocument(db, f.users.pm, f.projectA, null, {
      vo: { ...header, scheduleImpact: false, daysAdded: 9, daysReduced: 2 },
      boq: null,
    });
    const withPlan = await saveVoDocument(db, f.users.pm, f.projectA, null, {
      vo: { ...header, scheduleImpact: true, daysAdded: 9, daysReduced: 2, criticalPath: true, responsibleUserId: f.users.pm.id },
      boq: null,
    });
    const list = await listProjectVos(db, f.users.pm, f.projectA);
    expect(list.vos.find((v) => v.id === noPlan.id)?.daysImpact).toBe(0);
    expect(list.vos.find((v) => v.id === withPlan.id)?.daysImpact).toBe(7);
    expect((await getVoDocument(db, f.users.pm, withPlan.id)).input).toMatchObject({ criticalPath: true, responsibleUserId: f.users.pm.id });
    expect(list.options.users.length).toBeGreaterThan(0);
    await expect(listProjectVos(db, f.users.pm, f.projectB)).rejects.toMatchObject({ status: 403 });
  });
});
