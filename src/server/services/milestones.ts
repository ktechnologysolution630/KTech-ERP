import { and, asc, eq, inArray, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { arInvoices, milestones, projects, vendors, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import {
  MILESTONE_KINDS,
  NEXT_MILESTONE_STATUS,
  canCancelMilestone,
  computeMilestoneAmounts,
  milestonesFromBoq,
  summarizeMilestones,
  type MilestoneKind,
  type MilestoneStatus,
} from '@/domain/milestone';
import { D } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can, isSiteScopedOnly, type Action } from '@/server/policy';
import { logActivity } from './activity';
import { getProjectBoqSheet } from './boq';

export interface MilestoneDto {
  id: string;
  seq: number;
  title: string;
  completionCriteria: string;
  vendorId: string | null;
  vendorName: string | null;
  plannedDate: string | null;
  amount: number;
  planPercent: number;
  retentionPercent: number;
  retentionAmount: number;
  netAmount: number;
  status: MilestoneStatus;
  claimedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  note: string;
  /** Live customer invoice billed from this receive milestone */
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface MilestoneSummaryDto {
  budget: number;
  planned: number;
  unplanned: number;
  approvedOrPaid: number;
  paidNet: number;
  retentionHeld: number;
  plannedPercent: number;
}

export interface MilestoneSheet {
  project: { id: string; code: string; name: string; clientName: string; location: string };
  kind: MilestoneKind;
  rows: MilestoneDto[];
  summary: MilestoneSummaryDto;
  hasBoq: boolean;
  permissions: { manage: boolean; approve: boolean; pay: boolean; bill: boolean };
}

export interface MilestoneProjectRow {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
  milestoneCount: number;
  planned: number;
  approvedOrPaid: number;
  budget: number;
}

const kindSchema = z.enum(MILESTONE_KINDS);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const percent = z.number().finite().min(0, 'เปอร์เซ็นต์ต้องไม่ติดลบ').max(100, 'เปอร์เซ็นต์ต้องไม่เกิน 100');

const fieldsSchema = z.object({
  title: z.string().trim().min(1, 'กรุณาระบุรายการงวดงาน').max(300),
  completionCriteria: z.string().trim().max(1000).default(''),
  vendorId: z.string().uuid().nullable().default(null),
  plannedDate: isoDate.nullable().default(null),
  amount: z.number().finite().positive('จำนวนเงินต้องมากกว่า 0').max(10_000_000_000_000),
  retentionPercent: percent.default(0),
  note: z.string().trim().max(1000).default(''),
});

export type MilestoneInput = z.input<typeof fieldsSchema>;

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_MILESTONE', r.error.issues[0].message);
  return r.data;
}

async function loadProject(db: Db, projectId: string) {
  if (!z.string().uuid().safeParse(projectId).success) {
    throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  }
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  return p;
}

async function loadMilestone(db: Db, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบงวดงาน', 404);
  const [m] = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  if (!m) throw new DomainError('NOT_FOUND', 'ไม่พบงวดงาน', 404);
  return m;
}

async function assertVendor(db: Db, kind: MilestoneKind, vendorId: string | null) {
  if (!vendorId) return;
  if (kind !== 'PAY') throw new DomainError('INVALID_MILESTONE', 'ระบุผู้รับเหมาได้เฉพาะงวดงานจ่าย');
  const [v] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  if (!v) throw new DomainError('INVALID_MILESTONE', 'ไม่พบผู้รับเหมาที่เลือก');
}

function amountColumns(amount: number, retentionPercent: number) {
  const { retention } = computeMilestoneAmounts(amount, retentionPercent);
  return {
    amount: D(amount).toFixed(2),
    retentionPercent: D(retentionPercent).toFixed(2),
    retentionAmount: retention.toFixed(2),
  };
}

async function nextSeq(db: Db, projectId: string, kind: MilestoneKind): Promise<number> {
  const [{ last }] = await db
    .select({ last: max(milestones.seq) })
    .from(milestones)
    .where(and(eq(milestones.projectId, projectId), eq(milestones.kind, kind)));
  return (last ?? 0) + 1;
}

/** Projects visible to the actor with their milestone totals for one kind. */
export async function listMilestoneProjects(
  db: Db,
  actor: SessionUser,
  kindInput: MilestoneKind,
): Promise<MilestoneProjectRow[]> {
  const kind = parse(kindSchema, kindInput);
  let visible = await db.select().from(projects).orderBy(asc(projects.code));
  if (isSiteScopedOnly(actor)) visible = visible.filter((p) => actor.projectIds.includes(p.id));
  if (visible.length === 0) return [];

  const rows = await db
    .select()
    .from(milestones)
    .where(
      and(
        eq(milestones.kind, kind),
        inArray(
          milestones.projectId,
          visible.map((p) => p.id),
        ),
      ),
    );
  return visible.map((p) => {
    const own = rows.filter((r) => r.projectId === p.id);
    const s = summarizeMilestones(p.budget, own);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      milestoneCount: own.filter((r) => r.status !== 'CANCELLED').length,
      planned: s.planned.toNumber(),
      approvedOrPaid: s.approvedOrPaid.toNumber(),
      budget: Number(p.budget),
    };
  });
}

