import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  poInstallments,
  poLines,
  poRevisions,
  pos,
  prLines,
  projects,
  prs,
  receiptLines,
  receipts,
  users,
  vendors,
  type InstallmentCondition,
  type PoPaymentType,
  type PoStatus,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import {
  allocate,
  computeDocTotals,
  D,
  round2,
  splitInstallments,
  sum,
  type Decimal,
  type VatMode,
} from '@/domain/money';
import { requiredPoApprover } from '@/domain/po-approval';
import { assertCan, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';
import { orderedQtyByPrLine, registerOrderedQtyResolver } from './pr';
import { getSettings } from './settings';

export interface PoLineInput {
  id?: string;
  prLineId?: string | null;
  itemId?: string | null;
  description: string;
  unitName: string;
  qty: Decimal | string | number;
  unitPrice: Decimal | string | number;
  discount?: Decimal | string | number;
}

export interface PoInstallmentInput {
  name: string;
  percent?: Decimal | string | number | null;
  amount?: Decimal | string | number | null;
  condition: InstallmentCondition;
  conditionNote?: string;
}

export interface PoInput {
  projectId: string | null;
  vendorId: string;
  paymentType: PoPaymentType;
  creditDays?: number | null;
  vatMode: VatMode;
  billDiscount: Decimal | string | number;
  shipping: Decimal | string | number;
  deliveryDate?: string | null;
  deliveryAddress?: string;
  note?: string;
  reason?: string;
  lines: PoLineInput[];
  installments?: PoInstallmentInput[];
}

export interface SerializedPoRevisionPayload {
  projectId: string | null;
  vendorId: string;
  paymentType: PoPaymentType;
  creditDays: number | null;
  vatMode: VatMode;
  billDiscount: string;
  shipping: string;
  deliveryDate: string | null;
  deliveryAddress: string;
  note: string;
  reason: string;
  submittedForApproval?: boolean;
  lines: {
    id?: string;
    prLineId: string | null;
    itemId: string | null;
    description: string;
    unitName: string;
    qty: string;
    unitPrice: string;
    discount: string;
  }[];
  installments?: {
    name: string;
    percent: string | null;
    amount: string | null;
    condition: InstallmentCondition;
    conditionNote: string;
  }[];
}

// Register orderedQtyByPrLine resolver on module load
registerOrderedQtyResolver(async (db, prLineIds) => {
  if (prLineIds.length === 0) return new Map();
  const rows = await db
    .select({
      prLineId: poLines.prLineId,
      qty: poLines.qty,
    })
    .from(poLines)
    .innerJoin(pos, and(eq(pos.id, poLines.poId), ne(pos.status, 'CANCELLED')))
    .where(inArray(poLines.prLineId, prLineIds));

  const map = new Map<string, Decimal>();
  for (const r of rows) {
    if (!r.prLineId) continue;
    const prev = map.get(r.prLineId) ?? D(0);
    map.set(r.prLineId, prev.plus(D(r.qty)));
  }
  return map;
});

// Hook for committed PV gross check (populated in Task 11)
let pvCommittedGrossResolver: (tx: Db, poId: string) => Promise<Decimal> = async () => D(0);
export function registerPvCommittedGrossResolver(
  fn: (tx: Db, poId: string) => Promise<Decimal>,
) {
  pvCommittedGrossResolver = fn;
}

// Hook for non-cancelled payable count check on cancelPo (populated in Task 10)
let poHasPayablesResolver: (tx: Db, poId: string) => Promise<boolean> = async () => false;
export function registerPoHasPayablesResolver(fn: (tx: Db, poId: string) => Promise<boolean>) {
  poHasPayablesResolver = fn;
}

export async function lockPo(tx: Db, poId: string) {
  await tx.execute(sql`SELECT id FROM pos WHERE id = ${poId} FOR UPDATE`);
  const [po] = await tx.select().from(pos).where(eq(pos.id, poId)).limit(1);
  if (!po) throw new DomainError('NOT_FOUND', 'ไม่พบใบสั่งซื้อ', 404);
  return po;
}

export async function receivedQtyByPoLine(
  db: Db,
  poId: string,
): Promise<Map<string, Decimal>> {
  const rows = await db
    .select({
      poLineId: receiptLines.poLineId,
      qty: receiptLines.qty,
    })
    .from(receiptLines)
    .innerJoin(
      receipts,
      and(
        eq(receipts.id, receiptLines.receiptId),
        eq(receipts.poId, poId),
        eq(receipts.status, 'CONFIRMED'),
      ),
    );

  const map = new Map<string, Decimal>();
  for (const r of rows) {
    map.set(r.poLineId, (map.get(r.poLineId) ?? D(0)).plus(D(r.qty)));
  }
  return map;
}

async function validateAndComputePo(
  tx: Db,
  input: PoInput,
  excludePoId?: string,
) {
  if (!input.lines || input.lines.length === 0) {
    throw new DomainError('EMPTY_PO', 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ');
  }

  const [vendor] = await tx
    .select()
    .from(vendors)
    .where(eq(vendors.id, input.vendorId))
    .limit(1);
  if (!vendor) {
    throw new DomainError('INVALID_VENDOR', 'ไม่พบผู้ขาย');
  }

  for (const l of input.lines) {
    if (!l.description?.trim() || !l.unitName?.trim()) {
      throw new DomainError('INVALID_LINE', 'กรุณาระบุชื่อรายการและหน่วยนับให้ครบถ้วน');
    }
    if (D(l.qty).lte(0)) {
      throw new DomainError('INVALID_QTY', 'จำนวนสั่งซื้อต้องมากกว่า 0');
    }
    if (D(l.unitPrice).lt(0)) {
      throw new DomainError('INVALID_PRICE', 'ราคาต่อหน่วยต้องไม่ติดลบ');
    }
  }

  // Validate PR lines if linked
  const prLineIds = input.lines.map((l) => l.prLineId).filter((x): x is string => Boolean(x));
  if (prLineIds.length > 0) {
    const prLineRows = await tx
      .select({
        id: prLines.id,
        qty: prLines.qty,
        prId: prs.id,
        prStatus: prs.status,
        projectId: prs.projectId,
      })
      .from(prLines)
      .innerJoin(prs, eq(prs.id, prLines.prId))
      .where(inArray(prLines.id, prLineIds));

    if (prLineRows.length !== new Set(prLineIds).size) {
      throw new DomainError('INVALID_PR_LINE', 'ไม่พบรายการใบขอซื้อที่อ้างอิง');
    }

    const orderedMap = await orderedQtyByPrLine(tx, prLineIds);

    // If updating an existing PO, subtract its own current quantities from orderedMap
    if (excludePoId) {
      const ownLines = await tx.select().from(poLines).where(eq(poLines.poId, excludePoId));
      for (const ol of ownLines) {
        if (ol.prLineId && orderedMap.has(ol.prLineId)) {
          orderedMap.set(ol.prLineId, orderedMap.get(ol.prLineId)!.minus(D(ol.qty)));
        }
      }
    }

    for (const l of input.lines) {
      if (!l.prLineId) continue;
      const meta = prLineRows.find((r) => r.id === l.prLineId)!;
      if (meta.prStatus !== 'APPROVED') {
        throw new DomainError('PR_NOT_APPROVED', 'รายการใบขอซื้อยังไม่ได้รับอนุมัติ');
      }
      if (meta.projectId !== input.projectId) {
        throw new DomainError('PROJECT_MISMATCH', 'โครงการของ PO ต้องตรงกับโครงการของ PR');
      }
      const alreadyOrdered = orderedMap.get(l.prLineId) ?? D(0);
      const remaining = D(meta.qty).minus(alreadyOrdered);
      if (D(l.qty).gt(remaining)) {
        throw new DomainError(
          'OVER_PR_QTY',
          'จำนวนสั่งซื้อเกินจำนวนคงเหลือในใบขอซื้อ (PR)',
          409,
        );
      }
    }
  }

  const totals = computeDocTotals({
    vatMode: input.vatMode,
    billDiscount: D(input.billDiscount ?? 0),
    shipping: D(input.shipping ?? 0),
    lines: input.lines.map((l) => ({
      qty: D(l.qty),
      unitPrice: D(l.unitPrice),
      discount: D(l.discount ?? 0),
    })),
  });

  const creditDays =
    input.paymentType === 'CREDIT'
      ? (input.creditDays ?? vendor.defaultCreditDays ?? 30)
      : null;

  let installmentAmounts: Decimal[] = [];
  if (input.paymentType === 'INSTALLMENT') {
    if (!input.installments || input.installments.length === 0) {
      throw new DomainError('INSTALLMENT_REQUIRED', 'กรุณาระบุตารางงวดการจ่าย');
    }
    const parts = input.installments.map((inst) => {
      if (inst.percent !== undefined && inst.percent !== null && inst.percent !== '') {
        return { percent: D(inst.percent) };
      }
      return { amount: D(inst.amount ?? 0) };
    });
    installmentAmounts = splitInstallments(totals.gross, parts);
  }

  return { totals, creditDays, installmentAmounts };
}

export async function createPo(
  db: Db,
  actor: SessionUser,
  input: PoInput,
): Promise<{ id: string; number: string }> {
  assertCan(actor, 'po.manage');
  return db.transaction(async (tx) => {
    const { totals, creditDays, installmentAmounts } = await validateAndComputePo(tx, input);
    const number = await nextDocNumber(tx, 'PO');

    const [created] = await tx
      .insert(pos)
      .values({
        number,
        projectId: input.projectId,
        vendorId: input.vendorId,
        createdBy: actor.id,
        status: 'DRAFT',
        paymentType: input.paymentType,
        creditDays,
        vatMode: input.vatMode,
        billDiscount: totals.billDiscount.toFixed(2),
        shipping: totals.shipping.toFixed(2),
        beforeVat: totals.beforeVat.toFixed(2),
        vat: totals.vat.toFixed(2),
        gross: totals.gross.toFixed(2),
        deliveryDate: input.deliveryDate || null,
        deliveryAddress: input.deliveryAddress ?? '',
        note: input.note ?? '',
        currentRevision: 0,
      })
      .returning();

    await tx.insert(poLines).values(
      input.lines.map((l, idx) => {
        const cl = totals.lines[idx];
        return {
          poId: created.id,
          prLineId: l.prLineId ?? null,
          itemId: l.itemId ?? null,
          description: l.description.trim(),
          unitName: l.unitName.trim(),
          qty: D(l.qty).toDecimalPlaces(3).toFixed(3),
          unitPrice: round2(D(l.unitPrice)).toFixed(2),
          discount: round2(D(l.discount ?? 0)).toFixed(2),
          sort: idx,
          allocatedBeforeVat: cl.allocatedBeforeVat.toFixed(2),
          vat: cl.vat.toFixed(2),
          gross: cl.gross.toFixed(2),
          unitGross: cl.unitGross.toDecimalPlaces(6).toFixed(6),
        };
      }),
    );

    if (input.paymentType === 'INSTALLMENT' && input.installments) {
      await tx.insert(poInstallments).values(
        input.installments.map((inst, idx) => ({
          poId: created.id,
          seq: idx + 1,
          name: inst.name.trim(),
          percent:
            inst.percent !== undefined && inst.percent !== null && inst.percent !== ''
              ? round2(D(inst.percent)).toFixed(2)
              : null,
          amount: installmentAmounts[idx].toFixed(2),
          condition: inst.condition,
          conditionNote: inst.conditionNote ?? '',
          status: 'PENDING' as const,
        })),
      );
    }

    await logActivity(tx, {
      entityType: 'PO',
      entityId: created.id,
      action: 'create',
      userId: actor.id,
    });

    return { id: created.id, number: created.number };
  });
}

export async function updatePo(
  db: Db,
  actor: SessionUser,
  id: string,
  input: PoInput,
): Promise<void> {
  assertCan(actor, 'po.manage');
  await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    const { totals, creditDays, installmentAmounts } = await validateAndComputePo(
      tx,
      input,
      id,
    );

    if (po.status === 'DRAFT' || po.status === 'REJECTED') {
      await tx
        .update(pos)
        .set({
          projectId: input.projectId,
          vendorId: input.vendorId,
          paymentType: input.paymentType,
          creditDays,
          vatMode: input.vatMode,
          billDiscount: totals.billDiscount.toFixed(2),
          shipping: totals.shipping.toFixed(2),
          beforeVat: totals.beforeVat.toFixed(2),
          vat: totals.vat.toFixed(2),
          gross: totals.gross.toFixed(2),
          deliveryDate: input.deliveryDate || null,
          deliveryAddress: input.deliveryAddress ?? '',
          note: input.note ?? '',
          updatedAt: new Date(),
        })
        .where(eq(pos.id, id));

      await tx.delete(poLines).where(eq(poLines.poId, id));
      await tx.insert(poLines).values(
        input.lines.map((l, idx) => {
          const cl = totals.lines[idx];
          return {
            poId: id,
            prLineId: l.prLineId ?? null,
            itemId: l.itemId ?? null,
            description: l.description.trim(),
            unitName: l.unitName.trim(),
            qty: D(l.qty).toDecimalPlaces(3).toFixed(3),
            unitPrice: round2(D(l.unitPrice)).toFixed(2),
            discount: round2(D(l.discount ?? 0)).toFixed(2),
            sort: idx,
            allocatedBeforeVat: cl.allocatedBeforeVat.toFixed(2),
            vat: cl.vat.toFixed(2),
            gross: cl.gross.toFixed(2),
            unitGross: cl.unitGross.toDecimalPlaces(6).toFixed(6),
          };
        }),
      );

      await tx.delete(poInstallments).where(eq(poInstallments.poId, id));
      if (input.paymentType === 'INSTALLMENT' && input.installments) {
        await tx.insert(poInstallments).values(
          input.installments.map((inst, idx) => ({
            poId: id,
            seq: idx + 1,
            name: inst.name.trim(),
            percent:
              inst.percent !== undefined && inst.percent !== null && inst.percent !== ''
                ? round2(D(inst.percent)).toFixed(2)
                : null,
            amount: installmentAmounts[idx].toFixed(2),
            condition: inst.condition,
            conditionNote: inst.conditionNote ?? '',
            status: 'PENDING' as const,
          })),
        );
      }

      await logActivity(tx, {
        entityType: 'PO',
        entityId: id,
        action: 'update',
        userId: actor.id,
      });
      return;
    }

    if (po.status === 'APPROVED' || po.status === 'ORDERED') {
      const existingLines = await tx
        .select()
        .from(poLines)
        .where(eq(poLines.poId, id))
        .orderBy(asc(poLines.sort));
      const receivedMap = await receivedQtyByPoLine(tx, id);

      for (const el of existingLines) {
        const recQty = receivedMap.get(el.id) ?? D(0);
        const matchNew = input.lines.find((nl) => nl.id === el.id);
        if (!matchNew) {
          if (recQty.gt(0)) {
            throw new DomainError(
              'LINE_HAS_RECEIPTS',
              'ไม่สามารถลบรายการที่มีการรับของแล้วได้',
              409,
            );
          }
        } else if (D(matchNew.qty).lt(recQty)) {
          throw new DomainError(
            'QTY_BELOW_RECEIVED',
            'ไม่สามารถลดจำนวนให้ต่ำกว่าจำนวนที่รับของแล้วได้',
            409,
          );
        }
      }

      const committedPvGross = await pvCommittedGrossResolver(tx, id);
      if (totals.gross.lt(committedPvGross)) {
        throw new DomainError(
          'GROSS_BELOW_PV',
          'ไม่สามารถลดยอดรวม PO ให้ต่ำกว่ายอดใบสำคัญจ่าย (PV) ที่ตั้งเบิกหรือจ่ายแล้วได้',
          409,
        );
      }

      const payload: SerializedPoRevisionPayload = {
        projectId: input.projectId,
        vendorId: input.vendorId,
        paymentType: input.paymentType,
        creditDays,
        vatMode: input.vatMode,
        billDiscount: totals.billDiscount.toFixed(2),
        shipping: totals.shipping.toFixed(2),
        deliveryDate: input.deliveryDate || null,
        deliveryAddress: input.deliveryAddress ?? '',
        note: input.note ?? '',
        reason: input.reason ?? 'แก้ไขใบสั่งซื้อ',
        submittedForApproval: false,
        lines: input.lines.map((l) => ({
          id: l.id,
          prLineId: l.prLineId ?? null,
          itemId: l.itemId ?? null,
          description: l.description.trim(),
          unitName: l.unitName.trim(),
          qty: D(l.qty).toDecimalPlaces(3).toFixed(3),
          unitPrice: round2(D(l.unitPrice)).toFixed(2),
          discount: round2(D(l.discount ?? 0)).toFixed(2),
        })),
        installments: input.installments?.map((inst) => ({
          name: inst.name.trim(),
          percent:
            inst.percent !== undefined && inst.percent !== null && inst.percent !== ''
              ? round2(D(inst.percent)).toFixed(2)
              : null,
          amount:
            inst.amount !== undefined && inst.amount !== null && inst.amount !== ''
              ? round2(D(inst.amount)).toFixed(2)
              : null,
          condition: inst.condition,
          conditionNote: inst.conditionNote ?? '',
        })),
      };

      const nextRev = (po.approvedRevision ?? 0) + 1;
      await tx
        .update(pos)
        .set({
          currentRevision: nextRev,
          pendingRevision: payload,
          updatedAt: new Date(),
        })
        .where(eq(pos.id, id));

      await logActivity(tx, {
        entityType: 'PO',
        entityId: id,
        action: 'update',
        userId: actor.id,
        note: `สร้างฉบับแก้ไขครั้งที่ ${nextRev}: ${payload.reason}`,
      });
      return;
    }

    throw new DomainError('INVALID_STATE', 'ไม่สามารถแก้ไข PO ในสถานะนี้ได้', 409);
  });
}

