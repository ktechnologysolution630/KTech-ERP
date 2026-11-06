import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  payables,
  pos,
  projectMembers,
  projects,
  prvItems,
  prvs,
  userRoles,
  users,
  vendors,
  type PrvCategory,
  type PrvStatus,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { computePrvTotals, PRV_NEW_CATEGORIES } from '@/domain/prv';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';

export type { PrvCategory, PrvStatus };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const percent = (label: string) => z.number().finite().min(0, `${label}ต้องอยู่ระหว่าง 0-100`).max(100, `${label}ต้องอยู่ระหว่าง 0-100`);

const createSchema = z.object({
  date: isoDate.optional(),
  projectId: z.string().uuid('กรุณาเลือกโครงการ'),
  vendorId: z.string().uuid('กรุณาเลือกผู้รับเงินจากรายชื่อผู้รับเหมา/ผู้ขาย'),
  category: z.enum(PRV_NEW_CATEGORIES),
  installmentNo: z.number().int().min(1).max(999).nullable().default(null),
  retentionPercent: percent('เงินประกันผลงาน').default(0),
  whtRate: percent('อัตราหัก ณ ที่จ่าย').default(0),
  vatRate: percent('อัตรา VAT').default(0),
  notes: z.string().trim().max(2000).default(''),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1, 'กรุณาระบุรายละเอียดรายการ').max(500),
        quantity: z.number().finite().positive('จำนวนต้องมากกว่า 0').max(1_000_000_000),
        unit: z.string().trim().max(30).default('งาน'),
        unitPrice: z.number().finite().min(0, 'ราคาต้องไม่ติดลบ').max(10_000_000_000),
        progressPercent: percent('ผลงาน (%) ').default(100),
      }),
    )
    .min(1, 'ต้องมีรายการขอเบิกอย่างน้อย 1 รายการ')
    .max(200),
});
export type CreatePrvInput = z.input<typeof createSchema>;

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_PRV', r.error.issues[0].message);
  return r.data;
}

export async function createPrv(db: Db, actor: SessionUser, input: CreatePrvInput) {
  const data = parse(createSchema, input);
  assertCan(actor, 'prv.create', { projectId: data.projectId });
  const totals = computePrvTotals(data.items, data);
  if (totals.total.lte(0)) throw new DomainError('INVALID_PRV', 'ยอดขอเบิกต้องมากกว่า 0');

  return db.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, data.projectId)).limit(1);
    if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
    const [vendor] = await tx.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.id, data.vendorId)).limit(1);
    if (!vendor) throw new DomainError('NOT_FOUND', 'ไม่พบผู้รับเงินที่เลือก', 404);

    const prvNumber = await nextDocNumber(tx, 'PRV');
    const [prv] = await tx
      .insert(prvs)
      .values({
        prvNumber,
        date: data.date ?? bangkokDateString(),
        projectId: data.projectId,
        vendorId: vendor.id,
        payeeName: vendor.name,
        category: data.category,
        installmentNo: data.installmentNo,
        totalAmount: totals.total.toFixed(2),
        retentionPercent: data.retentionPercent.toFixed(2),
        retentionAmount: totals.retention.toFixed(2),
        whtRate: data.whtRate.toFixed(2),
        whtAmount: totals.wht.toFixed(2),
        vatAmount: totals.vat.toFixed(2),
        netAmount: totals.net.toFixed(2),
        status: 'DRAFT',
        requestedBy: actor.id,
        notes: data.notes,
      })
      .returning();
    await tx.insert(prvItems).values(
      data.items.map((it, i) => ({
        prvId: prv.id,
        description: it.description,
        quantity: it.quantity.toFixed(3),
        unit: it.unit || 'งาน',
        unitPrice: it.unitPrice.toFixed(2),
        amount: totals.lineAmounts[i].toFixed(2),
        progressPercent: it.progressPercent.toFixed(2),
      })),
    );
    await logActivity(tx, { entityType: 'PRV', entityId: prv.id, action: 'CREATE', userId: actor.id });
    return prv;
  });
}

export type PrvTransition = 'submit' | 'verify' | 'approve' | 'reject';

