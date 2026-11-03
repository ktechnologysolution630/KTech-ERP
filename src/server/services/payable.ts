import { and, asc, eq, lte, ne } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  invoices,
  payables,
  poInstallments,
  pos,
  vendors,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { allocate, D, round2, sum, type Decimal } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { lockPo } from './po';

function splitByPoRatio(
  amount: Decimal,
  poBeforeVat: Decimal,
  poVat: Decimal,
): { beforeVat: Decimal; vat: Decimal; gross: Decimal } {
  const gross = round2(amount);
  if (poVat.lte(0)) {
    return { beforeVat: gross, vat: D(0), gross };
  }
  const [beforeVat, vat] = allocate(gross, [poBeforeVat, poVat]);
  return {
    beforeVat: beforeVat ?? gross,
    vat: vat ?? D(0),
    gross,
  };
}

export async function requestPrepaid(
  db: Db,
  actor: SessionUser,
  poId: string,
  note?: string,
): Promise<string> {
  assertCan(actor, 'payable.request');

  return db.transaction(async (tx) => {
    const po = await lockPo(tx, poId);
    if (po.paymentType !== 'PREPAID') {
      throw new DomainError(
        'INVALID_PAYMENT_TYPE',
        'ใบสั่งซื้อนี้ไม่ใช่เงื่อนไขจ่ายก่อนรับของ (PREPAID)',
        400,
      );
    }
    if (po.status !== 'APPROVED' && po.status !== 'ORDERED') {
      throw new DomainError(
        'INVALID_STATUS',
        'ขอเบิกได้เฉพาะใบสั่งซื้อที่อนุมัติแล้วหรือสั่งซื้อแล้วเท่านั้น',
        409,
      );
    }

    const existing = await tx
      .select({ gross: payables.gross })
      .from(payables)
      .where(and(eq(payables.poId, po.id), ne(payables.status, 'CANCELLED')));

    const existingGross = sum(existing.map((r) => D(r.gross)));
    const remaining = round2(D(po.gross).minus(existingGross));

    if (remaining.lte(0)) {
      throw new DomainError(
        'NOTHING_TO_REQUEST',
        'ไม่มีวงเงินคงเหลือให้ขอเบิกในใบสั่งซื้อนี้',
        409,
      );
    }

    const { beforeVat, vat, gross } = splitByPoRatio(
      remaining,
      D(po.beforeVat),
      D(po.vat),
    );
    const today = bangkokDateString(new Date());

    const [created] = await tx
      .insert(payables)
      .values({
        sourceType: 'PREPAID_REQUEST',
        poId: po.id,
        projectId: po.projectId,
        vendorId: po.vendorId,
        beforeVat: beforeVat.toFixed(2),
        vat: vat.toFixed(2),
        gross: gross.toFixed(2),
        dueDate: today,
        status: 'OPEN',
        requestedBy: actor.id,
        note: note?.trim() || `ขอเบิกจ่ายล่วงหน้า ${po.number}`,
      })
      .returning();

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: po.id,
      action: 'PREPAID_REQUESTED',
      data: { payableId: created!.id, gross: gross.toFixed(2) },
    });

    const financeUsers = await usersWithRole(tx, ['FINANCE']);
    await notify(tx, financeUsers, {
      title: `มีคำขอเบิกเงินล่วงหน้า ${po.number} (฿${gross.toFixed(2)})`,
      href: `/po/${po.id}`,
    });

    return created!.id;
  });
}

export async function requestInstallment(
  db: Db,
  actor: SessionUser,
  installmentId: string,
  note?: string,
): Promise<string> {
  assertCan(actor, 'payable.request');

  return db.transaction(async (tx) => {
    const [inst] = await tx
      .select()
      .from(poInstallments)
      .where(eq(poInstallments.id, installmentId))
      .limit(1);
    if (!inst) throw new DomainError('NOT_FOUND', 'ไม่พบงวดการจ่ายเงิน', 404);

    const po = await lockPo(tx, inst.poId);
    if (po.status !== 'APPROVED' && po.status !== 'ORDERED') {
      throw new DomainError(
        'INVALID_STATUS',
        'ขอเบิกงวดได้เฉพาะใบสั่งซื้อที่อนุมัติแล้วหรือสั่งซื้อแล้วเท่านั้น',
        409,
      );
    }
    if (inst.status !== 'PENDING') {
      throw new DomainError(
        'INVALID_STATUS',
        'งวดนี้ถูกขอเบิกหรือจ่ายเงินไปแล้ว',
        409,
      );
    }

    const { beforeVat, vat, gross } = splitByPoRatio(
      D(inst.amount),
      D(po.beforeVat),
      D(po.vat),
    );
    const today = bangkokDateString(new Date());

    await tx
      .update(poInstallments)
      .set({ status: 'REQUESTED', updatedAt: new Date() })
      .where(eq(poInstallments.id, inst.id));

    const [created] = await tx
      .insert(payables)
      .values({
        sourceType: 'INSTALLMENT',
        poId: po.id,
        projectId: po.projectId,
        vendorId: po.vendorId,
        installmentId: inst.id,
        beforeVat: beforeVat.toFixed(2),
        vat: vat.toFixed(2),
        gross: gross.toFixed(2),
        dueDate: today,
        status: 'OPEN',
        requestedBy: actor.id,
        note: note?.trim() || `ขอเบิกงวดที่ ${inst.seq}: ${inst.name} (${po.number})`,
      })
      .returning();

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: po.id,
      action: 'INSTALLMENT_REQUESTED',
      data: {
        installmentId: inst.id,
        name: inst.name,
        payableId: created!.id,
        gross: gross.toFixed(2),
      },
    });

    const financeUsers = await usersWithRole(tx, ['FINANCE']);
    await notify(tx, financeUsers, {
      title: `มีคำขอเบิกงวด ${inst.name} ของ ${po.number} (฿${gross.toFixed(2)})`,
      href: `/po/${po.id}`,
    });

    return created!.id;
  });
}

export async function listOpenPayables(
  db: Db,
  actor: SessionUser,
  filters: { vendorId?: string; dueBefore?: string } = {},
) {
  assertCan(actor, 'invoice.manage');

  const conditions = [eq(payables.status, 'OPEN')];
  if (filters.vendorId) {
    conditions.push(eq(payables.vendorId, filters.vendorId));
  }
  if (filters.dueBefore) {
    conditions.push(lte(payables.dueDate, filters.dueBefore));
  }

  const rows = await db
    .select({
      payable: payables,
      vendorName: vendors.name,
      defaultWhtRate: vendors.defaultWhtRate,
      poNumber: pos.number,
      invoiceNo: invoices.invoiceNo,
      installmentName: poInstallments.name,
    })
    .from(payables)
    .innerJoin(vendors, eq(vendors.id, payables.vendorId))
    .leftJoin(pos, eq(pos.id, payables.poId))
    .leftJoin(invoices, eq(invoices.id, payables.invoiceId))
    .leftJoin(poInstallments, eq(poInstallments.id, payables.installmentId))
    .where(and(...conditions))
    .orderBy(asc(payables.dueDate), asc(payables.createdAt));

  return rows.map((r) => ({
    ...r.payable,
    vendorName: r.vendorName,
    defaultWhtRate: r.defaultWhtRate,
    poNumber: r.poNumber ?? null,
    invoiceNo: r.invoiceNo ?? null,
    installmentName: r.installmentName ?? null,
  }));
}