export async function submitPo(db: Db, actor: SessionUser, id: string): Promise<void> {
  assertCan(actor, 'po.manage');
  await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    const s = await getSettings(tx);
    const limit = D(s.poApprovalLimit);

    if (po.pendingRevision) {
      const payload = po.pendingRevision as SerializedPoRevisionPayload;
      const { totals } = await validateAndComputePo(
        tx,
        {
          ...payload,
          lines: payload.lines,
          installments: payload.installments,
        },
        id,
      );
      payload.submittedForApproval = true;
      await tx
        .update(pos)
        .set({ pendingRevision: payload, updatedAt: new Date() })
        .where(eq(pos.id, id));

      const roleNeeded = requiredPoApprover(totals.gross, limit);
      const approvers = await usersWithRole(
        tx,
        roleNeeded === 'PURCHASING_HEAD' ? ['PURCHASING_HEAD', 'OWNER'] : ['OWNER'],
      );
      await notify(tx, approvers, {
        title: `PO ${po.number} (แก้ไขครั้งที่ ${po.currentRevision}) รออนุมัติ`,
        href: `/po/${po.id}`,
      });
      await logActivity(tx, {
        entityType: 'PO',
        entityId: id,
        action: 'submit',
        userId: actor.id,
        note: `ส่งขออนุมัติฉบับแก้ไขครั้งที่ ${po.currentRevision}`,
      });
      return;
    }

    if (po.status !== 'DRAFT' && po.status !== 'REJECTED') {
      throw new DomainError('INVALID_STATE', 'ส่งขออนุมัติไม่ได้ในสถานะปัจจุบัน', 409);
    }

    await tx
      .update(pos)
      .set({
        status: 'PENDING_APPROVAL',
        rejectReason: null,
        updatedAt: new Date(),
      })
      .where(eq(pos.id, id));

    const roleNeeded = requiredPoApprover(D(po.gross), limit);
    const approvers = await usersWithRole(
      tx,
      roleNeeded === 'PURCHASING_HEAD' ? ['PURCHASING_HEAD', 'OWNER'] : ['OWNER'],
    );
    await notify(tx, approvers, {
      title: `ใบสั่งซื้อ ${po.number} รออนุมัติ`,
      href: `/po/${po.id}`,
    });

    await logActivity(tx, {
      entityType: 'PO',
      entityId: id,
      action: 'submit',
      userId: actor.id,
    });
  });
}

