import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  prLines,
  projects,
  prs,
  users,
  vendors,
  type PrStatus,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { STOCK_CATEGORIES } from '@/domain/stock';
import { D, round2, type Decimal } from '@/domain/money';
import { assertCan, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { nextProjectDocNumber } from './numbering';

export interface PrLineInput {
  itemId?: string | null;
  description: string;
  unitName: string;
  /** One of STOCK_CATEGORIES; null on lines made before categories */
  category?: string | null;
  qty: Decimal | string | number;
  estUnitPrice?: Decimal | string | number | null;
  neededDate?: string | null;
  note?: string;
  /** Longer specification under the item name */
  detail?: string;
  /** Line discount in baht */
  discount?: Decimal | string | number | null;
}

/** The requisition's header, as printed */
export interface PrHeaderInput {
  docDate?: string | null;
  needBy?: string | null;
  vendorId?: string | null;
  department?: string;
  requesterName?: string;
  deliveryPlace?: string;
  paymentTerms?: string;
  vatMode?: 'EXCLUSIVE' | 'INCLUSIVE' | 'NONE';
  billDiscount?: Decimal | string | number | null;
}

const lineInputSchema = z.object({
  itemId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1, 'กรุณาระบุรายการสินค้า'),
  unitName: z.string().trim().min(1, 'กรุณาระบุหน่วยนับ'),
  category: z
    .enum(STOCK_CATEGORIES, { errorMap: () => ({ message: 'กรุณาเลือกหมวดหมู่จากรายการ' }) })
    .nullable()
    .optional(),
  qty: z.custom<Decimal | string | number>((v) => {
    try {
      return D(v as Decimal.Value).gt(0);
    } catch {
      return false;
    }
  }, 'จำนวนต้องมากกว่า 0'),
  estUnitPrice: z
    .custom<Decimal | string | number | null | undefined>(() => true)
    .optional(),
  neededDate: z.string().nullable().optional(),
  note: z.string().optional(),
  detail: z.string().max(2000, 'รายละเอียดต้องไม่เกิน 2,000 ตัวอักษร').optional(),
  discount: z.custom<Decimal | string | number | null | undefined>(() => true).optional(),
});

const headerSchema = z.object({
  docDate: z.string().nullable().optional(),
  needBy: z.string().nullable().optional(),
  vendorId: z.string().uuid().nullable().optional(),
  department: z.string().trim().max(200).optional(),
  requesterName: z.string().trim().max(200).optional(),
  deliveryPlace: z.string().trim().max(500).optional(),
  paymentTerms: z.string().trim().max(500).optional(),
  vatMode: z.enum(['EXCLUSIVE', 'INCLUSIVE', 'NONE']).optional(),
  billDiscount: z.custom<Decimal | string | number | null | undefined>(() => true).optional(),
});

function money(v: Decimal | string | number | null | undefined): string {
  if (v === undefined || v === null || v === '') return '0.00';
  try {
    const d = round2(D(v as Decimal.Value));
    return d.isNegative() ? '0.00' : d.toFixed(2);
  } catch {
    return '0.00';
  }
}

/** Header columns to write; fields left out keep their value on update */
function headerValues(h: z.infer<typeof headerSchema>) {
  return {
    docDate: h.docDate === undefined ? undefined : h.docDate || null,
    needBy: h.needBy === undefined ? undefined : h.needBy || null,
    vendorId: h.vendorId === undefined ? undefined : h.vendorId || null,
    department: h.department,
    requesterName: h.requesterName,
    deliveryPlace: h.deliveryPlace,
    paymentTerms: h.paymentTerms,
    vatMode: h.vatMode,
    billDiscount: h.billDiscount === undefined ? undefined : money(h.billDiscount),
  };
}

