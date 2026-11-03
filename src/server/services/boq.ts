import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { boqLines, boqs, poLines, projects, type BoqKind, type SessionUser } from '@/db/schema';
import { computeBoqTotals } from '@/domain/boq';
import { DomainError } from '@/domain/errors';
import { D } from '@/domain/money';
import { assertCan, can } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';

export interface BoqLineDto {
  id: string;
  isCategory: boolean;
  isBold: boolean;
  no: string;
  description: string;
  qty: number | '';
  unit: string;
  materialRate: number | '';
  laborRate: number | '';
  note: string;
}

/** Serializable BOQ sheet passed between server and the editor. */
export interface BoqDocumentDto {
  id: string;
  number: string;
  revision: number;
  estimateDate: string | null;
  projectTitle: string;
  location: string;
  owner: string;
  workDetail: string;
  estimator: string;
  overheadPercent: number;
  discountAmount: number;
  vatPercent: number;
  remarks: string;
  grandTotal: number;
  updatedAt: string;
  lines: BoqLineDto[];
}

const MAX_AMOUNT = 1_000_000_000_000;
const optionalAmount = z.union([z.number().finite().min(0).max(MAX_AMOUNT), z.literal('')]);

const lineSchema = z.object({
  /** Id of an already-saved line; unknown ids (e.g. client temp ids) are treated as new lines */
  id: z.string().max(100).optional(),
  isCategory: z.boolean(),
  isBold: z.boolean(),
  no: z.string().trim().max(20),
  description: z.string().max(1000),
  qty: optionalAmount,
  unit: z.string().trim().max(50),
  materialRate: optionalAmount,
  laborRate: optionalAmount,
  note: z.string().max(500),
});

const saveSchema = z.object({
  /** `updatedAt` of the version the editor loaded; null when no BOQ existed yet. */
  baseUpdatedAt: z.string().datetime().nullable(),
  revision: z.number().int().min(0).max(999),
  estimateDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง')
    .nullable(),
  projectTitle: z.string().trim().max(300),
  location: z.string().trim().max(300),
  owner: z.string().trim().max(300),
  workDetail: z.string().trim().max(1000),
  estimator: z.string().trim().max(300),
  overheadPercent: z.number().finite().min(0).max(100),
  discountAmount: z.number().finite().min(0).max(MAX_AMOUNT),
  vatPercent: z.number().finite().min(0).max(100),
  remarks: z.string().max(5000),
  lines: z.array(lineSchema).max(3000, 'รายการ BOQ เกิน 3,000 แถว'),
});

export type SaveBoqInput = z.input<typeof saveSchema>;

function toAmount(v: string | null): number | '' {
  return v === null ? '' : Number(v);
}

function fromAmount(v: number | '', places: number): string | null {
  return v === '' ? null : D(v).toFixed(places);
}

async function loadProject(db: Db, projectId: string) {
  // Non-uuid ids would raise a Postgres cast error; treat them as not found
  if (!z.string().uuid().safeParse(projectId).success) {
    throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  }
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  return project;
}

export async function toDto(db: Db, boq: typeof boqs.$inferSelect): Promise<BoqDocumentDto> {
  const lines = await db
    .select()
    .from(boqLines)
    .where(eq(boqLines.boqId, boq.id))
    .orderBy(asc(boqLines.sort));
  return {
    id: boq.id,
    number: boq.number,
    revision: boq.revision,
    estimateDate: boq.estimateDate,
    projectTitle: boq.projectTitle,
    location: boq.location,
    owner: boq.owner,
    workDetail: boq.workDetail,
    estimator: boq.estimator,
    overheadPercent: Number(boq.overheadPercent),
    discountAmount: Number(boq.discountAmount),
    vatPercent: Number(boq.vatPercent),
    remarks: boq.remarks,
    grandTotal: Number(boq.grandTotal),
    updatedAt: boq.updatedAt.toISOString(),
    lines: lines.map((l) => ({
      id: l.id,
      isCategory: l.isCategory,
      isBold: l.isBold,
      no: l.no,
      description: l.description,
      qty: toAmount(l.qty),
      unit: l.unit,
      materialRate: toAmount(l.materialRate),
      laborRate: toAmount(l.laborRate),
      note: l.note,
    })),
  };
}

export interface ProjectBoqSheet {
  project: { id: string; code: string; name: string };
  /** null when no main BOQ has been saved yet */
  boq: BoqDocumentDto | null;
  canEdit: boolean;
}

/** Loads the project's main BOQ for viewing; throws 404/403 for unknown or inaccessible projects. */
export async function getProjectBoqSheet(
  db: Db,
  actor: SessionUser,
  projectId: string,
): Promise<ProjectBoqSheet> {
  const project = await loadProject(db, projectId);
  assertCan(actor, 'project.view', { projectId });
  const [boq] = await db
    .select()
    .from(boqs)
    .where(and(eq(boqs.projectId, projectId), eq(boqs.kind, 'MAIN')))
    .limit(1);
  return {
    project: { id: project.id, code: project.code, name: project.name },
    boq: boq ? await toDto(db, boq) : null,
    canEdit: can(actor, 'boq.manage', { projectId }),
  };
}

/**
 * Creates or replaces the project's main BOQ in one transaction.
 * Rejects with 409 when someone else saved after the editor loaded (`baseUpdatedAt`).
 */