export async function approvePo(db: Db, actor: SessionUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    const s = await getSettings(tx);
    const limit = D(s.poApprovalLimit);

    if (po.pendingRevision) {
      const payload = po.pendingRevision as SerializedPoRevisionPayload;
      const { totals } = await validateAndComputePo(
        tx,
        {
          ...payload,
          lines: payload.lines,
          installments: payload.installments,
        },
        id,
      );

      assertCan(actor, 'po.approve', {
        gross: totals.gross,
        poApprovalLimit: limit,
        createdBy: po.createdBy,
      });

      const existingLines = await tx
        .select()
        .from(poLines)
        .where(eq(poLines.poId, id))
        .orderBy(asc(poLines.sort));
      const existingIds = new Set(existingLines.map((l) => l.id));
      const keptIds = new Set<string>();

      for (let idx = 0; idx < payload.lines.length; idx++) {
        const nl = payload.lines[idx];
        const cl = totals.lines[idx];
        if (nl.id && existingIds.has(nl.id)) {
          keptIds.add(nl.id);
          await tx
            .update(poLines)
            .set({
              prLineId: nl.prLineId,
              itemId: nl.itemId,
              description: nl.description,
              unitName: nl.unitName,
              qty: nl.qty,
              unitPrice: nl.unitPrice,
              discount: nl.discount,
              sort: idx,
              allocatedBeforeVat: cl.allocatedBeforeVat.toFixed(2),
              vat: cl.vat.toFixed(2),
              gross: cl.gross.toFixed(2),
              unitGross: cl.unitGross.toDecimalPlaces(6).toFixed(6),
              updatedAt: new Date(),
            })
            .where(eq(poLines.id, nl.id));
        } else {
          await tx.insert(poLines).values({
            poId: id,
            prLineId: nl.prLineId,
            itemId: nl.itemId,
            description: nl.description,
            unitName: nl.unitName,
            qty: nl.qty,
            unitPrice: nl.unitPrice,
            discount: nl.discount,
            sort: idx,
            allocatedBeforeVat: cl.allocatedBeforeVat.toFixed(2),
            vat: cl.vat.toFixed(2),
            gross: cl.gross.toFixed(2),
            unitGross: cl.unitGross.toDecimalPlaces(6).toFixed(6),
          });
        }
      }

      for (const el of existingLines) {
        if (!keptIds.has(el.id)) {
          await tx.delete(poLines).where(eq(poLines.id, el.id));
        }
      }

      // Re-split PENDING installments if INSTALLMENT PO
      if (payload.paymentType === 'INSTALLMENT') {
        const curInst = await tx
          .select()
          .from(poInstallments)
          .where(eq(poInstallments.poId, id))
          .orderBy(asc(poInstallments.seq));
        const nonPending = curInst.filter((i) => i.status !== 'PENDING');
        const pending = curInst.filter((i) => i.status === 'PENDING');
        const lockedAmt = sum(nonPending.map((i) => D(i.amount)));
        const remForPending = totals.gross.minus(lockedAmt);

        if (pending.length > 0 && remForPending.gt(0)) {
          const weights = pending.map((p) => D(p.percent ?? p.amount));
          const newAmounts = allocate(remForPending, weights);
          for (let i = 0; i < pending.length; i++) {
            await tx
              .update(poInstallments)
              .set({ amount: newAmounts[i].toFixed(2), updatedAt: new Date() })
              .where(eq(poInstallments.id, pending[i].id));
          }
        }
      }

      await tx.insert(poRevisions).values({
        poId: id,
        revision: po.currentRevision,
        payload,
        createdBy: po.createdBy,
        approvedBy: actor.id,
        approvedAt: new Date(),
        reason: payload.reason,
      });

      await tx
        .update(pos)
        .set({
          projectId: payload.projectId,
          vendorId: payload.vendorId,
          paymentType: payload.paymentType,
          creditDays: payload.creditDays,
          vatMode: payload.vatMode,
          billDiscount: totals.billDiscount.toFixed(2),
          shipping: totals.shipping.toFixed(2),
          beforeVat: totals.beforeVat.toFixed(2),
          vat: totals.vat.toFixed(2),
          gross: totals.gross.toFixed(2),
          deliveryDate: payload.deliveryDate,
          deliveryAddress: payload.deliveryAddress,
          note: payload.note,
          approvedRevision: po.currentRevision,
          pendingRevision: null,
          approvedBy: actor.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pos.id, id));

      await logActivity(tx, {
        entityType: 'PO',
        entityId: id,
        action: 'approve',
        userId: actor.id,
        note: `อนุมัติฉบับแก้ไขครั้งที่ ${po.currentRevision}`,
      });
      return;
    }

    if (po.status !== 'PENDING_APPROVAL') {
      throw new DomainError('INVALID_STATE', 'ใบสั่งซื้อไม่ได้อยู่ในสถานะรออนุมัติ', 409);
    }

    assertCan(actor, 'po.approve', {
      gross: D(po.gross),
      poApprovalLimit: limit,
      createdBy: po.createdBy,
    });

    await tx
      .update(pos)
      .set({
        status: 'APPROVED',
        approvedRevision: po.currentRevision,
        approvedBy: actor.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pos.id, id));

    await logActivity(tx, {
      entityType: 'PO',
      entityId: id,
      action: 'approve',
      userId: actor.id,
    });

    await notify(tx, [po.createdBy], {
      title: `ใบสั่งซื้อ ${po.number} อนุมัติแล้ว`,
      href: `/po/${po.id}`,
    });
  });
}

