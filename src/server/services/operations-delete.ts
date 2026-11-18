import { and, eq, inArray } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  advances,
  boqLines,
  boqOverrunRequests,
  boqs,
  dailyReports,
  payables,
  poInstallments,
  poLines,
  pos,
  prLines,
  projectHandovers,
  projects,
  prs,
  pvLines,
  pvs,
  stockAdjustRequests,
  stockCounts,
  variationOrders,
  vehicleTripExpenses,
  vehicleTrips,
  warrantyDefects,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan } from '@/server/policy';
import { deletePo } from './po-delete';
import { guarded, logDeletes, MUST_CANCEL_FIRST, notFound, outcome, parseIds, removeTraces, split, type DeleteOutcome } from './record-delete';

/**
 * Permanent deletes for the purchasing, stock, vehicle, project and after-sales menus, e.g. test data or a record
 * keyed in wrongly. As on the accounting side: whatever is still in force stays (cancel it first, or it is a record
 * others rely on), each kept record says why, and the activity log keeps the record with its number.
 */

const APPROVED_STAYS = 'อนุมัติแล้ว ลบไม่ได้';

// ───────────────────────────── Purchasing ─────────────────────────────

/** Requests to buy over the BOQ (ใบ AP) not approved; an approved one is the record the PO was approved on */
export async function deleteBoqOverrunRequests(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: boqOverrunRequests.id, number: boqOverrunRequests.number, status: boqOverrunRequests.status, poId: boqOverrunRequests.poId })
        .from(boqOverrunRequests)
        .where(inArray(boqOverrunRequests.id, picked))
        .for('update');
      if (targets.length === 0) throw notFound('ใบ AP');
      const { go, kept } = split(targets, (t) => (t.status === 'APPROVED' ? `${APPROVED_STAYS} (เป็นหลักฐานที่ใช้อนุมัติใบสั่งซื้อ)` : null));
      if (go.length > 0) {
        await tx.delete(boqOverrunRequests).where(inArray(boqOverrunRequests.id, go.map((t) => t.id)));
        // In the history of the PO it was raised on
        await logDeletes(tx, actor, 'PO', go.map((t) => ({ ...t, logEntityId: t.poId, action: 'BOQ_OVERRUN_DELETED', note: `ลบใบ AP ${t.number}`, numbers: [t.number] })));
      }
      return outcome(go, kept);
    }),
  );
}

const PAYABLE_SOURCE: Record<string, string> = {
  CREDIT_INVOICE: 'ใบแจ้งหนี้',
  PREPAID_REQUEST: 'ขอจ่ายล่วงหน้า',
  INSTALLMENT: 'งวดผ่อนชำระ',
  CONTRACTOR_CLAIM: 'เบิกงวดผู้รับเหมา',
  EXPENSE: 'เบิกค่าใช้จ่าย',
  LABOR: 'ค่าแรง',
};

/**
 * Bills waiting in the payment queue that no voucher took. A prepaid or instalment request goes and can be asked
 * for again; a bill raised by a vendor invoice or a PRV goes with that document instead.
 */
