import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  invoices,
  payables,
  poInstallments,
  pos,
  pvLines,
  pvs,
  users,
  vendors,
  type PayMethod,
  type PvStatus,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { computeWht, D, round2, sum, type Decimal } from '@/domain/money';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';
import { lockPo, registerPvCommittedGrossResolver } from './po';
import { triggerPoAutoComplete } from './receipt';

// Hook for Task 16 WHT certificate issuance
let whtCertIssuer: (tx: Db, pvId: string) => Promise<string | null> = async () => null;
export function registerWhtCertIssuer(
  fn: (tx: Db, pvId: string) => Promise<string | null>,
) {
  whtCertIssuer = fn;
}

// Register PV committed gross resolver for PO revision floor check
registerPvCommittedGrossResolver(async (tx, poId) => {
  const rows = await tx
    .select({
      gross: pvLines.gross,
    })
    .from(pvLines)
    .innerJoin(payables, and(eq(payables.id, pvLines.payableId), eq(payables.poId, poId)))
    .innerJoin(
      pvs,
      and(
        eq(pvs.id, pvLines.pvId),
        inArray(pvs.status, ['PENDING_APPROVAL', 'APPROVED', 'PAID']),
      ),
    );
  return sum(rows.map((r) => D(r.gross)));
});

async function lockPv(tx: Db, pvId: string) {
  await tx.execute(sql`SELECT id FROM pvs WHERE id = ${pvId} FOR UPDATE`);
  const [pv] = await tx.select().from(pvs).where(eq(pvs.id, pvId)).limit(1);
  if (!pv) throw new DomainError('NOT_FOUND', 'ไม่พบใบสำคัญจ่าย', 404);
  return pv;
}

export interface CreatePvInput {
  vendorId: string;
  payableIds: string[];
  whtRates?: Record<string, number>;
  note?: string;
}

export async function createPv(
  db: Db,
  actor: SessionUser,
  input: CreatePvInput,
): Promise<{ id: string; number: string }> {
  assertCan(actor, 'pv.manage');

  const uniquePayableIds = Array.from(new Set(input.payableIds.filter(Boolean)));
  if (uniquePayableIds.length === 0) {
    throw new DomainError('EMPTY_LINES', 'กรุณาเลือกรายการตั้งหนี้อย่างน้อย 1 รายการ', 400);
  }

  return db.transaction(async (tx) => {
    const [vendor] = await tx
      .select()
      .from(vendors)
      .where(eq(vendors.id, input.vendorId))
      .limit(1);
    if (!vendor) throw new DomainError('NOT_FOUND', 'ไม่พบข้อมูลผู้ขาย', 404);

    const selectedPayables = await tx
      .select()
      .from(payables)
      .where(inArray(payables.id, uniquePayableIds));

    if (selectedPayables.length !== uniquePayableIds.length) {
      throw new DomainError('NOT_FOUND', 'ไม่พบรายการตั้งหนี้บางรายการ', 404);
    }

    for (const p of selectedPayables) {
      if (p.vendorId !== vendor.id) {
        throw new DomainError(
          'VENDOR_MISMATCH',
          'รายการตั้งหนี้ทั้งหมดในใบสำคัญจ่ายต้องเป็นผู้ขายรายเดียวกัน',
          400,
        );
      }
      if (p.status !== 'OPEN') {
        throw new DomainError(
          'PAYABLE_NOT_OPEN',
          'รายการตั้งหนี้บางรายการถูกนำไปสร้างใบสำคัญจ่ายหรือจ่ายแล้ว',
          409,
        );
      }
    }

    const number = await nextDocNumber(tx, 'PV', new Date());

    const computedLines = selectedPayables.map((p) => {
      const rate = input.whtRates?.[p.id] ?? vendor.defaultWhtRate ?? 0;
      const beforeVat = round2(D(p.beforeVat));
      const vat = round2(D(p.vat));
      const gross = round2(D(p.gross));
      const wht = computeWht(beforeVat, rate);
      const net = round2(gross.minus(wht));
      return {
        payableId: p.id,
        beforeVat,
        vat,
        gross,
        whtRate: rate,
        wht,
        net,
      };
    });

    const totalBeforeVat = sum(computedLines.map((l) => l.beforeVat));
    const totalVat = sum(computedLines.map((l) => l.vat));
    const totalGross = sum(computedLines.map((l) => l.gross));
    const totalWht = sum(computedLines.map((l) => l.wht));
    const totalNet = sum(computedLines.map((l) => l.net));

    const [created] = await tx
      .insert(pvs)
      .values({
        number,
        vendorId: vendor.id,
        status: 'DRAFT',
        note: input.note?.trim() ?? '',
        createdBy: actor.id,
        beforeVat: totalBeforeVat.toFixed(2),
        vat: totalVat.toFixed(2),
        gross: totalGross.toFixed(2),
        wht: totalWht.toFixed(2),
        net: totalNet.toFixed(2),
      })
      .returning();

    await tx.insert(pvLines).values(
      computedLines.map((l) => ({
        pvId: created!.id,
        payableId: l.payableId,
        beforeVat: l.beforeVat.toFixed(2),
        vat: l.vat.toFixed(2),
        gross: l.gross.toFixed(2),
        whtRate: l.whtRate,
        wht: l.wht.toFixed(2),
        net: l.net.toFixed(2),
      })),
    );

    await tx
      .update(payables)
      .set({ status: 'IN_PV', updatedAt: new Date() })
      .where(inArray(payables.id, uniquePayableIds));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: created!.id,
      action: 'CREATED',
      data: { number, gross: totalGross.toFixed(2), net: totalNet.toFixed(2) },
    });

    return { id: created!.id, number };
  });
}