export async function rejectPo(
  db: Db,
  actor: SessionUser,
  id: string,
  reason: string,
): Promise<void> {
  const cleanReason = reason.trim();
  if (!cleanReason) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ตีกลับ');
  }

  await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    const s = await getSettings(tx);
    const limit = D(s.poApprovalLimit);

    if (po.pendingRevision) {
      const payload = po.pendingRevision as SerializedPoRevisionPayload;
      const { totals } = await validateAndComputePo(
        tx,
        {
          ...payload,
          lines: payload.lines,
          installments: payload.installments,
        },
        id,
      );
      assertCan(actor, 'po.approve', {
        gross: totals.gross,
        poApprovalLimit: limit,
        createdBy: po.createdBy,
      });

      await tx
        .update(pos)
        .set({
          pendingRevision: null,
          currentRevision: po.approvedRevision ?? 0,
          rejectReason: cleanReason,
          updatedAt: new Date(),
        })
        .where(eq(pos.id, id));

      await logActivity(tx, {
        entityType: 'PO',
        entityId: id,
        action: 'reject',
        userId: actor.id,
        note: `ตีกลับฉบับแก้ไข: ${cleanReason}`,
      });
      return;
    }

    if (po.status !== 'PENDING_APPROVAL') {
      throw new DomainError('INVALID_STATE', 'ตีกลับได้เฉพาะใบสั่งซื้อที่รออนุมัติ', 409);
    }

    assertCan(actor, 'po.approve', {
      gross: D(po.gross),
      poApprovalLimit: limit,
      createdBy: po.createdBy,
    });

    await tx
      .update(pos)
      .set({
        status: 'REJECTED',
        rejectReason: cleanReason,
        updatedAt: new Date(),
      })
      .where(eq(pos.id, id));

    await logActivity(tx, {
      entityType: 'PO',
      entityId: id,
      action: 'reject',
      userId: actor.id,
      note: cleanReason,
    });

    await notify(tx, [po.createdBy], {
      title: `ใบสั่งซื้อ ${po.number} ถูกตีกลับ: ${cleanReason}`,
      href: `/po/${po.id}`,
    });
  });
}

