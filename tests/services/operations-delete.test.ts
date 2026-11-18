import { describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  activityLogs,
  boqOverrunRequests,
  boqs,
  dailyReports,
  payables,
  projectHandovers,
  stockAdjustRequests,
  stockCounts,
  stockItems,
  variationOrders,
  vehicleTrips,
  warrantyDefects,
} from '@/db/schema';
import { D } from '@/domain/money';
import { createAsset, deleteAssets } from '@/server/services/assets';
import { getProjectBoqSheet, saveProjectMainBoq } from '@/server/services/boq';
import {
  deleteBoqOverrunRequests,
  deleteBoqs,
  deleteDailyReports,
  deleteHandovers,
  deletePayables,
  deletePos,
  deleteStockAdjustRequests,
  deleteStockCounts,
  deleteVehicleTrips,
  deleteVariationOrders,
  deleteWarrantyDefects,
} from '@/server/services/operations-delete';
import { requestInstallment } from '@/server/services/payable';
import { approvePo, createPo, getPo, reviewPo, submitPo } from '@/server/services/po';
import { approvePr, createPr, submitPr } from '@/server/services/pr';
import { cancelTrip, decideTrip, requestTrip, saveVehicleProfile, VEHICLE_CATEGORY } from '@/server/services/vehicles';
import { MUST_CANCEL_FIRST } from '@/server/services/record-delete';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  return { db, f };
}

const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

async function approvedPo(db: Db, f: SeededBasics, paymentType: 'CREDIT' | 'INSTALLMENT' = 'CREDIT') {
  const po = await createPo(db, f.users.buyer, {
    projectId: f.projectA,
    vendorId: f.vendorCo,
    paymentType,
    creditDays: paymentType === 'CREDIT' ? 30 : undefined,
    vatMode: 'INCLUSIVE',
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ description: 'โครงสร้างเหล็ก', qty: D(10), unitName: 'ชุด', unitPrice: D(107), discount: D(0) }],
    installments:
      paymentType === 'INSTALLMENT'
        ? [
            { name: 'มัดจำ 30%', condition: 'BEFORE_PRODUCTION', percent: D(30), amount: D(321) },
            { name: 'งวดสุดท้าย 70%', condition: 'AFTER_DELIVERY', percent: D(70), amount: D(749) },
          ]
        : undefined,
  });
  await submitPo(db, f.users.buyer, po.id);
  await reviewPo(db, f.users.buyerHead, po.id);
  await approvePo(db, f.users.buyerHead, po.id);
  return po;
}

describe('deleting purchasing records', () => {
  test('only the owner and admin may delete', async () => {
    const { db, f } = await setup();
    const [count] = await db.insert(stockCounts).values({ countNumber: 'SC-6911-0001', countedOn: '2026-11-18', countedBy: f.users.owner.id }).returning();
    await expect(deleteStockCounts(db, f.users.buyerHead, [count!.id])).rejects.toMatchObject({ status: 403 });
    expect((await deleteStockCounts(db, f.users.admin, [count!.id])).deleted).toHaveLength(1);
  });

  test('an over-BOQ request not approved goes; an approved one stays', async () => {
    const { db, f } = await setup();
    const po = await approvedPo(db, f);
    const base = { projectId: f.projectA, poId: po.id, overAmount: '100.00', reason: 'ราคาขึ้น', requestedBy: f.users.buyer.id, poRevision: 0, lines: [] };
    const [pending] = await db.insert(boqOverrunRequests).values({ ...base, number: 'AP-6911-0001' }).returning();
    const [approved] = await db.insert(boqOverrunRequests).values({ ...base, number: 'AP-6911-0002', status: 'APPROVED' }).returning();

    const result = await deleteBoqOverrunRequests(db, f.users.owner, [pending!.id, approved!.id]);
    expect(result.deleted).toEqual([{ id: pending!.id, number: 'AP-6911-0001' }]);
    expect(result.kept[0]).toMatchObject({ id: approved!.id });
    const [log] = await db.select().from(activityLogs).where(and(eq(activityLogs.entityId, po.id), eq(activityLogs.action, 'BOQ_OVERRUN_DELETED')));
    expect(log!.data).toEqual({ deletedNumbers: ['AP-6911-0001'] });
  });

  test('an instalment asked for goes from the queue and can be asked for again', async () => {
    const { db, f } = await setup();
    const po = await approvedPo(db, f, 'INSTALLMENT');
    const inst = (await getPo(db, f.users.buyer, po.id)).installments[0]!;
    const payableId = await requestInstallment(db, f.users.buyer, inst.id);
    expect((await getPo(db, f.users.buyer, po.id)).installments[0]!.status).toBe('REQUESTED');

    expect((await deletePayables(db, f.users.owner, [payableId])).deleted).toHaveLength(1);
    expect(await db.select().from(payables).where(eq(payables.id, payableId))).toHaveLength(0);
    expect((await getPo(db, f.users.buyer, po.id)).installments[0]!.status).toBe('PENDING');
    await requestInstallment(db, f.users.buyer, inst.id);
  });

  test('POs go through the bulk delete, for the admin only', async () => {
    const { db, f } = await setup();
    const draft = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูน', qty: D(1), unitName: 'ถุง', unitPrice: D(100), discount: D(0) }],
    });
    await expect(deletePos(db, f.users.owner, [draft.id])).rejects.toMatchObject({ status: 403 });
    const result = await deletePos(db, f.users.admin, [draft.id]);
    expect(result.deleted.map((d) => d.id)).toEqual([draft.id]);
  });
});