export async function deletePayables(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: payables.id,
          status: payables.status,
          sourceType: payables.sourceType,
          installmentId: payables.installmentId,
          poId: payables.poId,
          note: payables.note,
          gross: payables.gross,
          poNumber: pos.number,
        })
        .from(payables)
        .leftJoin(pos, eq(pos.id, payables.poId))
        .where(inArray(payables.id, picked))
        .for('update', { of: payables });
      if (rows.length === 0) throw notFound('รายการตั้งจ่าย');
      const targets = rows.map((r) => ({ ...r, number: [PAYABLE_SOURCE[r.sourceType] ?? r.sourceType, r.poNumber ?? r.note, `${r.gross} บาท`].filter(Boolean).join(' ') }));
      const onPvs = await tx
        .select({ payableId: pvLines.payableId, pvNumber: pvs.number })
        .from(pvLines)
        .innerJoin(pvs, eq(pvs.id, pvLines.pvId))
        .where(inArray(pvLines.payableId, targets.map((t) => t.id)));
      const { go, kept } = split(targets, (t) => {
        if (t.status === 'PAID') return 'จ่ายเงินแล้ว ลบไม่ได้';
        if (t.status === 'IN_PV') return 'อยู่ในใบสำคัญจ่ายแล้ว ยกเลิกหรือลบใบสำคัญจ่ายก่อน';
        if (t.sourceType === 'CREDIT_INVOICE') return 'เกิดจากใบแจ้งหนี้ผู้ขาย ให้ยกเลิกแล้วลบใบแจ้งหนี้นั้นแทน';
        if (t.sourceType === 'CONTRACTOR_CLAIM' || t.sourceType === 'EXPENSE') return 'เกิดจากใบขอเบิก (PRV) ให้ลบใบขอเบิกนั้นแทน';
        const pv = [...new Set(onPvs.filter((l) => l.payableId === t.id).map((l) => l.pvNumber))];
        return pv.length > 0 ? `เคยอยู่ในใบสำคัญจ่าย ${pv.join(', ')} ลบใบสำคัญจ่ายนั้นก่อน` : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        // An instalment asked for can be asked for again
        const installmentIds = go.filter((t) => t.status === 'OPEN' && t.installmentId).map((t) => t.installmentId!);
        if (installmentIds.length > 0) {
          await tx.update(poInstallments).set({ status: 'PENDING' }).where(and(inArray(poInstallments.id, installmentIds), eq(poInstallments.status, 'REQUESTED')));
        }
        await removeTraces(tx, goIds);
        // Matches to vendor invoices go with it (on delete cascade)
        await tx.delete(payables).where(inArray(payables.id, goIds));
        await logDeletes(
          tx,
          actor,
          go[0]!.poId ? 'PO' : 'PAYABLE',
          go.map((t) => ({ ...t, logEntityId: t.poId ?? t.id, action: 'PAYABLE_DELETED', note: `ลบรายการตั้งจ่าย ${t.number}` })),
        );
      }
      return outcome(go, kept);
    }),
  );
}

/** Several POs at once, each the way the PO page deletes it; one something still depends on stays */
export async function deletePos(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'po.delete');
  const picked = parseIds(ids);
  const rows = await db.select({ id: pos.id, number: pos.number }).from(pos).where(inArray(pos.id, picked));
  if (rows.length === 0) throw notFound('ใบสั่งซื้อ');
  const result: DeleteOutcome = { deleted: [], kept: [] };
  for (const po of rows) {
    try {
      await deletePo(db, actor, po.id);
      result.deleted.push(po);
    } catch (err) {
      if (!(err instanceof DomainError) || err.status === 403) throw err;
      result.kept.push({ ...po, reason: err.message.replace(`${po.number} `, '') });
    }
  }
  return result;
}

// ───────────────────────────── Stock ─────────────────────────────

/** Stock counts: a record of what was counted, never posted to the balances */
export async function deleteStockCounts(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return db.transaction(async (tx) => {
    const go = await tx.select({ id: stockCounts.id, number: stockCounts.countNumber }).from(stockCounts).where(inArray(stockCounts.id, picked)).for('update');
    if (go.length === 0) throw notFound('ใบนับสต็อก');
    // Lines go with the count (on delete cascade)
    await tx.delete(stockCounts).where(inArray(stockCounts.id, go.map((t) => t.id)));
    await logDeletes(tx, actor, 'STOCK_ADJUST', go.map((t) => ({ ...t, action: 'COUNT_DELETED', note: `ลบใบนับสต็อก ${t.number}`, numbers: [t.number] })));
    return outcome(go, []);
  });
}

/** Adjustment requests not approved; an approved one has already changed the balance */
export async function deleteStockAdjustRequests(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return db.transaction(async (tx) => {
    const targets = await tx
      .select({ id: stockAdjustRequests.id, number: stockAdjustRequests.requestNumber, status: stockAdjustRequests.status })
      .from(stockAdjustRequests)
      .where(inArray(stockAdjustRequests.id, picked))
      .for('update');
    if (targets.length === 0) throw notFound('คำขอปรับยอด');
    const { go, kept } = split(targets, (t) => (t.status === 'APPROVED' ? 'อนุมัติแล้ว ยอดสต็อกถูกปรับไปแล้ว ลบไม่ได้ (ทำคำขอปรับกลับแทน)' : null));
    if (go.length > 0) {
      const goIds = go.map((t) => t.id);
      await removeTraces(tx, goIds);
      await tx.delete(stockAdjustRequests).where(inArray(stockAdjustRequests.id, goIds));
      await logDeletes(tx, actor, 'STOCK_ADJUST', go.map((t) => ({ ...t, note: `ลบคำขอปรับยอด ${t.number}`, numbers: [t.number] })));
    }
    return outcome(go, kept);
  });
}

// ───────────────────────────── Vehicles ─────────────────────────────