export async function markOrdered(db: Db, actor: SessionUser, id: string): Promise<void> {
  assertCan(actor, 'po.manage');
  await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    if (po.status !== 'APPROVED') {
      throw new DomainError('INVALID_STATE', 'ต้องอนุมัติก่อนจึงจะบันทึกว่าสั่งของแล้วได้', 409);
    }
    await tx
      .update(pos)
      .set({
        status: 'ORDERED',
        orderedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pos.id, id));

    await logActivity(tx, {
      entityType: 'PO',
      entityId: id,
      action: 'order',
      userId: actor.id,
    });
  });
}

export async function cancelPo(
  db: Db,
  actor: SessionUser,
  id: string,
  reason: string,
): Promise<void> {
  assertCan(actor, 'po.manage');
  const cleanReason = reason.trim();
  if (!cleanReason) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ยกเลิก');
  }

  await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    const receivedMap = await receivedQtyByPoLine(tx, id);
    const anyReceived = Array.from(receivedMap.values()).some((q) => q.gt(0));
    const hasPayables = await poHasPayablesResolver(tx, id);

    if (anyReceived || hasPayables) {
      throw new DomainError(
        'PO_HAS_ACTIVITY',
        'ไม่สามารถยกเลิก PO ที่มีการรับของหรือตั้งเบิก/จ่ายเงินแล้วได้',
        409,
      );
    }

    await tx
      .update(pos)
      .set({
        status: 'CANCELLED',
        pendingRevision: null,
        updatedAt: new Date(),
      })
      .where(eq(pos.id, id));

    await logActivity(tx, {
      entityType: 'PO',
      entityId: id,
      action: 'cancel',
      userId: actor.id,
      note: cleanReason,
    });
  });
}