const TRANSITIONS: Record<PrvTransition, { from: PrvStatus[]; to: PrvStatus }> = {
  submit: { from: ['DRAFT', 'REJECTED'], to: 'SUBMITTED' },
  verify: { from: ['SUBMITTED'], to: 'PM_VERIFIED' },
  approve: { from: ['PM_VERIFIED'], to: 'APPROVED' },
  reject: { from: ['SUBMITTED', 'PM_VERIFIED'], to: 'REJECTED' },
};

/**
 * DRAFT → SUBMITTED (requester) → PM_VERIFIED (project PM / owner) → APPROVED (owner).
 * Either reviewer may reject with a reason; the requester can resubmit. Nobody approves their
 * own request. Approval creates a payable so finance pays it through a PV like any other bill.
 */
export async function transitionPrv(db: Db, actor: SessionUser, id: string, action: PrvTransition, noteInput = '') {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอเบิก', 404);
  const note = noteInput.trim().slice(0, 1000);
  if (action === 'reject' && !note) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');

  return db.transaction(async (tx) => {
    const [prv] = await tx.select().from(prvs).where(eq(prvs.id, id)).for('update');
    if (!prv) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอเบิก', 404);
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(prv.status)) {
      throw new DomainError('INVALID_STATE', 'สถานะเอกสารเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่', 409);
    }

    if (action === 'submit') {
      if (prv.requestedBy !== actor.id) assertCan(actor, 'prv.create', { projectId: prv.projectId });
    } else {
      if (prv.requestedBy === actor.id) throw new DomainError('SELF_APPROVAL', 'ตรวจ/อนุมัติใบขอเบิกของตนเองไม่ได้', 403);
      const needed = action === 'approve' || (action === 'reject' && prv.status === 'PM_VERIFIED') ? 'prv.approve' : 'prv.verify';
      assertCan(actor, needed, { projectId: prv.projectId });
    }

    const now = new Date();
    await tx
      .update(prvs)
      .set({
        status: rule.to,
        updatedAt: now,
        ...(action === 'verify' ? { verifiedBy: actor.id, verifiedAt: now } : {}),
        ...(action === 'approve' ? { approvedBy: actor.id, approvedAt: now } : {}),
        ...(action === 'submit' ? { verifiedBy: null, verifiedAt: null } : {}),
      })
      .where(eq(prvs.id, id));

    if (action === 'approve') {
      if (!prv.vendorId) {
        throw new DomainError('INVALID_PRV', 'ใบขอเบิกนี้ไม่มีผู้รับเงินในระบบ จึงตั้งหนี้ไม่ได้ กรุณาเปิดใบใหม่โดยเลือกผู้รับเหมา/ผู้ขาย');
      }
      const totals = {
        beforeVat: Number(prv.totalAmount) - Number(prv.retentionAmount),
        vat: Number(prv.vatAmount),
      };
      await tx.insert(payables).values({
        sourceType: prv.category === 'CONTRACTOR_PROGRESS' ? 'CONTRACTOR_CLAIM' : 'EXPENSE',
        projectId: prv.projectId,
        vendorId: prv.vendorId,
        beforeVat: totals.beforeVat.toFixed(2),
        vat: totals.vat.toFixed(2),
        gross: (totals.beforeVat + totals.vat).toFixed(2),
        dueDate: bangkokDateString(),
        requestedBy: prv.requestedBy,
        note: `${prv.prvNumber}${prv.whtRate !== '0.00' ? ` · หัก ณ ที่จ่าย ${Number(prv.whtRate)}%` : ''}`,
      });
    }

    await logActivity(tx, { entityType: 'PRV', entityId: id, action: action.toUpperCase(), userId: actor.id, note: note || undefined });
    const href = `/prv/${id}`;
    if (action === 'submit') {
      const pms = await tx
        .select({ id: projectMembers.userId })
        .from(projectMembers)
        .innerJoin(userRoles, and(eq(userRoles.userId, projectMembers.userId), eq(userRoles.role, 'PM')))
        .where(eq(projectMembers.projectId, prv.projectId));
      await notify(tx, [...pms.map((p) => p.id), ...(await usersWithRole(tx, ['GENERAL_MANAGER', 'OWNER']))].filter((u) => u !== actor.id), {
        title: `${prv.prvNumber} รอตรวจรับรองผลงาน`,
        href,
      });
    } else if (action === 'verify') {
      await notify(tx, (await usersWithRole(tx, ['OWNER'])).filter((u) => u !== actor.id), { title: `${prv.prvNumber} รออนุมัติจ่าย`, href });
    } else {
      const finance = action === 'approve' ? await usersWithRole(tx, ['FINANCE']) : [];
      await notify(tx, [prv.requestedBy, ...finance], {
        title: `${prv.prvNumber} ${action === 'approve' ? 'อนุมัติแล้ว รอทำจ่าย' : 'ไม่อนุมัติ'}`,
        href,
      });
    }
    return rule.to;
  });
}

