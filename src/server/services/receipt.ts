import { asc, desc, eq, inArray } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  poLines,
  pos,
  projects,
  receiptLines,
  receipts,
  users,
  vendors,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, type Decimal } from '@/domain/money';
import { assertCan, can } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { lockPo, receivedQtyByPoLine } from './po';
import { syncReceiptToStock } from './stock';

export { receivedQtyByPoLine };

// Hook for auto-completing PO when fully received and paid (populated in Task 13)
let poAutoCompleteHook: (tx: Db, poId: string) => Promise<void> = async () => {};
export function registerPoAutoCompleteHook(fn: (tx: Db, poId: string) => Promise<void>) {
  poAutoCompleteHook = fn;
}

export async function triggerPoAutoComplete(tx: Db, poId: string): Promise<void> {
  await poAutoCompleteHook(tx, poId);
}

export async function createReceipt(
  db: Db,
  actor: SessionUser,
  input: {
    poId: string;
    receivedAt: string;
    deliveryNoteNo?: string;
    note?: string;
    lines: { poLineId: string; qty: Decimal | string | number }[];
  },
): Promise<{ id: string }> {
  if (!input.lines || input.lines.length === 0) {
    throw new DomainError('EMPTY_RECEIPT', 'ต้องมีรายการรับของอย่างน้อย 1 รายการ');
  }

  return db.transaction(async (tx) => {
    const po = await lockPo(tx, input.poId);
    assertCan(actor, 'receipt.create', { projectId: po.projectId });

    if (po.status !== 'APPROVED' && po.status !== 'ORDERED') {
      throw new DomainError(
        'INVALID_STATE',
        'รับของได้เฉพาะใบสั่งซื้อที่อนุมัติแล้วหรือสั่งของแล้วเท่านั้น',
        409,
      );
    }

    const liveLines = await tx
      .select()
      .from(poLines)
      .where(eq(poLines.poId, input.poId))
      .orderBy(asc(poLines.sort));
    const lineMap = new Map(liveLines.map((l) => [l.id, l]));
    const receivedMap = await receivedQtyByPoLine(tx, input.poId);

    const validEntries: { poLineId: string; qty: Decimal }[] = [];
    for (const entry of input.lines) {
      const qtyDec = D(entry.qty);
      if (qtyDec.lte(0)) {
        throw new DomainError('INVALID_QTY', 'จำนวนที่รับต้องมากกว่า 0');
      }
      const poLine = lineMap.get(entry.poLineId);
      if (!poLine) {
        throw new DomainError('INVALID_LINE', 'ไม่พบรายการใน PO');
      }
      const alreadyReceived = receivedMap.get(entry.poLineId) ?? D(0);
      const afterReceive = alreadyReceived.plus(qtyDec);
      if (afterReceive.gt(D(poLine.qty))) {
        throw new DomainError(
          'OVER_RECEIPT',
          'รับเกินจำนวนที่สั่ง',
          409,
        );
      }
      receivedMap.set(entry.poLineId, afterReceive);
      validEntries.push({ poLineId: entry.poLineId, qty: qtyDec });
    }

    if (po.status === 'APPROVED') {
      await tx
        .update(pos)
        .set({
          status: 'ORDERED',
          orderedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pos.id, input.poId));
    }

    const [created] = await tx
      .insert(receipts)
      .values({
        poId: input.poId,
        poRevision: po.approvedRevision ?? 0,
        receivedAt: input.receivedAt,
        deliveryNoteNo: input.deliveryNoteNo?.trim() ?? '',
        note: input.note?.trim() ?? '',
        receivedBy: actor.id,
        status: 'CONFIRMED',
      })
      .returning();

    await tx.insert(receiptLines).values(
      validEntries.map((e) => ({
        receiptId: created.id,
        poLineId: e.poLineId,
        qty: e.qty.toDecimalPlaces(3).toFixed(3),
      })),
    );

    // Sync received goods into Stock balances and movements
    await syncReceiptToStock(
      tx,
      created.id,
      actor.id,
      po.projectId || '',
      po.number,
      validEntries.map((e) => {
        const line = lineMap.get(e.poLineId)!;
        return {
          description: line.description,
          unit: line.unitName,
          unitPrice: Number(line.unitPrice),
          qty: e.qty.toNumber(),
        };
      }),
    );

    await logActivity(tx, {
      entityType: 'RECEIPT',
      entityId: created.id,
      action: 'create',
      userId: actor.id,
      note: input.deliveryNoteNo ? `ใบส่งของ ${input.deliveryNoteNo}` : undefined,
    });

    await logActivity(tx, {
      entityType: 'PO',
      entityId: input.poId,
      action: 'receipt.create',
      userId: actor.id,
      note: input.deliveryNoteNo ? `รับของตามใบส่งของ ${input.deliveryNoteNo}` : 'รับของ',
    });

    await triggerPoAutoComplete(tx, input.poId);

    const financeUsers = await usersWithRole(tx, ['FINANCE']);
    await notify(tx, [po.createdBy, ...financeUsers], {
      title: `มีการรับของตาม PO ${po.number}`,
      href: `/po/${po.id}`,
    });

    return { id: created.id };
  });
}