const createPrSchema = headerSchema.extend({
  projectId: z.string().uuid('กรุณาเลือกโครงการ'),
  note: z.string().optional(),
  lines: z.array(lineInputSchema).min(1, 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ'),
});

// Hook replaced in Task 7 when po_lines exists; kept modular so Task 6 runs standalone
let orderedQtyResolver: (
  db: Db,
  prLineIds: string[],
) => Promise<Map<string, Decimal>> = async () => new Map();

export function registerOrderedQtyResolver(
  fn: (db: Db, prLineIds: string[]) => Promise<Map<string, Decimal>>,
) {
  orderedQtyResolver = fn;
}

export async function orderedQtyByPrLine(
  db: Db,
  prLineIds: string[],
): Promise<Map<string, Decimal>> {
  if (prLineIds.length === 0) return new Map();
  return orderedQtyResolver(db, prLineIds);
}

export async function createPr(
  db: Db,
  actor: SessionUser,
  input: { projectId: string; note?: string; lines: PrLineInput[] } & PrHeaderInput,
): Promise<{ id: string; number: string }> {
  const parsed = createPrSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_PR', parsed.error.issues[0].message);
  }
  const d = parsed.data;
  assertCan(actor, 'pr.create', { projectId: d.projectId });

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id, code: projects.code })
      .from(projects)
      .where(eq(projects.id, d.projectId))
      .limit(1);
    if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
    // PR-<project code>-0001, counting per project
    const number = await nextProjectDocNumber(tx, 'PR', project, async (candidate) => {
      const [taken] = await tx.select({ id: prs.id }).from(prs).where(eq(prs.number, candidate)).limit(1);
      return Boolean(taken);
    });
    const [created] = await tx
      .insert(prs)
      .values({
        number,
        projectId: d.projectId,
        requestedBy: actor.id,
        status: 'DRAFT',
        note: d.note ?? '',
        ...headerValues(d),
      })
      .returning();

    await tx.insert(prLines).values(
      d.lines.map((l) => ({
        prId: created.id,
        itemId: l.itemId ?? null,
        description: l.description,
        unitName: l.unitName,
        category: l.category ?? null,
        qty: D(l.qty as Decimal.Value).toDecimalPlaces(3).toFixed(3),
        estUnitPrice:
          l.estUnitPrice !== undefined && l.estUnitPrice !== null && l.estUnitPrice !== ''
            ? round2(D(l.estUnitPrice as Decimal.Value)).toFixed(2)
            : null,
        neededDate: l.neededDate || null,
        detail: l.detail?.trim() ?? '',
        discount: money(l.discount),
        note: l.note ?? '',
      })),
    );

    await logActivity(tx, {
      entityType: 'PR',
      entityId: created.id,
      action: 'create',
      userId: actor.id,
    });

    return { id: created.id, number: created.number };
  });
}