export async function getMilestoneSheet(
  db: Db,
  actor: SessionUser,
  projectId: string,
  kindInput: MilestoneKind,
): Promise<MilestoneSheet> {
  const kind = parse(kindSchema, kindInput);
  const project = await loadProject(db, projectId);
  assertCan(actor, 'project.view', { projectId });

  const [rows, boq] = await Promise.all([
    db
      .select({ m: milestones, vendorName: vendors.name })
      .from(milestones)
      .leftJoin(vendors, eq(vendors.id, milestones.vendorId))
      .where(and(eq(milestones.projectId, projectId), eq(milestones.kind, kind)))
      .orderBy(asc(milestones.seq)),
    getProjectBoqSheet(db, actor, projectId),
  ]);

  const invoices =
    kind === 'RECEIVE' && rows.length > 0
      ? await db
          .select({ id: arInvoices.id, number: arInvoices.number, milestoneId: arInvoices.milestoneId })
          .from(arInvoices)
          .where(and(inArray(arInvoices.milestoneId, rows.map((r) => r.m.id)), ne(arInvoices.status, 'VOID')))
      : [];
  const invoiceByMilestone = new Map(invoices.map((i) => [i.milestoneId, i]));

  const budget = D(project.budget);
  const summary = summarizeMilestones(budget, rows.map((r) => r.m));
  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      clientName: project.clientName,
      location: project.location,
    },
    kind,
    rows: rows.map(({ m, vendorName }) => ({
      id: m.id,
      seq: m.seq,
      title: m.title,
      completionCriteria: m.completionCriteria,
      vendorId: m.vendorId,
      vendorName,
      plannedDate: m.plannedDate,
      amount: Number(m.amount),
      planPercent: budget.isZero() ? 0 : D(m.amount).div(budget).times(100).toDecimalPlaces(2).toNumber(),
      retentionPercent: Number(m.retentionPercent),
      retentionAmount: Number(m.retentionAmount),
      netAmount: D(m.amount).minus(m.retentionAmount).toNumber(),
      status: m.status,
      claimedAt: m.claimedAt,
      approvedAt: m.approvedAt,
      paidAt: m.paidAt,
      note: m.note,
      invoiceId: invoiceByMilestone.get(m.id)?.id ?? null,
      invoiceNumber: invoiceByMilestone.get(m.id)?.number ?? null,
    })),
    summary: {
      budget: budget.toNumber(),
      planned: summary.planned.toNumber(),
      unplanned: summary.unplanned.toNumber(),
      approvedOrPaid: summary.approvedOrPaid.toNumber(),
      paidNet: summary.paidNet.toNumber(),
      retentionHeld: summary.retentionHeld.toNumber(),
      plannedPercent: summary.plannedPercent,
    },
    hasBoq: (boq.boq?.lines.length ?? 0) > 0,
    permissions: {
      manage: can(actor, 'milestone.manage', { projectId }),
      approve: can(actor, 'milestone.approve', { projectId }),
      pay: can(actor, 'milestone.pay', { projectId }),
      bill: kind === 'RECEIVE' && can(actor, 'ar.manage'),
    },
  };
}