export async function updatePv(
  db: Db,
  actor: SessionUser,
  id: string,
  input: {
    payableIds: string[];
    whtRates?: Record<string, number>;
    note?: string;
  },
) {
  assertCan(actor, 'pv.manage');
  const uniquePayableIds = Array.from(new Set(input.payableIds.filter(Boolean)));
  if (uniquePayableIds.length === 0) {
    throw new DomainError('EMPTY_LINES', 'กรุณาเลือกรายการตั้งหนี้อย่างน้อย 1 รายการ', 400);
  }

  return db.transaction(async (tx) => {
    const pv = await lockPv(tx, id);
    if (pv.status !== 'DRAFT' && pv.status !== 'REJECTED') {
      throw new DomainError(
        'INVALID_STATUS',
        'แก้ไขใบสำคัญจ่ายได้เฉพาะสถานะร่างหรือถูกตีกลับเท่านั้น',
        409,
      );
    }

    const [vendor] = await tx
      .select()
      .from(vendors)
      .where(eq(vendors.id, pv.vendorId))
      .limit(1);

    const oldLines = await tx
      .select()
      .from(pvLines)
      .where(eq(pvLines.pvId, pv.id));
    const oldPayableIds = oldLines.map((l) => l.payableId);

    // Release old payables to OPEN first
    if (oldPayableIds.length > 0) {
      await tx
        .update(payables)
        .set({ status: 'OPEN', updatedAt: new Date() })
        .where(inArray(payables.id, oldPayableIds));
    }

    const selectedPayables = await tx
      .select()
      .from(payables)
      .where(inArray(payables.id, uniquePayableIds));

    if (selectedPayables.length !== uniquePayableIds.length) {
      throw new DomainError('NOT_FOUND', 'ไม่พบรายการตั้งหนี้บางรายการ', 404);
    }

    for (const p of selectedPayables) {
      if (p.vendorId !== pv.vendorId) {
        throw new DomainError(
          'VENDOR_MISMATCH',
          'รายการตั้งหนี้ทั้งหมดต้องเป็นผู้ขายรายเดียวกัน',
          400,
        );
      }
      if (p.status !== 'OPEN') {
        throw new DomainError(
          'PAYABLE_NOT_OPEN',
          'รายการตั้งหนี้บางรายการอยู่ในใบสำคัญจ่ายอื่นแล้ว',
          409,
        );
      }
    }

    await tx.delete(pvLines).where(eq(pvLines.pvId, pv.id));

    const computedLines = selectedPayables.map((p) => {
      const rate = input.whtRates?.[p.id] ?? vendor?.defaultWhtRate ?? 0;
      const beforeVat = round2(D(p.beforeVat));
      const vat = round2(D(p.vat));
      const gross = round2(D(p.gross));
      const wht = computeWht(beforeVat, rate);
      const net = round2(gross.minus(wht));
      return {
        payableId: p.id,
        beforeVat,
        vat,
        gross,
        whtRate: rate,
        wht,
        net,
      };
    });

    const totalBeforeVat = sum(computedLines.map((l) => l.beforeVat));
    const totalVat = sum(computedLines.map((l) => l.vat));
    const totalGross = sum(computedLines.map((l) => l.gross));
    const totalWht = sum(computedLines.map((l) => l.wht));
    const totalNet = sum(computedLines.map((l) => l.net));

    await tx.insert(pvLines).values(
      computedLines.map((l) => ({
        pvId: pv.id,
        payableId: l.payableId,
        beforeVat: l.beforeVat.toFixed(2),
        vat: l.vat.toFixed(2),
        gross: l.gross.toFixed(2),
        whtRate: l.whtRate,
        wht: l.wht.toFixed(2),
        net: l.net.toFixed(2),
      })),
    );

    await tx
      .update(payables)
      .set({ status: 'IN_PV', updatedAt: new Date() })
      .where(inArray(payables.id, uniquePayableIds));

    await tx
      .update(pvs)
      .set({
        note: input.note?.trim() ?? pv.note,
        beforeVat: totalBeforeVat.toFixed(2),
        vat: totalVat.toFixed(2),
        gross: totalGross.toFixed(2),
        wht: totalWht.toFixed(2),
        net: totalNet.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(pvs.id, pv.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: pv.id,
      action: 'UPDATED',
      data: { gross: totalGross.toFixed(2), net: totalNet.toFixed(2) },
    });
  });
}

export async function submitPv(db: Db, actor: SessionUser, id: string) {
  assertCan(actor, 'pv.manage');

  return db.transaction(async (tx) => {
    const pv = await lockPv(tx, id);
    if (pv.status !== 'DRAFT' && pv.status !== 'REJECTED') {
      throw new DomainError('INVALID_STATUS', 'ใบสำคัญจ่ายไม่อยู่ในสถานะที่ส่งขออนุมัติได้', 409);
    }

    await tx
      .update(pvs)
      .set({
        status: 'PENDING_APPROVAL',
        submittedAt: new Date(),
        rejectReason: null,
        updatedAt: new Date(),
      })
      .where(eq(pvs.id, pv.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: pv.id,
      action: 'SUBMITTED',
    });

    const owners = await usersWithRole(tx, ['OWNER']);
    await notify(tx, owners, {
      title: `ใบสำคัญจ่าย ${pv.number} รออนุมัติ (สุทธิ ฿${pv.net})`,
      href: `/pv/${pv.id}`,
      category: 'FINANCE',
    });
  });
}

export async function approvePv(
  db: Db,
  actor: SessionUser,
  id: string,
  overrideReason?: string,
) {
  assertCan(actor, 'pv.approve');

  return db.transaction(async (tx) => {
    const pv = await lockPv(tx, id);
    if (pv.status !== 'PENDING_APPROVAL') {
      throw new DomainError('INVALID_STATUS', 'ใบสำคัญจ่ายไม่ได้อยู่ในสถานะรออนุมัติ', 409);
    }

    const lines = await tx
      .select({
        line: pvLines,
        poId: payables.poId,
      })
      .from(pvLines)
      .innerJoin(payables, eq(payables.id, pvLines.payableId))
      .where(eq(pvLines.pvId, pv.id));

    const touchedPoIds = Array.from(
      new Set(lines.map((l) => l.poId).filter((pid): pid is string => Boolean(pid))),
    );

    let needsOverride = false;
    for (const poId of touchedPoIds) {
      const po = await lockPo(tx, poId);
      const committedRows = await tx
        .select({ gross: pvLines.gross })
        .from(pvLines)
        .innerJoin(payables, and(eq(payables.id, pvLines.payableId), eq(payables.poId, poId)))
        .innerJoin(
          pvs,
          and(
            eq(pvs.id, pvLines.pvId),
            inArray(pvs.status, ['PENDING_APPROVAL', 'APPROVED', 'PAID']),
          ),
        );
      const committedGross = sum(committedRows.map((r) => D(r.gross)));
      if (committedGross.gt(D(po.gross))) {
        needsOverride = true;
      }
    }

    const trimmedOverride = overrideReason?.trim() ?? '';
    if (needsOverride && !trimmedOverride) {
      throw new DomainError('OVERPAY', 'ยอดจ่ายเกินยอด PO กรุณาระบุเหตุผลอนุมัติเกินวงเงิน', 409);
    }

    await tx
      .update(pvs)
      .set({
        status: 'APPROVED',
        approvedBy: actor.id,
        approvedAt: new Date(),
        overrideReason: trimmedOverride || null,
        updatedAt: new Date(),
      })
      .where(eq(pvs.id, pv.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: pv.id,
      action: 'APPROVED',
      note: trimmedOverride || undefined,
      data: trimmedOverride ? { overrideReason: trimmedOverride } : undefined,
    });

    const financeUsers = await usersWithRole(tx, ['FINANCE']);
    await notify(tx, financeUsers, {
      title: `ใบสำคัญจ่าย ${pv.number} อนุมัติแล้ว พร้อมโอนจ่าย`,
      href: `/pv/${pv.id}`,
      category: 'FINANCE',
    });
  });
}

export async function rejectPv(
  db: Db,
  actor: SessionUser,
  id: string,
  reason: string,
) {
  assertCan(actor, 'pv.approve');
  if (!reason.trim()) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ตีกลับ', 400);
  }

  return db.transaction(async (tx) => {
    const pv = await lockPv(tx, id);
    if (pv.status !== 'PENDING_APPROVAL') {
      throw new DomainError('INVALID_STATUS', 'ใบสำคัญจ่ายไม่ได้อยู่ในสถานะรออนุมัติ', 409);
    }

    await tx
      .update(pvs)
      .set({
        status: 'REJECTED',
        rejectReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(pvs.id, pv.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: pv.id,
      action: 'REJECTED',
      note: reason.trim(),
    });

    await notify(tx, [pv.createdBy], {
      title: `ใบสำคัญจ่าย ${pv.number} ถูกตีกลับ: ${reason.trim()}`,
      href: `/pv/${pv.id}`,
      category: 'FINANCE',
    });
  });
}

export async function cancelPv(
  db: Db,
  actor: SessionUser,
  id: string,
  reason: string,
) {
  assertCan(actor, 'pv.manage');
  if (!reason.trim()) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลในการยกเลิก', 400);
  }

  return db.transaction(async (tx) => {
    const pv = await lockPv(tx, id);
    if (pv.status === 'PAID') {
      throw new DomainError('INVALID_STATUS', 'ไม่สามารถยกเลิกใบสำคัญจ่ายที่จ่ายเงินแล้วได้', 409);
    }
    if (pv.status === 'CANCELLED') return;

    const lines = await tx
      .select()
      .from(pvLines)
      .where(eq(pvLines.pvId, pv.id));
    const payableIds = lines.map((l) => l.payableId);

    if (payableIds.length > 0) {
      await tx
        .update(payables)
        .set({ status: 'OPEN', updatedAt: new Date() })
        .where(inArray(payables.id, payableIds));
    }

    await tx
      .update(pvs)
      .set({
        status: 'CANCELLED',
        rejectReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(pvs.id, pv.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: pv.id,
      action: 'CANCELLED',
      note: reason.trim(),
    });
  });
}

export async function markPvPaid(
  db: Db,
  actor: SessionUser,
  id: string,
  input: {
    paidAt: string;
    payMethod: PayMethod;
    payFromAccount?: string;
    payRef?: string;
  },
) {
  assertCan(actor, 'pv.pay');
  if (!input.paidAt) {
    throw new DomainError('INVALID_INPUT', 'กรุณาระบุวันที่จ่ายเงิน', 400);
  }

  return db.transaction(async (tx) => {
    const pv = await lockPv(tx, id);
    if (pv.status !== 'APPROVED') {
      throw new DomainError(
        'INVALID_STATUS',
        'บันทึกจ่ายเงินได้เฉพาะใบสำคัญจ่ายที่อนุมัติแล้วเท่านั้น',
        409,
      );
    }

    const lines = await tx
      .select({
        line: pvLines,
        payable: payables,
      })
      .from(pvLines)
      .innerJoin(payables, eq(payables.id, pvLines.payableId))
      .where(eq(pvLines.pvId, pv.id));

    const payableIds = lines.map((l) => l.payable.id);
    if (payableIds.length > 0) {
      await tx
        .update(payables)
        .set({ status: 'PAID', updatedAt: new Date() })
        .where(inArray(payables.id, payableIds));
    }

    const installmentIds = lines
      .map((l) => l.payable.installmentId)
      .filter((iid): iid is string => Boolean(iid));
    if (installmentIds.length > 0) {
      await tx
        .update(poInstallments)
        .set({ status: 'PAID', updatedAt: new Date() })
        .where(inArray(poInstallments.id, installmentIds));
    }

    await tx
      .update(pvs)
      .set({
        status: 'PAID',
        paidAt: input.paidAt,
        payMethod: input.payMethod,
        payFromAccount: input.payFromAccount?.trim() || null,
        payRef: input.payRef?.trim() || null,
        paidBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(pvs.id, pv.id));

    let whtCertId: string | null = null;
    if (D(pv.wht).gt(0)) {
      whtCertId = await whtCertIssuer(tx, pv.id);
      if (whtCertId) {
        await tx
          .update(pvs)
          .set({ whtCertId })
          .where(eq(pvs.id, pv.id));
      }
    }

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: pv.id,
      action: 'PAID',
      data: {
        paidAt: input.paidAt,
        payMethod: input.payMethod,
        payRef: input.payRef,
        whtCertId,
      },
    });

    const touchedPoIds = Array.from(
      new Set(lines.map((l) => l.payable.poId).filter((pid): pid is string => Boolean(pid))),
    );
    for (const poId of touchedPoIds) {
      await triggerPoAutoComplete(tx, poId);
    }
  });
}