export async function updatePr(
  db: Db,
  actor: SessionUser,
  id: string,
  input: { note?: string; lines: PrLineInput[] } & PrHeaderInput,
): Promise<void> {
  const header = headerSchema.safeParse(input);
  if (!header.success) throw new DomainError('INVALID_PR', header.error.issues[0].message);
  const linesCheck = z
    .array(lineInputSchema)
    .min(1, 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ')
    .safeParse(input.lines);
  if (!linesCheck.success) {
    throw new DomainError('INVALID_PR', linesCheck.error.issues[0].message);
  }

  await db.transaction(async (tx) => {
    const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).limit(1);
    if (!pr) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอซื้อ', 404);
    assertCan(actor, 'pr.create', { projectId: pr.projectId });
    if (
      pr.requestedBy !== actor.id &&
      !actor.roles.includes('OWNER') &&
      !actor.roles.includes('ADMIN')
    ) {
      throw new DomainError('FORBIDDEN', 'เฉพาะผู้เปิดใบขอซื้อเท่านั้นที่แก้ไขได้', 403);
    }
    if (pr.status !== 'DRAFT' && pr.status !== 'REJECTED') {
      throw new DomainError('INVALID_STATE', 'แก้ไขได้เฉพาะสถานะร่างหรือถูกตีกลับ', 409);
    }

    await tx
      .update(prs)
      .set({
        note: input.note !== undefined ? input.note : pr.note,
        ...headerValues(header.data),
        updatedAt: new Date(),
      })
      .where(eq(prs.id, id));

    await tx.delete(prLines).where(eq(prLines.prId, id));
    await tx.insert(prLines).values(
      linesCheck.data.map((l) => ({
        prId: id,
        itemId: l.itemId ?? null,
        description: l.description,
        unitName: l.unitName,
        category: l.category ?? null,
        qty: D(l.qty as Decimal.Value).toDecimalPlaces(3).toFixed(3),
        estUnitPrice:
          l.estUnitPrice !== undefined && l.estUnitPrice !== null && l.estUnitPrice !== ''
            ? round2(D(l.estUnitPrice as Decimal.Value)).toFixed(2)
            : null,
        neededDate: l.neededDate || null,
        detail: l.detail?.trim() ?? '',
        discount: money(l.discount),
        note: l.note ?? '',
      })),
    );

    await logActivity(tx, {
      entityType: 'PR',
      entityId: id,
      action: 'update',
      userId: actor.id,
    });
  });
}

export async function submitPr(db: Db, actor: SessionUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).limit(1);
    if (!pr) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอซื้อ', 404);
    assertCan(actor, 'pr.create', { projectId: pr.projectId });
    if (pr.status !== 'DRAFT' && pr.status !== 'REJECTED') {
      throw new DomainError('INVALID_STATE', 'ส่งขออนุมัติไม่ได้ในสถานะปัจจุบัน', 409);
    }
    const lines = await tx.select().from(prLines).where(eq(prLines.prId, id));
    if (lines.length === 0) {
      throw new DomainError('EMPTY_PR', 'ต้องมีรายการอย่างน้อย 1 รายการ');
    }

    await tx
      .update(prs)
      .set({
        status: 'SUBMITTED',
        rejectReason: null,
        updatedAt: new Date(),
      })
      .where(eq(prs.id, id));

    await logActivity(tx, {
      entityType: 'PR',
      entityId: id,
      action: 'submit',
      userId: actor.id,
    });

    const pms = await usersWithRole(tx, ['PM'], pr.projectId);
    await notify(tx, pms, {
      title: `มีใบขอซื้อรออนุมัติ ${pr.number}`,
      href: `/pr/${pr.id}`,
      category: 'PR',
      projectId: pr.projectId,
    });
  });
}

export async function approvePr(db: Db, actor: SessionUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).limit(1);
    if (!pr) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอซื้อ', 404);
    assertCan(actor, 'pr.approve', { projectId: pr.projectId });
    if (pr.status !== 'SUBMITTED') {
      throw new DomainError('INVALID_STATE', 'อนุมัติได้เฉพาะใบขอซื้อที่ส่งขออนุมัติแล้ว', 409);
    }

    await tx
      .update(prs)
      .set({
        status: 'APPROVED',
        approvedBy: actor.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(prs.id, id));

    await logActivity(tx, {
      entityType: 'PR',
      entityId: id,
      action: 'approve',
      userId: actor.id,
    });

    const buyers = await usersWithRole(tx, ['PURCHASING', 'PURCHASING_HEAD']);
    await notify(tx, [pr.requestedBy, ...buyers], {
      title: `ใบขอซื้อ ${pr.number} อนุมัติแล้ว`,
      href: `/pr/${pr.id}`,
      category: 'PR',
      projectId: pr.projectId,
    });
  });
}