export async function getPo(db: Db, actor: SessionUser, id: string) {
  const [po] = await db
    .select({
      id: pos.id,
      number: pos.number,
      projectId: pos.projectId,
      vendorId: pos.vendorId,
      vendorCode: vendors.code,
      vendorName: vendors.name,
      createdBy: pos.createdBy,
      creatorName: users.name,
      status: pos.status,
      paymentType: pos.paymentType,
      creditDays: pos.creditDays,
      vatMode: pos.vatMode,
      billDiscount: pos.billDiscount,
      shipping: pos.shipping,
      beforeVat: pos.beforeVat,
      vat: pos.vat,
      gross: pos.gross,
      deliveryDate: pos.deliveryDate,
      deliveryAddress: pos.deliveryAddress,
      note: pos.note,
      currentRevision: pos.currentRevision,
      approvedRevision: pos.approvedRevision,
      pendingRevision: pos.pendingRevision,
      approvedBy: pos.approvedBy,
      approvedAt: pos.approvedAt,
      orderedAt: pos.orderedAt,
      rejectReason: pos.rejectReason,
      closedShort: pos.closedShort,
      createdAt: pos.createdAt,
    })
    .from(pos)
    .innerJoin(vendors, eq(vendors.id, pos.vendorId))
    .innerJoin(users, eq(users.id, pos.createdBy))
    .where(eq(pos.id, id))
    .limit(1);

  if (!po) throw new DomainError('NOT_FOUND', 'ไม่พบใบสั่งซื้อ', 404);
  assertCan(actor, 'project.view', { projectId: po.projectId });

  let projectInfo: { code: string; name: string } | null = null;
  if (po.projectId) {
    const [p] = await db
      .select({ code: projects.code, name: projects.name })
      .from(projects)
      .where(eq(projects.id, po.projectId))
      .limit(1);
    if (p) projectInfo = p;
  }

  const rawLines = await db
    .select()
    .from(poLines)
    .where(eq(poLines.poId, id))
    .orderBy(asc(poLines.sort));

  const receivedMap = await receivedQtyByPoLine(db, id);
  const lines = rawLines.map((l) => {
    const receivedQty = receivedMap.get(l.id) ?? D(0);
    const remainingQty = D(l.qty).minus(receivedQty);
    return {
      ...l,
      receivedQty,
      remainingQty: remainingQty.gt(0) ? remainingQty : D(0),
    };
  });

  const installments = await db
    .select()
    .from(poInstallments)
    .where(eq(poInstallments.poId, id))
    .orderBy(asc(poInstallments.seq));

  return {
    ...po,
    projectCode: projectInfo?.code ?? 'OFFICE',
    projectName: projectInfo?.name ?? 'สำนักงาน / ส่วนกลาง',
    lines,
    installments,
    hasPendingRevision: Boolean(po.pendingRevision),
  };
}

