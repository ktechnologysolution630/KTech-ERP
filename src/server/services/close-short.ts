import { and, asc, desc, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  closeShortRequests,
  poInstallments,
  poLines,
  pos,
  users,
  type SessionUser,
} from '@/db/schema';
import { rescaleInstallments } from '@/domain/close-short';
import { DomainError } from '@/domain/errors';
import { computeDocTotals, D } from '@/domain/money';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { lockPo, receivedQtyByPoLine } from './po';
import { triggerPoAutoComplete } from './receipt';

export async function requestCloseShort(
  db: Db,
  actor: SessionUser,
  poId: string,
  reason: string,
): Promise<{ id: string }> {
  assertCan(actor, 'po.manage');
  if (!reason.trim()) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลในการขอปิดยอดค้างรับ', 400);
  }

  return db.transaction(async (tx) => {
    const po = await lockPo(tx, poId);
    if (po.status !== 'ORDERED') {
      throw new DomainError(
        'INVALID_STATUS',
        'ขอปิดยอดค้างรับได้เฉพาะใบสั่งซื้อที่รับของบางส่วนแล้วเท่านั้น',
        409,
      );
    }
    if (po.closedShort) {
      throw new DomainError('ALREADY_CLOSED_SHORT', 'ใบสั่งซื้อนี้ปิดยอดค้างรับไปแล้ว', 409);
    }

    const lines = await tx
      .select()
      .from(poLines)
      .where(eq(poLines.poId, po.id))
      .orderBy(asc(poLines.sort));
    const recMap = await receivedQtyByPoLine(tx, po.id);

    let totalOrdered = D(0);
    let totalReceived = D(0);
    for (const l of lines) {
      totalOrdered = totalOrdered.plus(D(l.qty));
      totalReceived = totalReceived.plus(recMap.get(l.id) ?? D(0));
    }

    if (totalReceived.lte(0)) {
      throw new DomainError(
        'NO_RECEIPTS',
        'ไม่สามารถขอปิดยอดค้างรับได้เนื่องจากยังไม่มีการรับของเลย',
        409,
      );
    }
    if (totalReceived.gte(totalOrdered)) {
      throw new DomainError(
        'ALREADY_FULL',
        'รับของครบตามจำนวนสั่งแล้ว ไม่จำเป็นต้องปิดยอดค้างรับ',
        409,
      );
    }

    const [existingPending] = await tx
      .select()
      .from(closeShortRequests)
      .where(
        and(
          eq(closeShortRequests.poId, po.id),
          eq(closeShortRequests.status, 'PENDING'),
        ),
      )
      .limit(1);

    if (existingPending) {
      throw new DomainError(
        'PENDING_EXISTS',
        'มีคำขอปิดยอดค้างรับที่รออนุมัติอยู่แล้ว',
        409,
      );
    }

    const [created] = await tx
      .insert(closeShortRequests)
      .values({
        poId: po.id,
        reason: reason.trim(),
        requestedBy: actor.id,
        status: 'PENDING',
      })
      .returning();

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: po.id,
      action: 'CLOSE_SHORT_REQUESTED',
      note: reason.trim(),
    });

    const owners = await usersWithRole(tx, ['OWNER']);
    await notify(tx, owners, {
      title: `มีคำขอปิดยอดค้างรับ ${po.number}`,
      href: `/po/${po.id}`,
    });

    return { id: created!.id };
  });
}