export async function rejectPr(
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
    const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).limit(1);
    if (!pr) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอซื้อ', 404);
    assertCan(actor, 'pr.approve', { projectId: pr.projectId });
    if (pr.status !== 'SUBMITTED') {
      throw new DomainError('INVALID_STATE', 'ตีกลับได้เฉพาะใบขอซื้อที่รออนุมัติ', 409);
    }

    await tx
      .update(prs)
      .set({
        status: 'REJECTED',
        rejectReason: cleanReason,
        updatedAt: new Date(),
      })
      .where(eq(prs.id, id));

    await logActivity(tx, {
      entityType: 'PR',
      entityId: id,
      action: 'reject',
      userId: actor.id,
      note: cleanReason,
    });

    await notify(tx, [pr.requestedBy], {
      title: `ใบขอซื้อ ${pr.number} ถูกตีกลับ: ${cleanReason}`,
      href: `/pr/${pr.id}`,
      category: 'PR',
      projectId: pr.projectId,
    });
  });
}

export async function cancelPr(db: Db, actor: SessionUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).limit(1);
    if (!pr) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอซื้อ', 404);
    assertCan(actor, 'pr.create', { projectId: pr.projectId });

    const lines = await tx.select().from(prLines).where(eq(prLines.prId, id));
    const orderedMap = await orderedQtyByPrLine(
      tx,
      lines.map((l) => l.id),
    );
    const anyOrdered = Array.from(orderedMap.values()).some((q) => q.gt(0));
    if (anyOrdered) {
      throw new DomainError('PR_HAS_ORDERS', 'ยกเลิกไม่ได้เนื่องจากมีการเปิด PO แล้ว', 409);
    }

    await tx
      .update(prs)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(prs.id, id));

    await logActivity(tx, {
      entityType: 'PR',
      entityId: id,
      action: 'cancel',
      userId: actor.id,
    });
  });
}

export async function closePr(db: Db, actor: SessionUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).limit(1);
    if (!pr) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอซื้อ', 404);
    const isPm = actor.roles.includes('PM') && actor.projectIds.includes(pr.projectId);
    const isPurchOrOwner = actor.roles.some((r) =>
      ['PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'].includes(r),
    );
    if (!isPm && !isPurchOrOwner) {
      throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ปิดใบขอซื้อนี้', 403);
    }
    if (pr.status !== 'APPROVED') {
      throw new DomainError('INVALID_STATE', 'ปิดได้เฉพาะใบขอซื้อที่อนุมัติแล้ว', 409);
    }

    await tx
      .update(prs)
      .set({ status: 'CLOSED', updatedAt: new Date() })
      .where(eq(prs.id, id));

    await logActivity(tx, {
      entityType: 'PR',
      entityId: id,
      action: 'close',
      userId: actor.id,
    });
  });
}

export async function getPr(db: Db, actor: SessionUser, id: string) {
  const [pr] = await db
    .select({
      id: prs.id,
      number: prs.number,
      projectId: prs.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      requestedBy: prs.requestedBy,
      requesterName: users.name,
      status: prs.status,
      note: prs.note,
      rejectReason: prs.rejectReason,
      approvedBy: prs.approvedBy,
      approvedAt: prs.approvedAt,
      createdAt: prs.createdAt,
      docDate: prs.docDate,
      needBy: prs.needBy,
      vendorId: prs.vendorId,
      vendorName: vendors.name,
      vendorAddress: vendors.address,
      vendorTaxId: vendors.taxId,
      vendorContactPerson: vendors.contactPerson,
      vendorPhone: vendors.phone,
      vendorEmail: vendors.email,
      department: prs.department,
      /** Typed on the form; the account that opened it is requesterName */
      requesterText: prs.requesterName,
      deliveryPlace: prs.deliveryPlace,
      paymentTerms: prs.paymentTerms,
      vatMode: prs.vatMode,
      billDiscount: prs.billDiscount,
    })
    .from(prs)
    .innerJoin(projects, eq(projects.id, prs.projectId))
    .innerJoin(users, eq(users.id, prs.requestedBy))
    .leftJoin(vendors, eq(vendors.id, prs.vendorId))
    .where(eq(prs.id, id))
    .limit(1);

  if (!pr) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอซื้อ', 404);
  assertCan(actor, 'project.view', { projectId: pr.projectId });

  const rawLines = await db
    .select()
    .from(prLines)
    .where(eq(prLines.prId, id))
    .orderBy(asc(prLines.createdAt));

  const orderedMap = await orderedQtyByPrLine(
    db,
    rawLines.map((l) => l.id),
  );

  const lines = rawLines.map((l) => {
    const qtyDec = D(l.qty);
    const orderedQty = orderedMap.get(l.id) ?? D(0);
    const remaining = qtyDec.minus(orderedQty);
    const remainingQty = remaining.gt(0) ? remaining : D(0);
    return {
      ...l,
      orderedQty,
      remainingQty,
    };
  });

  const totalQty = lines.reduce((acc, l) => acc.plus(D(l.qty)), D(0));
  const totalOrdered = lines.reduce((acc, l) => acc.plus(l.orderedQty), D(0));
  const allComplete = lines.length > 0 && lines.every((l) => l.remainingQty.lte(0));

  let orderProgress: 'NONE' | 'PARTIAL' | 'FULL' = 'NONE';
  if (allComplete && totalQty.gt(0)) orderProgress = 'FULL';
  else if (totalOrdered.gt(0)) orderProgress = 'PARTIAL';

  return {
    ...pr,
    lines,
    orderProgress,
  };
}

