import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { projectHandovers, projects, warrantyDefects, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import {
  DEFECT_STATUSES,
  HANDOVER_STATUSES,
  warrantyState,
  type DefectStatus,
  type HandoverStatus,
  type WarrantyState,
} from '@/domain/handover';
import { type ProjectStatus } from '@/domain/project';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_HANDOVER', r.error.issues[0].message);
  return r.data;
}

async function visibleProjects(db: Db, actor: SessionUser) {
  const all = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, clientName: projects.clientName, status: projects.status })
    .from(projects)
    .orderBy(asc(projects.code));
  return isSiteScopedOnly(actor) ? all.filter((p) => actor.projectIds.includes(p.id)) : all;
}

async function openDefectCounts(db: Db, projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, { open: number; total: number }>();
  const rows = await db
    .select({
      projectId: warrantyDefects.projectId,
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${warrantyDefects.status} in ('OPEN', 'IN_PROGRESS'))::int`,
    })
    .from(warrantyDefects)
    .where(inArray(warrantyDefects.projectId, projectIds))
    .groupBy(warrantyDefects.projectId);
  return new Map(rows.map((r) => [r.projectId, { open: Number(r.open), total: Number(r.total) }]));
}

// ───────────────────────────── Handover ─────────────────────────────

export interface HandoverRow {
  projectId: string;
  code: string;
  name: string;
  customer: string;
  projectStatus: ProjectStatus;
  canManage: boolean;
  handover: {
    status: HandoverStatus;
    handoverDate: string;
    receivedBy: string;
    note: string;
    warrantyNumber: string | null;
    warrantyMonths: number;
    structuralWarrantyMonths: number;
  } | null;
}

export async function listHandovers(db: Db, actor: SessionUser): Promise<HandoverRow[]> {
  const visible = await visibleProjects(db, actor);
  if (visible.length === 0) return [];
  const records = await db
    .select()
    .from(projectHandovers)
    .where(
      inArray(
        projectHandovers.projectId,
        visible.map((p) => p.id),
      ),
    );
  const byProject = new Map(records.map((r) => [r.projectId, r]));
  return visible
    .filter((p) => p.status !== 'CANCELLED' || byProject.has(p.id))
    .map((p) => {
      const h = byProject.get(p.id);
      return {
        projectId: p.id,
        code: p.code,
        name: p.name,
        customer: p.clientName || '-',
        projectStatus: p.status,
        canManage: can(actor, 'project.manage', { projectId: p.id }),
        handover: h
          ? {
              status: h.status,
              handoverDate: h.handoverDate,
              receivedBy: h.receivedBy,
              note: h.note,
              warrantyNumber: h.warrantyNumber,
              warrantyMonths: h.warrantyMonths,
              structuralWarrantyMonths: h.structuralWarrantyMonths,
            }
          : null,
      };
    });
}

const handoverSchema = z
  .object({
    status: z.enum(HANDOVER_STATUSES),
    handoverDate: isoDate,
    receivedBy: z.string().trim().max(200).default(''),
    note: z.string().trim().max(2000).default(''),
    warrantyMonths: z.number().int('ระยะประกันต้องเป็นจำนวนเดือนเต็ม').min(0).max(120, 'ระยะประกันไม่เกิน 120 เดือน'),
    structuralWarrantyMonths: z.number().int('ระยะประกันต้องเป็นจำนวนเดือนเต็ม').min(0).max(240, 'ประกันโครงสร้างไม่เกิน 240 เดือน'),
  })
  .refine((v) => v.status !== 'ACCEPTED' || v.receivedBy.length > 0, {
    message: 'กรุณาระบุชื่อผู้ตรวจรับฝั่งลูกค้า',
  });

export type HandoverInput = z.input<typeof handoverSchema>;

/**
 * Creates or updates the project's handover. Acceptance is final: it issues the warranty number,
 * closes the project and from then on only the note and warranty terms may change.
 */
export async function saveHandover(db: Db, actor: SessionUser, projectId: string, input: HandoverInput): Promise<void> {
  assertCan(actor, 'project.manage', { projectId });
  const data = parse(handoverSchema, input);

  await db.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
    const [existing] = await tx.select().from(projectHandovers).where(eq(projectHandovers.projectId, projectId)).for('update').limit(1);

    if (existing?.status === 'ACCEPTED') {
      if (data.status !== 'ACCEPTED' || data.handoverDate !== existing.handoverDate || data.receivedBy !== existing.receivedBy) {
        throw new DomainError('HANDOVER_LOCKED', 'ลูกค้าตรวจรับแล้ว แก้ไขได้เฉพาะหมายเหตุและระยะประกัน', 409);
      }
      await tx
        .update(projectHandovers)
        .set({
          note: data.note,
          warrantyMonths: data.warrantyMonths,
          structuralWarrantyMonths: data.structuralWarrantyMonths,
          updatedBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(projectHandovers.id, existing.id));
      await logActivity(tx, { entityType: 'PROJECT', entityId: projectId, action: 'HANDOVER_UPDATED', userId: actor.id });
      return;
    }

    if (data.status === 'ACCEPTED' && data.handoverDate > bangkokDateString()) {
      throw new DomainError('INVALID_HANDOVER', 'วันที่ตรวจรับต้องไม่เป็นวันในอนาคต');
    }
    const accepted = data.status === 'ACCEPTED';
    const values = {
      status: data.status,
      handoverDate: data.handoverDate,
      receivedBy: data.receivedBy,
      note: data.note,
      warrantyMonths: data.warrantyMonths,
      structuralWarrantyMonths: data.structuralWarrantyMonths,
      warrantyNumber: accepted ? await nextDocNumber(tx, 'WAR') : null,
      acceptedAt: accepted ? new Date() : null,
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    if (existing) {
      await tx.update(projectHandovers).set(values).where(eq(projectHandovers.id, existing.id));
    } else {
      await tx.insert(projectHandovers).values({ projectId, ...values });
    }
    if (accepted && project.status !== 'COMPLETED') {
      await tx.update(projects).set({ status: 'COMPLETED', updatedAt: new Date() }).where(eq(projects.id, projectId));
    }
    await logActivity(tx, {
      entityType: 'PROJECT',
      entityId: projectId,
      action: `HANDOVER_${data.status}`,
      userId: actor.id,
      data: { handoverDate: data.handoverDate, warrantyNumber: values.warrantyNumber },
    });
  });
}

// ───────────────────────────── Warranty & defects ─────────────────────────────

export interface WarrantyRow {
  projectId: string;
  code: string;
  name: string;
  customer: string;
  warrantyNumber: string;
  startDate: string;
  warrantyMonths: number;
  structuralWarrantyMonths: number;
  endDate: string;
  structuralEndDate: string;
  state: WarrantyState;
  openDefects: number;
  totalDefects: number;
  canRecordDefects: boolean;
}

export async function listWarranties(db: Db, actor: SessionUser): Promise<WarrantyRow[]> {
  const visible = await visibleProjects(db, actor);
  if (visible.length === 0) return [];
  const byId = new Map(visible.map((p) => [p.id, p]));
  const records = await db
    .select()
    .from(projectHandovers)
    .where(
      and(
        eq(projectHandovers.status, 'ACCEPTED'),
        inArray(
          projectHandovers.projectId,
          visible.map((p) => p.id),
        ),
      ),
    )
    .orderBy(desc(projectHandovers.handoverDate));
  const counts = await openDefectCounts(
    db,
    records.map((r) => r.projectId),
  );
  const today = bangkokDateString();
  return records.map((r) => {
    const p = byId.get(r.projectId)!;
    const w = warrantyState(r.handoverDate, r.warrantyMonths, r.structuralWarrantyMonths, today);
    const c = counts.get(r.projectId) ?? { open: 0, total: 0 };
    return {
      projectId: r.projectId,
      code: p.code,
      name: p.name,
      customer: p.clientName || '-',
      warrantyNumber: r.warrantyNumber ?? '-',
      startDate: r.handoverDate,
      warrantyMonths: r.warrantyMonths,
      structuralWarrantyMonths: r.structuralWarrantyMonths,
      ...w,
      openDefects: c.open,
      totalDefects: c.total,
      canRecordDefects: can(actor, 'task.progress', { projectId: r.projectId }),
    };
  });
}

export interface DefectRow {
  id: string;
  number: string;
  title: string;
  location: string;
  reportedDate: string;
  reportedBy: string;
  status: DefectStatus;
  fixedDate: string | null;
  resolution: string;
}

export async function listDefects(db: Db, actor: SessionUser, projectId: string): Promise<DefectRow[]> {
  assertCan(actor, 'project.view', { projectId });
  return db
    .select({
      id: warrantyDefects.id,
      number: warrantyDefects.number,
      title: warrantyDefects.title,
      location: warrantyDefects.location,
      reportedDate: warrantyDefects.reportedDate,
      reportedBy: warrantyDefects.reportedBy,
      status: warrantyDefects.status,
      fixedDate: warrantyDefects.fixedDate,
      resolution: warrantyDefects.resolution,
    })
    .from(warrantyDefects)
    .where(eq(warrantyDefects.projectId, projectId))
    .orderBy(desc(warrantyDefects.reportedDate), desc(warrantyDefects.number));
}

const defectSchema = z.object({
  title: z.string().trim().min(1, 'กรุณาระบุรายการที่แจ้งซ่อม').max(300),
  location: z.string().trim().max(200).default(''),
  reportedDate: isoDate,
  reportedBy: z.string().trim().max(200).default(''),
});

export type DefectInput = z.input<typeof defectSchema>;

/** Records a customer's repair request; only for projects whose handover was accepted. */
export async function createDefect(db: Db, actor: SessionUser, projectId: string, input: DefectInput): Promise<{ id: string; number: string }> {
  assertCan(actor, 'task.progress', { projectId });
  const data = parse(defectSchema, input);
  return db.transaction(async (tx) => {
    const [h] = await tx
      .select({ status: projectHandovers.status, handoverDate: projectHandovers.handoverDate })
      .from(projectHandovers)
      .where(eq(projectHandovers.projectId, projectId))
      .limit(1);
    if (h?.status !== 'ACCEPTED') {
      throw new DomainError('NO_WARRANTY', 'โครงการนี้ยังไม่ได้ตรวจรับส่งมอบ จึงยังไม่มีการรับประกัน', 409);
    }
    if (data.reportedDate < h.handoverDate) {
      throw new DomainError('INVALID_HANDOVER', 'วันที่แจ้งซ่อมต้องไม่ก่อนวันส่งมอบ');
    }
    const number = await nextDocNumber(tx, 'DF');
    const [row] = await tx
      .insert(warrantyDefects)
      .values({ projectId, number, ...data, createdBy: actor.id })
      .returning();
    await logActivity(tx, { entityType: 'PROJECT', entityId: projectId, action: 'DEFECT_REPORTED', userId: actor.id, data: { number } });
    return { id: row!.id, number };
  });
}

const defectUpdateSchema = z
  .object({
    status: z.enum(DEFECT_STATUSES),
    resolution: z.string().trim().max(2000).default(''),
    fixedDate: isoDate.nullable().default(null),
  })
  .refine((v) => v.status !== 'REJECTED' || v.resolution.length > 0, { message: 'กรุณาระบุเหตุผลที่ไม่อยู่ในเงื่อนไขประกัน' });

export type DefectUpdateInput = z.input<typeof defectUpdateSchema>;

export async function updateDefect(db: Db, actor: SessionUser, defectId: string, input: DefectUpdateInput): Promise<void> {
  if (!z.string().uuid().safeParse(defectId).success) throw new DomainError('NOT_FOUND', 'ไม่พบรายการแจ้งซ่อม', 404);
  const data = parse(defectUpdateSchema, input);
  const [defect] = await db.select().from(warrantyDefects).where(eq(warrantyDefects.id, defectId)).limit(1);
  if (!defect) throw new DomainError('NOT_FOUND', 'ไม่พบรายการแจ้งซ่อม', 404);
  assertCan(actor, 'task.progress', { projectId: defect.projectId });
  const fixedDate = data.status === 'FIXED' ? (data.fixedDate ?? bangkokDateString()) : null;
  if (fixedDate && fixedDate < defect.reportedDate) {
    throw new DomainError('INVALID_HANDOVER', 'วันที่ซ่อมเสร็จต้องไม่ก่อนวันที่รับแจ้ง');
  }
  await db
    .update(warrantyDefects)
    .set({ status: data.status, resolution: data.resolution, fixedDate, updatedAt: new Date() })
    .where(eq(warrantyDefects.id, defectId));
  await logActivity(db, {
    entityType: 'PROJECT',
    entityId: defect.projectId,
    action: `DEFECT_${data.status}`,
    userId: actor.id,
    data: { number: defect.number },
  });
}
