import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { boqs, boqTakeoffs, projects, users, type SessionUser } from '@/db/schema';
import { emptyTakeoffData, takeoffDataSchema, toBoqLines, type TakeoffData } from '@/domain/boq-takeoff';
import { DomainError } from '@/domain/errors';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { assertNoConflict, parseBoqInput, toDto, writeBoqDocument, type BoqDocumentDto } from './boq';
import { nextDocNumber } from './numbering';

export interface TakeoffSummaryDto {
  id: string;
  number: string;
  name: string;
  projectId: string | null;
  projectLabel: string;
  fileName: string;
  pageCount: number;
  itemCount: number;
  measurementCount: number;
  sentAt: string | null;
  sentBoqNumber: string;
  updatedAt: string;
  updatedByName: string;
  canDelete: boolean;
}

export interface TakeoffDocumentDto {
  id: string;
  number: string;
  name: string;
  projectId: string | null;
  projectLabel: string;
  fileName: string;
  fileFingerprint: string;
  pageCount: number;
  data: TakeoffData;
  sentAt: string | null;
  sentBoqNumber: string;
  updatedAt: string;
  canDelete: boolean;
}

const uuid = z.string().uuid();

const headerSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาใส่ชื่องานถอดแบบ').max(300),
  projectId: uuid.nullable(),
});

const saveSchema = headerSchema.extend({
  /** `updatedAt` of the version the page loaded */
  baseUpdatedAt: z.string().datetime(),
  fileName: z.string().max(500),
  fileFingerprint: z.string().max(200),
  pageCount: z.number().int().min(0).max(99999),
  data: takeoffDataSchema,
});

export type CreateTakeoffInput = z.input<typeof headerSchema>;
export type SaveTakeoffInput = z.input<typeof saveSchema>;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_TAKEOFF', parsed.error.issues[0]!.message);
  return parsed.data;
}

/** Without a project the work belongs to whoever made it, and to staff who see every project */
function canView(actor: SessionUser, row: { projectId: string | null; createdBy: string }): boolean {
  if (row.projectId) return can(actor, 'project.view', { projectId: row.projectId });
  return row.createdBy === actor.id || !isSiteScopedOnly(actor);
}

const canDelete = (actor: SessionUser, row: { createdBy: string }) => row.createdBy === actor.id || actor.roles.some((r) => r === 'OWNER' || r === 'ADMIN');

async function assertProject(db: Db, actor: SessionUser, projectId: string | null) {
  if (!projectId) return;
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  assertCan(actor, 'project.view', { projectId });
}

async function loadRow(db: Db, actor: SessionUser, id: string) {
  if (!uuid.safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบงานถอดแบบ', 404);
  const [row] = await db.select().from(boqTakeoffs).where(eq(boqTakeoffs.id, id)).limit(1);
  // Someone who may not see it is told the same as for one that does not exist
  if (!row || !canView(actor, row)) throw new DomainError('NOT_FOUND', 'ไม่พบงานถอดแบบ', 404);
  return row;
}

/** Refuses (as not found) a take-off the actor may not see */
export async function assertCanViewTakeoff(db: Db, actor: SessionUser, id: string): Promise<void> {
  await loadRow(db, actor, id);
}

async function projectLabels(db: Db, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).where(inArray(projects.id, ids));
  return new Map(rows.map((p) => [p.id, `${p.code} ${p.name}`]));
}