/** Trips not under way: asked for, refused, cancelled or returned. A cost claimed on an advance holds the trip. */
export async function deleteVehicleTrips(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx.select({ id: vehicleTrips.id, number: vehicleTrips.number, status: vehicleTrips.status }).from(vehicleTrips).where(inArray(vehicleTrips.id, picked)).for('update');
      if (targets.length === 0) throw notFound('รายการใช้รถ');
      const expenses = await tx
        .select({ id: vehicleTripExpenses.id, tripId: vehicleTripExpenses.tripId, claimNumber: advances.number })
        .from(vehicleTripExpenses)
        .leftJoin(advances, eq(advances.id, vehicleTripExpenses.claimId))
        .where(inArray(vehicleTripExpenses.tripId, targets.map((t) => t.id)));
      const { go, kept } = split(targets, (t) => {
        if (t.status === 'APPROVED') return MUST_CANCEL_FIRST;
        if (t.status === 'IN_USE') return 'กำลังใช้รถอยู่ ลบไม่ได้';
        const claims = [...new Set(expenses.filter((e) => e.tripId === t.id && e.claimNumber).map((e) => e.claimNumber!))];
        return claims.length > 0 ? `มีค่าใช้จ่ายที่เบิกในใบขอเงินทดรอง ${claims.join(', ')} ลบใบนั้นก่อน` : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        await removeTraces(tx, [...goIds, ...expenses.filter((e) => goIds.includes(e.tripId)).map((e) => e.id)], goIds.map((id) => `/vehicles/${id}`));
        // Positions and costs go with the trip (on delete cascade)
        await tx.delete(vehicleTrips).where(inArray(vehicleTrips.id, goIds));
        await logDeletes(tx, actor, 'VEHICLE_TRIP', go.map((t) => ({ ...t, note: `ลบรายการใช้รถ ${t.number}`, numbers: [t.number] })));
      }
      return outcome(go, kept);
    }),
  );
}

// ───────────────────────────── After-sales ─────────────────────────────

/** A handover not yet accepted; an accepted one closed the project and issued its warranty */
export async function deleteHandovers(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: projectHandovers.id, status: projectHandovers.status, projectId: projectHandovers.projectId, code: projects.code, name: projects.name })
      .from(projectHandovers)
      .innerJoin(projects, eq(projects.id, projectHandovers.projectId))
      .where(inArray(projectHandovers.id, picked))
      .for('update', { of: projectHandovers });
    if (rows.length === 0) throw notFound('รายการส่งมอบ');
    const targets = rows.map((r) => ({ ...r, number: `${r.code} ${r.name}` }));
    const { go, kept } = split(targets, (t) => (t.status === 'ACCEPTED' ? 'ลูกค้ารับมอบแล้ว ออกใบรับประกันแล้ว ลบไม่ได้' : null));
    if (go.length > 0) {
      await tx.delete(projectHandovers).where(inArray(projectHandovers.id, go.map((t) => t.id)));
      await logDeletes(tx, actor, 'PROJECT', go.map((t) => ({ ...t, logEntityId: t.projectId, action: 'HANDOVER_DELETED', note: `ลบรายการส่งมอบโครงการ ${t.number}` })));
    }
    return outcome(go, kept);
  });
}

/** Warranty defects reported against a project */
export async function deleteWarrantyDefects(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return db.transaction(async (tx) => {
    const go = await tx
      .select({ id: warrantyDefects.id, number: warrantyDefects.number, projectId: warrantyDefects.projectId })
      .from(warrantyDefects)
      .where(inArray(warrantyDefects.id, picked))
      .for('update');
    if (go.length === 0) throw notFound('รายการแจ้งซ่อม');
    await tx.delete(warrantyDefects).where(inArray(warrantyDefects.id, go.map((t) => t.id)));
    await logDeletes(tx, actor, 'PROJECT', go.map((t) => ({ ...t, logEntityId: t.projectId, action: 'DEFECT_DELETED', note: `ลบรายการแจ้งซ่อม ${t.number}`, numbers: [t.number] })));
    return outcome(go, []);
  });
}

// ───────────────────────────── Project ─────────────────────────────