export async function approveCloseShort(
  db: Db,
  actor: SessionUser,
  requestId: string,
) {
  assertCan(actor, 'closeShort.approve');

  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(closeShortRequests)
      .where(eq(closeShortRequests.id, requestId))
      .limit(1);
    if (!req) throw new DomainError('NOT_FOUND', 'ไม่พบคำขอปิดยอดค้างรับ', 404);
    if (req.status !== 'PENDING') {
      throw new DomainError('INVALID_STATUS', 'คำขอนี้ถูกดำเนินการไปแล้ว', 409);
    }

    const po = await lockPo(tx, req.poId);
    const lines = await tx
      .select()
      .from(poLines)
      .where(eq(poLines.poId, po.id))
      .orderBy(asc(poLines.sort));
    const recMap = await receivedQtyByPoLine(tx, po.id);

    const newLineInputs = lines.map((l) => {
      const recQty = recMap.get(l.id) ?? D(0);
      return {
        line: l,
        qty: recQty,
        unitPrice: D(l.unitPrice),
        discount: recQty.gt(0) ? D(l.discount) : D(0),
      };
    });

    const totals = computeDocTotals({
      vatMode: po.vatMode,
      billDiscount: D(po.billDiscount),
      shipping: D(po.shipping),
      lines: newLineInputs.map((nl) => ({
        qty: nl.qty,
        unitPrice: nl.unitPrice,
        discount: nl.discount,
      })),
    });

    for (let i = 0; i < newLineInputs.length; i++) {
      const nl = newLineInputs[i]!;
      const lt = totals.lines[i]!;
      await tx
        .update(poLines)
        .set({
          qty: nl.qty.toFixed(3),
          discount: nl.discount.toFixed(2),
          allocatedBeforeVat: lt.allocatedBeforeVat.toFixed(2),
          vat: lt.vat.toFixed(2),
          gross: lt.gross.toFixed(2),
          unitGross: lt.unitGross.toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(poLines.id, nl.line.id));
    }

    if (po.paymentType === 'INSTALLMENT') {
      const instRows = await tx
        .select()
        .from(poInstallments)
        .where(eq(poInstallments.poId, po.id))
        .orderBy(asc(poInstallments.seq));

      const rescaled = rescaleInstallments(
        totals.gross,
        instRows.map((inst) => ({
          id: inst.id,
          amount: D(inst.amount),
          status: inst.status,
        })),
      );

      for (const u of rescaled.updates) {
        await tx
          .update(poInstallments)
          .set({
            amount: u.amount.toFixed(2),
            status: u.status,
            updatedAt: new Date(),
          })
          .where(eq(poInstallments.id, u.id));
      }
    }

    const oldGross = po.gross;
    const newGross = totals.gross.toFixed(2);

    await tx
      .update(pos)
      .set({
        beforeVat: totals.beforeVat.toFixed(2),
        vat: totals.vat.toFixed(2),
        gross: newGross,
        closedShort: true,
        updatedAt: new Date(),
      })
      .where(eq(pos.id, po.id));

    await tx
      .update(closeShortRequests)
      .set({
        status: 'APPROVED',
        decidedBy: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(closeShortRequests.id, req.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: po.id,
      action: 'CLOSE_SHORT_APPROVED',
      note: req.reason,
      data: { beforeGross: oldGross, afterGross: newGross },
    });

    await notify(tx, [req.requestedBy], {
      title: `คำขอปิดยอดค้างรับ ${po.number} ได้รับอนุมัติแล้ว`,
      href: `/po/${po.id}`,
    });

    await triggerPoAutoComplete(tx, po.id);
  });
}

export async function rejectCloseShort(
  db: Db,
  actor: SessionUser,
  requestId: string,
  reason: string,
) {
  assertCan(actor, 'closeShort.approve');
  if (!reason.trim()) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติปิดยอดค้างรับ', 400);
  }

  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(closeShortRequests)
      .where(eq(closeShortRequests.id, requestId))
      .limit(1);
    if (!req) throw new DomainError('NOT_FOUND', 'ไม่พบคำขอปิดยอดค้างรับ', 404);
    if (req.status !== 'PENDING') {
      throw new DomainError('INVALID_STATUS', 'คำขอนี้ถูกดำเนินการไปแล้ว', 409);
    }

    const po = await lockPo(tx, req.poId);

    await tx
      .update(closeShortRequests)
      .set({
        status: 'REJECTED',
        decidedBy: actor.id,
        decidedAt: new Date(),
        rejectReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(closeShortRequests.id, req.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: po.id,
      action: 'CLOSE_SHORT_REJECTED',
      note: reason.trim(),
    });

    await notify(tx, [req.requestedBy], {
      title: `คำขอปิดยอดค้างรับ ${po.number} ถูกตีกลับ: ${reason.trim()}`,
      href: `/po/${po.id}`,
    });
  });
}

export async function getCloseShortRequestsForPo(db: Db, poId: string) {
  return db
    .select({
      request: closeShortRequests,
      requesterName: users.name,
    })
    .from(closeShortRequests)
    .innerJoin(users, eq(users.id, closeShortRequests.requestedBy))
    .where(eq(closeShortRequests.poId, poId))
    .orderBy(desc(closeShortRequests.createdAt));
}