export async function listTakeoffs(db: Db, actor: SessionUser): Promise<TakeoffSummaryDto[]> {
  const rows = await db
    .select({ t: boqTakeoffs, updatedByName: users.name })
    .from(boqTakeoffs)
    .innerJoin(users, eq(users.id, boqTakeoffs.updatedBy))
    .orderBy(desc(boqTakeoffs.updatedAt));
  const visible = rows.filter((r) => canView(actor, r.t));
  const labels = await projectLabels(db, [...new Set(visible.map((r) => r.t.projectId).filter((x): x is string => !!x))]);
  return visible.map(({ t, updatedByName }) => ({
    id: t.id,
    number: t.number,
    name: t.name,
    projectId: t.projectId,
    projectLabel: t.projectId ? (labels.get(t.projectId) ?? '') : '',
    fileName: t.fileName,
    pageCount: t.pageCount,
    itemCount: t.data.items.length,
    measurementCount: t.data.measurements.length,
    sentAt: t.sentAt?.toISOString() ?? null,
    sentBoqNumber: t.sentBoqNumber,
    updatedAt: t.updatedAt.toISOString(),
    updatedByName,
    canDelete: canDelete(actor, t),
  }));
}

async function toDocument(db: Db, actor: SessionUser, t: typeof boqTakeoffs.$inferSelect): Promise<TakeoffDocumentDto> {
  const labels = await projectLabels(db, t.projectId ? [t.projectId] : []);
  return {
    id: t.id,
    number: t.number,
    name: t.name,
    projectId: t.projectId,
    projectLabel: t.projectId ? (labels.get(t.projectId) ?? '') : '',
    fileName: t.fileName,
    fileFingerprint: t.fileFingerprint,
    pageCount: t.pageCount,
    data: t.data,
    sentAt: t.sentAt?.toISOString() ?? null,
    sentBoqNumber: t.sentBoqNumber,
    updatedAt: t.updatedAt.toISOString(),
    canDelete: canDelete(actor, t),
  };
}

export async function getTakeoff(db: Db, actor: SessionUser, id: string): Promise<TakeoffDocumentDto> {
  return toDocument(db, actor, await loadRow(db, actor, id));
}

export async function createTakeoff(db: Db, actor: SessionUser, input: CreateTakeoffInput): Promise<{ id: string; number: string }> {
  const data = parse(headerSchema, input);
  await assertProject(db, actor, data.projectId);
  return db.transaction(async (tx) => {
    const number = await nextDocNumber(tx, 'TO');
    const [row] = await tx
      .insert(boqTakeoffs)
      .values({ number, name: data.name, projectId: data.projectId, data: emptyTakeoffData(), createdBy: actor.id, updatedBy: actor.id })
      .returning();
    await logActivity(tx, { entityType: 'BOQ_TAKEOFF', entityId: row!.id, action: 'CREATE', userId: actor.id, data: { number } });
    return { id: row!.id, number };
  });
}