/** Requisitions and POs that buy against these BOQ lines, by BOQ */
async function boqUsers(tx: Db, boqIds: string[]): Promise<Map<string, string[]>> {
  const used = new Map<string, string[]>();
  if (boqIds.length === 0) return used;
  const [prUse, poUse] = await Promise.all([
    tx.selectDistinct({ boqId: boqLines.boqId, number: prs.number }).from(prLines).innerJoin(boqLines, eq(boqLines.id, prLines.boqLineId)).innerJoin(prs, eq(prs.id, prLines.prId)).where(inArray(boqLines.boqId, boqIds)),
    tx.selectDistinct({ boqId: boqLines.boqId, number: pos.number }).from(poLines).innerJoin(boqLines, eq(boqLines.id, poLines.boqLineId)).innerJoin(pos, eq(pos.id, poLines.poId)).where(inArray(boqLines.boqId, boqIds)),
  ]);
  for (const u of [...prUse, ...poUse]) used.set(u.boqId, [...(used.get(u.boqId) ?? []), u.number]);
  return used;
}

const usedByText = (numbers: string[]) => `มีใบขอซื้อ/ใบสั่งซื้อซื้อตามรายการใน BOQ นี้: ${numbers.slice(0, 5).join(', ')}${numbers.length > 5 ? ` และอีก ${numbers.length - 5} ใบ` : ''}`;

/** Variation orders not approved, with the BOQ written for them */
export async function deleteVariationOrders(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: variationOrders.id, number: variationOrders.number, status: variationOrders.status })
        .from(variationOrders)
        .where(inArray(variationOrders.id, picked))
        .for('update');
      if (targets.length === 0) throw notFound('VO');
      const voBoqs = await tx.select({ id: boqs.id, voId: boqs.voId, number: boqs.number }).from(boqs).where(inArray(boqs.voId, targets.map((t) => t.id)));
      const used = await boqUsers(tx, voBoqs.map((b) => b.id));
      const { go, kept } = split(targets, (t) => {
        if (t.status === 'APPROVED') return `${APPROVED_STAYS} (มูลค่าสัญญาเปลี่ยนตาม VO นี้แล้ว)`;
        const numbers = voBoqs.filter((b) => b.voId === t.id).flatMap((b) => used.get(b.id) ?? []);
        return numbers.length > 0 ? usedByText(numbers) : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        const goBoqs = voBoqs.filter((b) => b.voId && goIds.includes(b.voId));
        await removeTraces(tx, [...goIds, ...goBoqs.map((b) => b.id)]);
        // The VO's BOQ and its lines go with it (on delete cascade)
        await tx.delete(variationOrders).where(inArray(variationOrders.id, goIds));
        await logDeletes(
          tx,
          actor,
          'VO',
          go.map((t) => ({ ...t, note: `ลบ VO ${t.number}`, numbers: [t.number, ...goBoqs.filter((b) => b.voId === t.id).map((b) => b.number)] })),
        );
      }
      return outcome(go, kept);
    }),
  );
}

/** A whole BOQ nothing has been bought against; a VO's BOQ goes with its VO */
export async function deleteBoqs(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx.select({ id: boqs.id, number: boqs.number, voId: boqs.voId }).from(boqs).where(inArray(boqs.id, picked)).for('update');
      if (targets.length === 0) throw notFound('BOQ');
      const used = await boqUsers(tx, targets.map((t) => t.id));
      const { go, kept } = split(targets, (t) => {
        if (t.voId) return 'เป็น BOQ ของ VO ให้ลบที่ VO แทน';
        const numbers = used.get(t.id) ?? [];
        return numbers.length > 0 ? usedByText(numbers) : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        await removeTraces(tx, goIds);
        // Lines go with the BOQ (on delete cascade); a stock document tagged to a line keeps the document
        await tx.delete(boqs).where(inArray(boqs.id, goIds));
        await logDeletes(tx, actor, 'BOQ', go.map((t) => ({ ...t, note: `ลบ BOQ ${t.number}`, numbers: [t.number] })));
      }
      return outcome(go, kept);
    }),
  );
}

/** Daily site reports; progress a submitted report put on the tasks stays on them */
export async function deleteDailyReports(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return db.transaction(async (tx) => {
    const go = await tx.select({ id: dailyReports.id, number: dailyReports.number }).from(dailyReports).where(inArray(dailyReports.id, picked)).for('update');
    if (go.length === 0) throw notFound('รายงานประจำวัน');
    const goIds = go.map((t) => t.id);
    await removeTraces(tx, goIds);
    await tx.delete(dailyReports).where(inArray(dailyReports.id, goIds));
    await logDeletes(tx, actor, 'DAILY_REPORT', go.map((t) => ({ ...t, note: `ลบรายงานประจำวัน ${t.number}`, numbers: [t.number] })));
    return outcome(go, []);
  });
}