export async function cancelReceipt(
  db: Db,
  actor: SessionUser,
  receiptId: string,
  reason: string,
): Promise<void> {
  if (!actor.roles.includes('PURCHASING_HEAD') && !actor.roles.includes('OWNER')) {
    throw new DomainError('FORBIDDEN', 'เฉพาะหัวหน้าจัดซื้อหรือเจ้าของเท่านั้นที่ยกเลิกใบรับของได้', 403);
  }
  const cleanReason = reason.trim();
  if (!cleanReason) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ยกเลิก');
  }

  await db.transaction(async (tx) => {
    const [rec] = await tx
      .select()
      .from(receipts)
      .where(eq(receipts.id, receiptId))
      .limit(1);
    if (!rec) throw new DomainError('NOT_FOUND', 'ไม่พบใบรับของ', 404);

    const po = await lockPo(tx, rec.poId);
    if (po.status === 'COMPLETED') {
      throw new DomainError(
        'PO_COMPLETED',
        'ไม่สามารถยกเลิกใบรับของของ PO ที่เสร็จสมบูรณ์แล้วได้',
        409,
      );
    }

    await tx
      .update(receipts)
      .set({
        status: 'CANCELLED',
        cancelReason: cleanReason,
        updatedAt: new Date(),
      })
      .where(eq(receipts.id, receiptId));

    await logActivity(tx, {
      entityType: 'RECEIPT',
      entityId: receiptId,
      action: 'cancel',
      userId: actor.id,
      note: cleanReason,
    });
  });
}

export async function listPoReceipts(db: Db, poId: string) {
  const recs = await db
    .select({
      id: receipts.id,
      poId: receipts.poId,
      poRevision: receipts.poRevision,
      receivedAt: receipts.receivedAt,
      deliveryNoteNo: receipts.deliveryNoteNo,
      note: receipts.note,
      receivedBy: receipts.receivedBy,
      receiverName: users.name,
      status: receipts.status,
      cancelReason: receipts.cancelReason,
      createdAt: receipts.createdAt,
    })
    .from(receipts)
    .innerJoin(users, eq(users.id, receipts.receivedBy))
    .where(eq(receipts.poId, poId))
    .orderBy(desc(receipts.createdAt));

  if (recs.length === 0) return [];
  const lines = await db
    .select({
      id: receiptLines.id,
      receiptId: receiptLines.receiptId,
      poLineId: receiptLines.poLineId,
      description: poLines.description,
      unitName: poLines.unitName,
      qty: receiptLines.qty,
    })
    .from(receiptLines)
    .innerJoin(poLines, eq(poLines.id, receiptLines.poLineId))
    .where(
      inArray(
        receiptLines.receiptId,
        recs.map((r) => r.id),
      ),
    );

  return recs.map((r) => ({
    ...r,
    lines: lines.filter((l) => l.receiptId === r.id),
  }));
}

export async function listReceivablePos(db: Db, actor: SessionUser) {
  const candidates = await db
    .select({
      id: pos.id,
      number: pos.number,
      projectId: pos.projectId,
      vendorName: vendors.name,
      status: pos.status,
      deliveryDate: pos.deliveryDate,
      createdAt: pos.createdAt,
    })
    .from(pos)
    .innerJoin(vendors, eq(vendors.id, pos.vendorId))
    .where(inArray(pos.status, ['APPROVED', 'ORDERED']))
    .orderBy(desc(pos.createdAt));

  const allProjects = await db.select().from(projects);
  const projMap = new Map(allProjects.map((p) => [p.id, p]));

  const allowed = candidates.filter((po) =>
    can(actor, 'receipt.create', { projectId: po.projectId }),
  );

  const result = [];
  for (const po of allowed) {
    const lines = await db.select().from(poLines).where(eq(poLines.poId, po.id));
    const receivedMap = await receivedQtyByPoLine(db, po.id);
    const remainingLines = lines.filter((l) => {
      const rec = receivedMap.get(l.id) ?? D(0);
      return D(l.qty).gt(rec);
    });
    if (remainingLines.length > 0) {
      const p = po.projectId ? projMap.get(po.projectId) : null;
      result.push({
        ...po,
        projectCode: p?.code ?? 'OFFICE',
        projectName: p?.name ?? 'สำนักงาน / ส่วนกลาง',
        remainingLineCount: remainingLines.length,
      });
    }
  }
  return result;
}