export async function listPos(
  db: Db,
  actor: SessionUser,
  filters: {
    projectId?: string;
    vendorId?: string;
    status?: PoStatus;
    q?: string;
  } = {},
) {
  const rows = await db
    .select({
      id: pos.id,
      number: pos.number,
      projectId: pos.projectId,
      vendorId: pos.vendorId,
      vendorName: vendors.name,
      status: pos.status,
      paymentType: pos.paymentType,
      gross: pos.gross,
      pendingRevision: pos.pendingRevision,
      closedShort: pos.closedShort,
      createdAt: pos.createdAt,
    })
    .from(pos)
    .innerJoin(vendors, eq(vendors.id, pos.vendorId))
    .orderBy(desc(pos.createdAt));

  const allProjects = await db.select().from(projects);
  const projMap = new Map(allProjects.map((p) => [p.id, p]));

  return rows
    .filter((r) => {
      if (isSiteScopedOnly(actor)) {
        if (!r.projectId || !actor.projectIds.includes(r.projectId)) return false;
      }
      if (filters.projectId && r.projectId !== filters.projectId) return false;
      if (filters.vendorId && r.vendorId !== filters.vendorId) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (
          !r.number.toLowerCase().includes(q) &&
          !r.vendorName.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    })
    .map((r) => {
      const p = r.projectId ? projMap.get(r.projectId) : null;
      return {
        ...r,
        projectCode: p?.code ?? 'OFFICE',
        projectName: p?.name ?? 'สำนักงาน / ส่วนกลาง',
      };
    });
}