describe('deleting stock records', () => {
  test('an adjustment request not approved goes; an approved one changed the balance and stays', async () => {
    const { db, f } = await setup();
    const [item] = await db.insert(stockItems).values({ sku: 'MAT-X', name: 'ทราย' }).returning();
    const base = { stockItemId: item!.id, currentQty: '10', adjustedQty: '8', differenceQty: '-2', reason: 'นับใหม่', requestedBy: f.users.buyer.id };
    const [pending] = await db.insert(stockAdjustRequests).values({ ...base, requestNumber: 'SAR-6911-0001' }).returning();
    const [approved] = await db.insert(stockAdjustRequests).values({ ...base, requestNumber: 'SAR-6911-0002', status: 'APPROVED' }).returning();

    const result = await deleteStockAdjustRequests(db, f.users.owner, [pending!.id, approved!.id]);
    expect(result.deleted.map((d) => d.number)).toEqual(['SAR-6911-0001']);
    expect(result.kept.map((k) => k.number)).toEqual(['SAR-6911-0002']);
  });
});

describe('deleting vehicle records', () => {
  test('a trip asked for goes; an approved one must be cancelled; a vehicle with trips cannot be deleted', async () => {
    const { db, f } = await setup();
    const pickup = (await createAsset(db, f.users.admin, { name: 'กระบะ', category: VEHICLE_CATEGORY, serialNo: 'กข 1' })).id;
    await saveVehicleProfile(db, f.users.admin, pickup, { plateNo: '1กข 1', odometerKm: 1000, serviceEveryKm: null, lastServiceKm: null, bookable: true });
    const asked = await requestTrip(db, f.users.foreman, { assetId: pickup, projectId: f.projectA, purpose: 'ขนปูน', plannedStart: hours(1), plannedEnd: hours(2) });
    const approved = await requestTrip(db, f.users.foreman, { assetId: pickup, projectId: f.projectA, purpose: 'ขนทราย', plannedStart: hours(3), plannedEnd: hours(4) });
    await decideTrip(db, f.users.owner, approved.id, true);

    await expect(deleteAssets(db, f.users.admin, [pickup])).rejects.toMatchObject({ code: 'ASSET_IN_USE' });

    const result = await deleteVehicleTrips(db, f.users.owner, [asked.id, approved.id]);
    expect(result.deleted.map((d) => d.id)).toEqual([asked.id]);
    expect(result.kept).toEqual([{ id: approved.id, number: approved.number, reason: MUST_CANCEL_FIRST }]);
    await cancelTrip(db, f.users.owner, approved.id);
    expect((await deleteVehicleTrips(db, f.users.owner, [approved.id])).deleted).toHaveLength(1);
    expect(await db.select().from(vehicleTrips)).toHaveLength(0);

    // With its trips gone, the vehicle itself can go
    expect(await deleteAssets(db, f.users.admin, [pickup])).toEqual({ deleted: 1 });
  });
});