export async function saveProjectMainBoq(
  db: Db,
  actor: SessionUser,
  projectId: string,
  input: SaveBoqInput,
): Promise<BoqDocumentDto> {
  assertCan(actor, 'boq.manage', { projectId });
  const { data, totals } = parseBoqInput(input);

  const saved = await db.transaction(async (tx) => {
    // Lock the project row so concurrent first-saves cannot both create a main BOQ
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
    if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);

    const [existing] = await tx
      .select()
      .from(boqs)
      .where(and(eq(boqs.projectId, projectId), eq(boqs.kind, 'MAIN')))
      .limit(1);

    assertNoConflict(existing ?? null, data.baseUpdatedAt);
    return writeBoqDocument(tx, actor, existing ?? null, { projectId, kind: 'MAIN', voId: null }, data, totals);
  });

  return toDto(db, saved);
}

export function parseBoqInput(input: SaveBoqInput) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_BOQ', parsed.error.issues[0].message);
  }
  const data = parsed.data;
  const totals = computeBoqTotals({
    rows: data.lines,
    overheadPercent: data.overheadPercent,
    discountAmount: data.discountAmount,
    vatPercent: data.vatPercent,
  });
  return { data, totals };
}

export type ParsedBoqInput = ReturnType<typeof parseBoqInput>;

/** Rejects a save based on a version older than what is stored. */
export function assertNoConflict(existing: typeof boqs.$inferSelect | null, baseUpdatedAt: string | null) {
  const existingStamp = existing ? existing.updatedAt.toISOString() : null;
  if (existingStamp !== baseUpdatedAt) {
    throw new DomainError(
      'BOQ_CONFLICT',
      'มีผู้อื่นบันทึก BOQ นี้หลังจากที่คุณเปิด กรุณาโหลดหน้าใหม่ก่อนบันทึก',
      409,
    );
  }
}

/**
 * Writes a BOQ header and its lines inside the caller's transaction. Line ids stay stable
 * across saves; lines referenced by purchase orders cannot be removed.
 */
export async function writeBoqDocument(
  tx: Db,
  actor: SessionUser,
  existing: typeof boqs.$inferSelect | null,
  target: { projectId: string; kind: BoqKind; voId: string | null },
  data: ParsedBoqInput['data'],
  totals: ParsedBoqInput['totals'],
): Promise<typeof boqs.$inferSelect> {
  const header = {
    revision: data.revision,
    estimateDate: data.estimateDate,
    projectTitle: data.projectTitle,
    location: data.location,
    owner: data.owner,
    workDetail: data.workDetail,
    estimator: data.estimator,
    overheadPercent: D(data.overheadPercent).toFixed(2),
    discountAmount: D(data.discountAmount).toFixed(2),
    vatPercent: D(data.vatPercent).toFixed(2),
    remarks: data.remarks,
    materialTotal: totals.materialTotal.toFixed(2),
    laborTotal: totals.laborTotal.toFixed(2),
    grandTotal: totals.grandTotal.toFixed(2),
    updatedBy: actor.id,
    updatedAt: new Date(),
  };

  let boq: typeof boqs.$inferSelect;
  if (existing) {
    [boq] = await tx.update(boqs).set(header).where(eq(boqs.id, existing.id)).returning();
  } else {
    const number = await nextDocNumber(tx, 'BOQ');
    [boq] = await tx
      .insert(boqs)
      .values({ ...header, ...target, number, createdBy: actor.id })
      .returning();
  }

  // Line ids stay stable across saves because purchase orders reference them
  const savedIds = new Set(
    (await tx.select({ id: boqLines.id }).from(boqLines).where(eq(boqLines.boqId, boq.id))).map((r) => r.id),
  );
  const keptIds = new Set(data.lines.map((l) => l.id).filter((id): id is string => !!id && savedIds.has(id)));
  const removedIds = [...savedIds].filter((id) => !keptIds.has(id));
  if (removedIds.length > 0) {
    const [used] = await tx
      .select({ id: poLines.id })
      .from(poLines)
      .where(inArray(poLines.boqLineId, removedIds))
      .limit(1);
    if (used) {
      throw new DomainError(
        'BOQ_LINE_IN_USE',
        'มีรายการ BOQ ที่ถูกอ้างอิงในใบสั่งซื้อแล้ว จึงลบไม่ได้ (แก้ไขจำนวนหรือราคาแทน)',
        409,
      );
    }
    await tx.delete(boqLines).where(inArray(boqLines.id, removedIds));
  }

  for (const [i, l] of data.lines.entries()) {
    const values = {
      sort: i,
      isCategory: l.isCategory,
      isBold: l.isBold,
      no: l.no,
      description: l.description,
      qty: l.isCategory ? null : fromAmount(l.qty, 3),
      unit: l.isCategory ? '' : l.unit,
      materialRate: l.isCategory ? null : fromAmount(l.materialRate, 2),
      laborRate: l.isCategory ? null : fromAmount(l.laborRate, 2),
      note: l.note,
    };
    if (l.id && keptIds.has(l.id)) {
      await tx.update(boqLines).set(values).where(eq(boqLines.id, l.id));
    } else {
      await tx.insert(boqLines).values({ ...values, boqId: boq.id });
    }
  }

  await logActivity(tx, {
    entityType: 'BOQ',
    entityId: boq.id,
    action: existing ? 'UPDATE' : 'CREATE',
    userId: actor.id,
    data: { lines: data.lines.length, grandTotal: totals.grandTotal.toFixed(2) },
  });

  return boq;
}