export async function listPrs(
  db: Db,
  actor: SessionUser,
  filters: {
    projectId?: string;
    status?: PrStatus;
    q?: string;
  } = {},
) {
  const rows = await db
    .select({
      id: prs.id,
      number: prs.number,
      projectId: prs.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      requestedBy: prs.requestedBy,
      requesterName: users.name,
      status: prs.status,
      note: prs.note,
      createdAt: prs.createdAt,
    })
    .from(prs)
    .innerJoin(projects, eq(projects.id, prs.projectId))
    .innerJoin(users, eq(users.id, prs.requestedBy))
    .orderBy(desc(prs.createdAt));

  return rows.filter((r) => {
    if (isSiteScopedOnly(actor) && !actor.projectIds.includes(r.projectId)) {
      return false;
    }
    if (filters.projectId && r.projectId !== filters.projectId) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!r.number.toLowerCase().includes(q) && !r.note.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}

export async function listOrderablePrLines(
  db: Db,
  actor: SessionUser,
  filters: { projectId?: string } = {},
) {
  const approvedPrs = await db
    .select({
      id: prs.id,
      number: prs.number,
      projectId: prs.projectId,
      projectCode: projects.code,
      projectName: projects.name,
    })
    .from(prs)
    .innerJoin(projects, eq(projects.id, prs.projectId))
    .where(eq(prs.status, 'APPROVED'));

  const scopedPrs = approvedPrs.filter((p) => {
    if (isSiteScopedOnly(actor) && !actor.projectIds.includes(p.projectId)) return false;
    if (filters.projectId && p.projectId !== filters.projectId) return false;
    return true;
  });

  if (scopedPrs.length === 0) return [];

  const prMap = new Map(scopedPrs.map((p) => [p.id, p]));
  const lines = await db
    .select()
    .from(prLines)
    .where(
      inArray(
        prLines.prId,
        scopedPrs.map((p) => p.id),
      ),
    );

  const orderedMap = await orderedQtyByPrLine(
    db,
    lines.map((l) => l.id),
  );

  return lines
    .map((l) => {
      const pr = prMap.get(l.prId)!;
      const orderedQty = orderedMap.get(l.id) ?? D(0);
      const remainingQty = D(l.qty).minus(orderedQty);
      return {
        ...l,
        prNumber: pr.number,
        projectId: pr.projectId,
        projectCode: pr.projectCode,
        projectName: pr.projectName,
        orderedQty,
        remainingQty,
      };
    })
    .filter((l) => l.remainingQty.gt(0));
}