function visibleProjectFilter(actor: SessionUser) {
  if (!isSiteScopedOnly(actor)) return undefined;
  return actor.projectIds.length ? inArray(prvs.projectId, actor.projectIds) : sql`false`;
}

export async function getPrvs(db: Db, actor: SessionUser, filters: { projectId?: string } = {}) {
  const rows = await db
    .select({
      prv: prvs,
      projectName: projects.name,
      requestedByName: users.name,
    })
    .from(prvs)
    .innerJoin(projects, eq(projects.id, prvs.projectId))
    .innerJoin(users, eq(users.id, prvs.requestedBy))
    .where(and(visibleProjectFilter(actor), filters.projectId ? eq(prvs.projectId, filters.projectId) : undefined))
    .orderBy(desc(prvs.createdAt));
  return rows.map((r) => ({ ...r.prv, projectName: r.projectName, requestedByName: r.requestedByName }));
}

export async function getPrvById(db: Db, actor: SessionUser, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [prv] = await db.select().from(prvs).where(eq(prvs.id, id)).limit(1);
  if (!prv) return null;
  assertCan(actor, 'project.view', { projectId: prv.projectId });

  const [items, [project], [vendor], [po], people] = await Promise.all([
    db.select().from(prvItems).where(eq(prvItems.prvId, prv.id)).orderBy(prvItems.createdAt),
    db.select().from(projects).where(eq(projects.id, prv.projectId)).limit(1),
    prv.vendorId ? db.select().from(vendors).where(eq(vendors.id, prv.vendorId)).limit(1) : Promise.resolve([null]),
    prv.poId ? db.select().from(pos).where(eq(pos.id, prv.poId)).limit(1) : Promise.resolve([null]),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [prv.requestedBy, prv.verifiedBy, prv.approvedBy].filter((x): x is string => !!x))),
  ]);
  const nameOf = (uid: string | null) => (uid ? (people.find((p) => p.id === uid)?.name ?? '-') : null);
  const isRequester = prv.requestedBy === actor.id;
  return {
    ...prv,
    items,
    project,
    vendor,
    po,
    requestedByName: nameOf(prv.requestedBy) ?? '-',
    verifiedByName: nameOf(prv.verifiedBy),
    approvedByName: nameOf(prv.approvedBy),
    allowed: {
      submit: (prv.status === 'DRAFT' || prv.status === 'REJECTED') && (isRequester || can(actor, 'prv.create', { projectId: prv.projectId })),
      verify: prv.status === 'SUBMITTED' && !isRequester && can(actor, 'prv.verify', { projectId: prv.projectId }),
      approve: prv.status === 'PM_VERIFIED' && !isRequester && can(actor, 'prv.approve', { projectId: prv.projectId }),
      pay: prv.status === 'APPROVED' && can(actor, 'pv.manage'),
    },
  };
}

/** Settlement status of the payable an approved PRV created (matched by its note). */
export async function prvPayableStatus(db: Db, prvNumber: string) {
  const [row] = await db
    .select({ status: payables.status })
    .from(payables)
    .where(and(sql`${payables.note} like ${`${prvNumber}%`}`, inArray(payables.sourceType, ['CONTRACTOR_CLAIM', 'EXPENSE'])))
    .limit(1);
  return row?.status ?? null;
}