export async function createMilestone(
  db: Db,
  actor: SessionUser,
  projectId: string,
  kindInput: MilestoneKind,
  input: MilestoneInput,
): Promise<{ id: string }> {
  const kind = parse(kindSchema, kindInput);
  await loadProject(db, projectId);
  assertCan(actor, 'milestone.manage', { projectId });
  const data = parse(fieldsSchema, input);
  await assertVendor(db, kind, data.vendorId);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(milestones)
      .values({
        projectId,
        kind,
        seq: await nextSeq(tx, projectId, kind),
        title: data.title,
        completionCriteria: data.completionCriteria,
        vendorId: data.vendorId,
        plannedDate: data.plannedDate,
        note: data.note,
        ...amountColumns(data.amount, data.retentionPercent),
        createdBy: actor.id,
      })
      .returning();
    await logActivity(tx, { entityType: 'MILESTONE', entityId: row.id, action: 'CREATE', userId: actor.id });
    return { id: row.id };
  });
}

/** Only planned milestones can be edited; once claimed the amount is what was billed. */
export async function updateMilestone(
  db: Db,
  actor: SessionUser,
  id: string,
  input: MilestoneInput,
): Promise<void> {
  const m = await loadMilestone(db, id);
  assertCan(actor, 'milestone.manage', { projectId: m.projectId });
  if (m.status !== 'PLANNED') {
    throw new DomainError('MILESTONE_LOCKED', 'แก้ไขได้เฉพาะงวดงานที่ยังไม่ส่งเบิก', 409);
  }
  const data = parse(fieldsSchema, input);
  await assertVendor(db, m.kind, data.vendorId);
  await db
    .update(milestones)
    .set({
      title: data.title,
      completionCriteria: data.completionCriteria,
      vendorId: data.vendorId,
      plannedDate: data.plannedDate,
      note: data.note,
      ...amountColumns(data.amount, data.retentionPercent),
      updatedAt: new Date(),
    })
    .where(eq(milestones.id, id));
}

export async function deleteMilestone(db: Db, actor: SessionUser, id: string): Promise<void> {
  const m = await loadMilestone(db, id);
  assertCan(actor, 'milestone.manage', { projectId: m.projectId });
  if (m.status !== 'PLANNED') {
    throw new DomainError('MILESTONE_LOCKED', 'ลบได้เฉพาะงวดงานที่ยังไม่ส่งเบิก (ใช้ยกเลิกแทน)', 409);
  }
  await db.delete(milestones).where(eq(milestones.id, id));
}

const STEP_PERMISSION: Record<MilestoneStatus, Action | undefined> = {
  PLANNED: 'milestone.manage', // → CLAIMED
  CLAIMED: 'milestone.approve', // → APPROVED
  APPROVED: 'milestone.pay', // → PAID
  PAID: undefined,
  CANCELLED: undefined,
};