describe('deleting after-sales and project records', () => {
  test('a handover not yet accepted goes; an accepted one stays; defects go', async () => {
    const { db, f } = await setup();
    const [scheduled] = await db.insert(projectHandovers).values({ projectId: f.projectA, handoverDate: '2026-12-01', updatedBy: f.users.pm.id }).returning();
    const [accepted] = await db
      .insert(projectHandovers)
      .values({ projectId: f.projectB, handoverDate: '2026-11-01', status: 'ACCEPTED', warrantyNumber: 'WAR-6911-0001', updatedBy: f.users.pm.id })
      .returning();
    const result = await deleteHandovers(db, f.users.owner, [scheduled!.id, accepted!.id]);
    expect(result.deleted.map((d) => d.id)).toEqual([scheduled!.id]);
    expect(result.kept[0]).toMatchObject({ id: accepted!.id });

    const [defect] = await db
      .insert(warrantyDefects)
      .values({ projectId: f.projectB, number: 'DF-6911-0001', title: 'หลังคารั่ว', reportedDate: '2026-11-10', createdBy: f.users.pm.id })
      .returning();
    expect((await deleteWarrantyDefects(db, f.users.owner, [defect!.id])).deleted).toEqual([{ id: defect!.id, number: 'DF-6911-0001' }]);
  });

  test('a BOQ a requisition buys against stays; an unused one goes', async () => {
    const { db, f } = await setup();
    const header = { baseUpdatedAt: null, revision: 0, estimateDate: null, projectTitle: '', location: '', owner: '', workDetail: '', estimator: '', overheadPercent: 0, discountAmount: 0, vatPercent: 7, remarks: '' };
    const line = { isCategory: false, isBold: false, no: '1.1', description: 'เหล็กเส้น', qty: 100, unit: 'เส้น', materialRate: 200, laborRate: 0, note: '' };
    await saveProjectMainBoq(db, f.users.pm, f.projectA, { ...header, lines: [line] });
    await saveProjectMainBoq(db, f.users.owner, f.projectB, { ...header, lines: [line] });
    const sheetA = (await getProjectBoqSheet(db, f.users.pm, f.projectA)).boq!;
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [{ description: 'เหล็กเส้น', unitName: 'เส้น', category: 'งานโครงสร้าง', qty: 10, boqLineId: sheetA.lines[0]!.id }],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const [boqA] = await db.select().from(boqs).where(eq(boqs.projectId, f.projectA));
    const [boqB] = await db.select().from(boqs).where(eq(boqs.projectId, f.projectB));

    const result = await deleteBoqs(db, f.users.owner, [boqA!.id, boqB!.id]);
    expect(result.deleted.map((d) => d.id)).toEqual([boqB!.id]);
    expect(result.kept[0]!.reason).toContain(pr.number);
  });

  test('a VO not approved goes; an approved one stays', async () => {
    const { db, f } = await setup();
    const [draft] = await db.insert(variationOrders).values({ projectId: f.projectA, number: 'VO-6911-0001', title: 'เพิ่มห้องน้ำ', requestDate: '2026-11-18', requestedBy: f.users.pm.id }).returning();
    const [approved] = await db
      .insert(variationOrders)
      .values({ projectId: f.projectA, number: 'VO-6911-0002', title: 'เพิ่มหลังคา', requestDate: '2026-11-18', status: 'APPROVED', requestedBy: f.users.pm.id })
      .returning();
    const result = await deleteVariationOrders(db, f.users.owner, [draft!.id, approved!.id]);
    expect(result.deleted.map((d) => d.number)).toEqual(['VO-6911-0001']);
    expect(result.kept.map((k) => k.number)).toEqual(['VO-6911-0002']);
  });

  test('daily reports go, and their numbers are never handed out again', async () => {
    const { db, f } = await setup();
    const [report] = await db.insert(dailyReports).values({ projectId: f.projectA, number: 'DR-6911-0001', reportDate: '2026-11-18', createdBy: f.users.foreman.id }).returning();
    expect((await deleteDailyReports(db, f.users.owner, [report!.id])).deleted).toHaveLength(1);
    const [log] = await db.select().from(activityLogs).where(and(eq(activityLogs.entityId, report!.id), eq(activityLogs.action, 'DELETE')));
    expect(log!.data).toEqual({ deletedNumbers: ['DR-6911-0001'] });
  });
});