/** Saves the whole take-off; refused when someone else saved after this copy was loaded. */
export async function saveTakeoff(db: Db, actor: SessionUser, id: string, input: SaveTakeoffInput): Promise<TakeoffDocumentDto> {
  const data = parse(saveSchema, input);
  const itemIds = new Set(data.data.items.map((i) => i.id));
  if (data.data.measurements.some((m) => !itemIds.has(m.itemId))) {
    throw new DomainError('INVALID_TAKEOFF', 'มีการวัดที่ไม่อยู่ในรายการใด กรุณาโหลดหน้าใหม่');
  }
  const current = await loadRow(db, actor, id);
  if (data.projectId !== current.projectId) await assertProject(db, actor, data.projectId);
  if (current.updatedAt.toISOString() !== data.baseUpdatedAt) {
    throw new DomainError('TAKEOFF_CONFLICT', 'มีผู้อื่นบันทึกงานถอดแบบนี้หลังจากที่คุณเปิด กรุณาโหลดหน้าใหม่ก่อนบันทึก', 409);
  }
  const [saved] = await db
    .update(boqTakeoffs)
    .set({
      name: data.name,
      projectId: data.projectId,
      fileName: data.fileName,
      fileFingerprint: data.fileFingerprint,
      pageCount: data.pageCount,
      data: data.data,
      updatedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(and(eq(boqTakeoffs.id, id), eq(boqTakeoffs.updatedAt, current.updatedAt)))
    .returning();
  if (!saved) throw new DomainError('TAKEOFF_CONFLICT', 'มีผู้อื่นบันทึกงานถอดแบบนี้หลังจากที่คุณเปิด กรุณาโหลดหน้าใหม่ก่อนบันทึก', 409);
  return toDocument(db, actor, saved);
}

export async function deleteTakeoff(db: Db, actor: SessionUser, id: string): Promise<void> {
  const row = await loadRow(db, actor, id);
  if (!canDelete(actor, row)) throw new DomainError('FORBIDDEN', 'ลบได้เฉพาะผู้สร้างงานถอดแบบ หรือผู้ดูแลระบบ', 403);
  await db.transaction(async (tx) => {
    await tx.delete(boqTakeoffs).where(eq(boqTakeoffs.id, id));
    await logActivity(tx, { entityType: 'BOQ_TAKEOFF', entityId: id, action: 'DELETE', userId: actor.id, data: { number: row.number, name: row.name } });
  });
}

/**
 * Adds the saved take-off's items to the end of the project's main BOQ (creating the BOQ when there is
 * none), each category as a new heading numbered after the BOQ's last one. The BOQ's other rows are untouched.
 */
export async function sendTakeoffToProjectBoq(
  db: Db,
  actor: SessionUser,
  id: string,
  projectId: string,
): Promise<{ boq: BoqDocumentDto; added: number }> {
  if (!uuid.safeParse(projectId).success) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  const takeoff = await loadRow(db, actor, id);
  assertCan(actor, 'boq.manage', { projectId });
  if (takeoff.data.items.length === 0) throw new DomainError('EMPTY_TAKEOFF', 'ยังไม่มีรายการถอดแบบ', 400);

  const result = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
    if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
    const [existing] = await tx
      .select()
      .from(boqs)
      .where(and(eq(boqs.projectId, projectId), eq(boqs.kind, 'MAIN')))
      .limit(1);
    const current = existing ? await toDto(tx, existing) : null;
    const lines = current?.lines ?? [];
    const lastCategoryNo = lines.filter((l) => l.isCategory).reduce((n, l) => Math.max(n, Number.parseInt(l.no, 10) || 0), 0);
    const added = toBoqLines(takeoff.data, { firstCategoryNo: lastCategoryNo + 1, note: `ถอดแบบ ${takeoff.number}` });

    const { data, totals } = parseBoqInput({
      baseUpdatedAt: current?.updatedAt ?? null,
      revision: current?.revision ?? 0,
      estimateDate: current?.estimateDate ?? bangkokDateString(),
      projectTitle: current?.projectTitle ?? project.name,
      location: current?.location ?? project.location,
      owner: current?.owner ?? project.clientName,
      workDetail: current?.workDetail ?? '',
      estimator: current?.estimator ?? actor.name,
      overheadPercent: current?.overheadPercent ?? 0,
      discountAmount: current?.discountAmount ?? 0,
      vatPercent: current?.vatPercent ?? 7,
      remarks: current?.remarks ?? '',
      lines: [...lines, ...added],
    });
    assertNoConflict(existing ?? null, data.baseUpdatedAt);
    const boq = await writeBoqDocument(tx, actor, existing ?? null, { projectId, kind: 'MAIN', voId: null }, data, totals);

    await tx
      .update(boqTakeoffs)
      .set({ sentAt: new Date(), sentBoqNumber: boq.number, projectId: takeoff.projectId ?? projectId })
      .where(eq(boqTakeoffs.id, id));
    await logActivity(tx, {
      entityType: 'BOQ_TAKEOFF',
      entityId: id,
      action: 'SEND_TO_BOQ',
      userId: actor.id,
      data: { boqNumber: boq.number, projectId, lines: added.length },
    });
    return { boq, added: added.length };
  });

  return { boq: await toDto(db, result.boq), added: result.added };
}