/** Moves a milestone one step: ส่งเบิก → อนุมัติ → จ่าย/รับเงิน, stamping the step date. */
export async function advanceMilestone(
  db: Db,
  actor: SessionUser,
  id: string,
  dateInput?: string,
  /** Set for a phone or tablet: it may approve a claimed milestone and do nothing else */
  opts: { approvalOnly?: boolean } = {},
): Promise<MilestoneStatus> {
  const m = await loadMilestone(db, id);
  if (opts.approvalOnly && m.status !== 'CLAIMED') {
    throw new DomainError('VIEW_ONLY_DEVICE', 'มือถือและแท็บเล็ตอนุมัติงวดงานได้อย่างเดียว การส่งเบิกและจ่ายเงินต้องทำบนโน้ตบุ๊กหรือคอมพิวเตอร์', 403);
  }
  const next = NEXT_MILESTONE_STATUS[m.status];
  const permission = STEP_PERMISSION[m.status];
  if (!next || !permission) {
    throw new DomainError('MILESTONE_LOCKED', 'งวดงานนี้ดำเนินการครบแล้ว', 409);
  }
  assertCan(actor, permission, { projectId: m.projectId });
  const date = dateInput ? parse(isoDate, dateInput) : bangkokDateString();

  const updated = await db.transaction(async (tx) => {
    // Guard against two people advancing the same step at once
    const rows = await tx
      .update(milestones)
      .set({
        status: next,
        ...(next === 'CLAIMED' ? { claimedAt: date } : {}),
        ...(next === 'APPROVED' ? { approvedAt: date } : {}),
        ...(next === 'PAID' ? { paidAt: date } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(milestones.id, id), eq(milestones.status, m.status)))
      .returning();
    if (rows.length === 0) {
      throw new DomainError('MILESTONE_CONFLICT', 'สถานะงวดงานถูกเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่', 409);
    }
    await logActivity(tx, { entityType: 'MILESTONE', entityId: id, action: next, userId: actor.id });
    return rows[0];
  });
  return updated.status;
}

export async function cancelMilestone(db: Db, actor: SessionUser, id: string, reason: string): Promise<void> {
  const m = await loadMilestone(db, id);
  assertCan(actor, 'milestone.manage', { projectId: m.projectId });
  if (!canCancelMilestone(m.status)) {
    throw new DomainError('MILESTONE_LOCKED', 'ยกเลิกงวดงานที่จ่ายหรือยกเลิกแล้วไม่ได้', 409);
  }
  const note = parse(z.string().trim().max(500, 'เหตุผลยาวเกินไป'), reason);
  await db.transaction(async (tx) => {
    await tx
      .update(milestones)
      .set({ status: 'CANCELLED', note: note || m.note, updatedAt: new Date() })
      .where(eq(milestones.id, id));
    await logActivity(tx, { entityType: 'MILESTONE', entityId: id, action: 'CANCELLED', userId: actor.id, note });
  });
}

/**
 * "สร้างจาก BOQ": replaces the plan for one kind with one milestone per BOQ category.
 * Refused once any milestone of that kind has been claimed, so billed history is never rewritten.
 */
export async function generateMilestonesFromBoq(
  db: Db,
  actor: SessionUser,
  projectId: string,
  kindInput: MilestoneKind,
  retentionPercentInput: number,
): Promise<number> {
  const kind = parse(kindSchema, kindInput);
  await loadProject(db, projectId);
  assertCan(actor, 'milestone.manage', { projectId });
  const retentionPercent = parse(percent, retentionPercentInput);

  const sheet = await getProjectBoqSheet(db, actor, projectId);
  if (!sheet.boq || sheet.boq.lines.length === 0) {
    throw new DomainError('NO_BOQ', 'โครงการนี้ยังไม่มี BOQ หลัก', 400);
  }
  const drafts = milestonesFromBoq(
    {
      lines: sheet.boq.lines.map((l) => ({
        isCategory: l.isCategory,
        description: l.description,
        qty: l.qty,
        materialRate: l.materialRate,
        laborRate: l.laborRate,
      })),
      overheadPercent: sheet.boq.overheadPercent,
      discountAmount: sheet.boq.discountAmount,
      vatPercent: sheet.boq.vatPercent,
    },
    kind,
  );
  if (drafts.length === 0) throw new DomainError('NO_BOQ', 'BOQ ยังไม่มีรายการที่มีมูลค่า', 400);

  return db.transaction(async (tx) => {
    const started = await tx
      .select({ id: milestones.id })
      .from(milestones)
      .where(
        and(
          eq(milestones.projectId, projectId),
          eq(milestones.kind, kind),
          ne(milestones.status, 'PLANNED'),
          ne(milestones.status, 'CANCELLED'),
        ),
      )
      .limit(1);
    if (started.length > 0) {
      throw new DomainError('MILESTONE_LOCKED', 'มีงวดงานที่ส่งเบิกแล้ว จึงสร้างแผนใหม่จาก BOQ ไม่ได้', 409);
    }
    await tx.delete(milestones).where(and(eq(milestones.projectId, projectId), eq(milestones.kind, kind)));
    await tx.insert(milestones).values(
      drafts.map((d, i) => ({
        projectId,
        kind,
        seq: i + 1,
        title: d.title,
        ...amountColumns(d.amount.toNumber(), retentionPercent),
        createdBy: actor.id,
      })),
    );
    return drafts.length;
  });
}