export async function listPvs(
  db: Db,
  actor: SessionUser,
  filters?: { status?: PvStatus; vendorId?: string },
) {
  assertCan(actor, 'pv.manage');

  const rows = await db
    .select({
      pv: pvs,
      vendorName: vendors.name,
      creatorName: users.name,
    })
    .from(pvs)
    .innerJoin(vendors, eq(vendors.id, pvs.vendorId))
    .innerJoin(users, eq(users.id, pvs.createdBy))
    .orderBy(desc(pvs.createdAt));

  return rows
    .filter((r) => {
      if (filters?.status && r.pv.status !== filters.status) return false;
      if (filters?.vendorId && r.pv.vendorId !== filters.vendorId) return false;
      return true;
    })
    .map((r) => ({
      ...r.pv,
      vendorName: r.vendorName,
      creatorName: r.creatorName,
    }));
}

export async function getPv(db: Db, actor: SessionUser, id: string) {
  assertCan(actor, 'pv.manage');

  const [row] = await db
    .select({
      pv: pvs,
      vendorName: vendors.name,
      vendorBankName: vendors.bankName,
      vendorBankAccountNo: vendors.bankAccountNo,
      vendorBankAccountName: vendors.bankAccountName,
      creatorName: users.name,
    })
    .from(pvs)
    .innerJoin(vendors, eq(vendors.id, pvs.vendorId))
    .innerJoin(users, eq(users.id, pvs.createdBy))
    .where(eq(pvs.id, id))
    .limit(1);

  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบใบสำคัญจ่าย', 404);

  const lines = await db
    .select({
      line: pvLines,
      payableStatus: payables.status,
      payableNote: payables.note,
      poId: payables.poId,
      poNumber: pos.number,
      invoiceNo: invoices.invoiceNo,
      installmentName: poInstallments.name,
    })
    .from(pvLines)
    .innerJoin(payables, eq(payables.id, pvLines.payableId))
    .leftJoin(pos, eq(pos.id, payables.poId))
    .leftJoin(invoices, eq(invoices.id, payables.invoiceId))
    .leftJoin(poInstallments, eq(poInstallments.id, payables.installmentId))
    .where(eq(pvLines.pvId, id));

  return {
    ...row.pv,
    vendorName: row.vendorName,
    vendorBankName: row.vendorBankName,
    vendorBankAccountNo: row.vendorBankAccountNo,
    vendorBankAccountName: row.vendorBankAccountName,
    creatorName: row.creatorName,
    lines: lines.map((l) => ({
      ...l.line,
      payableStatus: l.payableStatus,
      payableNote: l.payableNote,
      poId: l.poId,
      poNumber: l.poNumber ?? null,
      invoiceNo: l.invoiceNo ?? null,
      installmentName: l.installmentName ?? null,
    })),
  };
}
