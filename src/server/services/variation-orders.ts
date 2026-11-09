import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { boqLines, boqs, projects, projectTasks, users, variationOrders, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, type Decimal } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import {
  VO_PRIORITIES,
  VO_TYPES,
  VO_TYPE_LABELS,
  isVoEditable,
  revisedEndDate,
  summarizeContract,
  voCostImpact,
  voDaysImpact,
  voTypeAllows,
  type VoPriority,
  type VoStatus,
  type VoType,
} from '@/domain/variation-order';
import { assertCan, can } from '@/server/policy';
import { logActivity } from './activity';
import { assertNoConflict, parseBoqInput, toDto, writeBoqDocument, type BoqDocumentDto, type SaveBoqInput } from './boq';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';

export interface VoDto {
  id: string;
  number: string;
  title: string;
  description: string;
  voType: VoType;
  typeLabel: string;
  requestDate: string;
  requestedByName: string;
  addAmount: number;
  deductAmount: number;
  deductNote: string;
  netAmount: number;
  vatPercent: number;
  netWithVat: number;
  daysImpact: number;
  status: VoStatus;
  decisionNote: string;
  boqNumber: string | null;
  boqLineCount: number;
}

export interface VoFormOptions {
  users: { id: string; name: string }[];
  tasks: { id: string; title: string }[];
}

export interface ProjectVoList {
  project: { id: string; code: string; name: string; endDate: string | null };
  contract: {
    original: number;
    approvedAdd: number;
    approvedDeduct: number;
    current: number;
    pendingCount: number;
    extensionDays: number;
    revisedEndDate: string | null;
  };
  vos: VoDto[];
  options: VoFormOptions;
  canManage: boolean;
  canApprove: boolean;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const MAX_AMOUNT = 10_000_000_000_000;
const amount = (msg: string) => z.number().finite().min(0, msg).max(MAX_AMOUNT).default(0);
const days = z.number().int('จำนวนวันต้องเป็นจำนวนเต็ม').min(0, 'จำนวนวันต้องไม่ติดลบ').max(3650).default(0);

const voSchema = z
  .object({
    title: z.string().trim().min(1, 'กรุณาระบุชื่อรายการ').max(300),
    voType: z.enum(VO_TYPES).default('ADD'),
    requestDate: isoDate.optional(),
    requesterName: z.string().trim().max(200).default(''),
    responsibleUserId: z.string().uuid().nullable().default(null),
    workArea: z.string().trim().max(300).default(''),
    priority: z.enum(VO_PRIORITIES).default('NORMAL'),
    description: z.string().trim().min(1, 'กรุณาระบุรายละเอียด').max(5000),
    changeReason: z.string().trim().max(2000).default(''),
    originalAmount: amount('มูลค่างานเดิมต้องไม่ติดลบ'),
    /** Used only while the VO BOQ has no item lines; otherwise the BOQ total wins */
    addAmount: amount('มูลค่างานเพิ่มต้องไม่ติดลบ'),
    deductAmount: amount('มูลค่างานลดต้องไม่ติดลบ'),
    deductNote: z.string().trim().max(1000).default(''),
    vatPercent: z.number().finite().min(0, 'VAT ต้องอยู่ระหว่าง 0-100').max(100, 'VAT ต้องอยู่ระหว่าง 0-100').default(7),
    costCode: z.string().trim().max(100).default(''),
    costCategory: z.string().trim().max(200).default(''),
    costNote: z.string().trim().max(2000).default(''),
    scheduleImpact: z.boolean().default(false),
    daysAdded: days,
    daysReduced: days,
    impactStartDate: isoDate.nullable().default(null),
    impactEndDate: isoDate.nullable().default(null),
    criticalPath: z.boolean().default(false),
    affectedTaskId: z.string().uuid().nullable().default(null),
    affectedActivity: z.string().trim().max(300, 'กิจกรรมที่ได้รับผลกระทบยาวเกิน 300 ตัวอักษร').default(''),
    timeReason: z.string().trim().max(2000).default(''),
  })
  .refine((v) => !v.impactStartDate || !v.impactEndDate || v.impactEndDate >= v.impactStartDate, {
    message: 'วันที่สิ้นสุดคาดการณ์ต้องไม่ก่อนวันที่เริ่มกระทบ',
  });

export type VoInput = z.input<typeof voSchema>;
type VoData = z.output<typeof voSchema>;

/** Full VO form as loaded into the editor dialog. */
export interface VoDocumentDto {
  id: string;
  projectId: string;
  number: string;
  status: VoStatus;
  decisionNote: string;
  input: Required<Omit<VoInput, 'requestDate'>> & { requestDate: string };
  boq: BoqDocumentDto | null;
  canEdit: boolean;
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_VO', r.error.issues[0].message);
  return r.data;
}

async function loadProject(db: Db, projectId: string) {
  if (!z.string().uuid().safeParse(projectId).success) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  return p;
}

async function loadVo(db: Db, voId: string, lock = false) {
  if (!z.string().uuid().safeParse(voId).success) throw new DomainError('NOT_FOUND', 'ไม่พบ VO', 404);
  const q = db.select().from(variationOrders).where(eq(variationOrders.id, voId));
  const [vo] = lock ? await q.for('update') : await q.limit(1);
  if (!vo) throw new DomainError('NOT_FOUND', 'ไม่พบ VO', 404);
  return vo;
}

function assertEditable(status: VoStatus) {
  if (!isVoEditable(status)) {
    throw new DomainError('VO_LOCKED', 'แก้ไขได้เฉพาะ VO ที่เป็นร่างหรือถูกตีกลับ', 409);
  }
}

export async function listProjectVos(db: Db, actor: SessionUser, projectId: string): Promise<ProjectVoList> {
  const project = await loadProject(db, projectId);
  assertCan(actor, 'project.view', { projectId });

  const rows = await db
    .select({ vo: variationOrders, requestedByName: users.name })
    .from(variationOrders)
    .innerJoin(users, eq(users.id, variationOrders.requestedBy))
    .where(eq(variationOrders.projectId, projectId))
    .orderBy(desc(variationOrders.requestDate), desc(variationOrders.createdAt));

  const voIds = rows.map((r) => r.vo.id);
  const boqRows = voIds.length
    ? await db
        .select({
          voId: boqs.voId,
          number: boqs.number,
          // Qualified explicitly: an unqualified id would bind to boq_lines inside the subquery
          lineCount: sql<number>`(select count(*)::int from boq_lines bl where bl.boq_id = "boqs"."id" and bl.is_category = false)`,
        })
        .from(boqs)
        .where(inArray(boqs.voId, voIds))
    : [];
  const boqByVo = new Map(boqRows.map((b) => [b.voId, b]));

  const contract = summarizeContract(project.budget, rows.map((r) => r.vo));
  const [userOptions, taskOptions] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
    db
      .select({ id: projectTasks.id, title: projectTasks.title })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId))
      .orderBy(asc(projectTasks.sort)),
  ]);
  return {
    project: { id: project.id, code: project.code, name: project.name, endDate: project.endDate },
    contract: {
      original: contract.original.toNumber(),
      approvedAdd: contract.approvedAdd.toNumber(),
      approvedDeduct: contract.approvedDeduct.toNumber(),
      current: contract.current.toNumber(),
      pendingCount: contract.pendingCount,
      extensionDays: contract.extensionDays,
      revisedEndDate: revisedEndDate(project.endDate, contract.extensionDays),
    },
    vos: rows.map(({ vo, requestedByName }) => {
      const cost = voCostImpact(vo.addAmount, vo.deductAmount, vo.vatPercent);
      return {
        id: vo.id,
        number: vo.number,
        title: vo.title,
        description: vo.description,
        voType: vo.voType,
        typeLabel: VO_TYPE_LABELS[vo.voType],
        requestDate: vo.requestDate,
        requestedByName,
        addAmount: Number(vo.addAmount),
        deductAmount: Number(vo.deductAmount),
        deductNote: vo.deductNote,
        netAmount: cost.net.toNumber(),
        vatPercent: Number(vo.vatPercent),
        netWithVat: cost.netWithVat.toNumber(),
        daysImpact: vo.daysImpact,
        status: vo.status,
        decisionNote: vo.decisionNote,
        boqNumber: boqByVo.get(vo.id)?.number ?? null,
        boqLineCount: boqByVo.get(vo.id)?.lineCount ?? 0,
      };
    }),
    options: { users: userOptions, tasks: taskOptions },
    canManage: can(actor, 'vo.manage', { projectId }),
    canApprove: can(actor, 'vo.approve', { projectId }),
  };
}

/** Rejects references the form could not have offered: unknown users or another project's tasks. */
async function assertVoReferences(tx: Db, projectId: string, data: VoData) {
  if (data.responsibleUserId) {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, data.responsibleUserId)).limit(1);
    if (!u) throw new DomainError('INVALID_VO', 'ไม่พบผู้รับผิดชอบที่เลือก');
  }
  if (data.affectedTaskId) {
    const [t] = await tx
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(and(eq(projectTasks.id, data.affectedTaskId), eq(projectTasks.projectId, projectId)))
      .limit(1);
    if (!t) throw new DomainError('INVALID_VO', 'กิจกรรมที่เลือกไม่อยู่ในโครงการนี้');
  }
}

function hasBoqItems(boq: { lines: { isCategory: boolean }[] } | null): boolean {
  return !!boq && boq.lines.some((l) => !l.isCategory);
}

/** Enforces the VO type against the amounts: งานเพิ่ม cannot deduct, งานลด cannot add work. */
function assertTypeAmounts(type: VoType, add: Decimal.Value, deduct: Decimal.Value) {
  const allows = voTypeAllows(type);
  if (!allows.add && D(add).gt(0)) {
    throw new DomainError('INVALID_VO', 'VO ประเภทงานลดต้องไม่มีมูลค่างานเพิ่มหรือรายการ BOQ');
  }
  if (!allows.deduct && D(deduct).gt(0)) {
    throw new DomainError('INVALID_VO', 'VO ประเภทงานเพิ่มต้องไม่มีมูลค่างานลด (เลือกประเภทงานเพิ่ม-ลด)');
  }
}

function headerValues(data: VoData, addAmount: Decimal.Value) {
  const schedule = data.scheduleImpact;
  return {
    title: data.title,
    voType: data.voType,
    requesterName: data.requesterName,
    responsibleUserId: data.responsibleUserId,
    workArea: data.workArea,
    priority: data.priority,
    description: data.description,
    changeReason: data.changeReason,
    originalAmount: D(data.originalAmount).toFixed(2),
    addAmount: D(addAmount).toFixed(2),
    deductAmount: D(data.deductAmount).toFixed(2),
    deductNote: data.deductNote,
    vatPercent: D(data.vatPercent).toFixed(2),
    costCode: data.costCode,
    costCategory: data.costCategory,
    costNote: data.costNote,
    // Schedule details only mean something when the VO is marked as affecting the plan
    scheduleImpact: schedule,
    daysAdded: schedule ? data.daysAdded : 0,
    daysReduced: schedule ? data.daysReduced : 0,
    daysImpact: voDaysImpact(schedule, data.daysAdded, data.daysReduced),
    impactStartDate: schedule ? data.impactStartDate : null,
    impactEndDate: schedule ? data.impactEndDate : null,
    criticalPath: schedule && data.criticalPath,
    affectedTaskId: schedule ? data.affectedTaskId : null,
    affectedActivity: schedule ? data.affectedActivity : '',
    timeReason: data.timeReason,
  };
}

/**
 * Creates (voId = null) or updates a VO together with its BOQ in one transaction, so the
 * header amounts and the BOQ can never disagree. `boq` = null leaves any saved BOQ untouched;
 * its VAT % always follows the VO's.
 */
export async function saveVoDocument(
  db: Db,
  actor: SessionUser,
  projectId: string,
  voId: string | null,
  input: { vo: VoInput; boq: SaveBoqInput | null },
): Promise<{ id: string; number: string }> {
  await loadProject(db, projectId);
  assertCan(actor, 'vo.manage', { projectId });
  const data = parse(voSchema, input.vo);
  const boqInput = input.boq ? parseBoqInput({ ...input.boq, vatPercent: data.vatPercent }) : null;

  return db.transaction(async (tx) => {
    let vo: typeof variationOrders.$inferSelect | null = null;
    if (voId) {
      // Row lock: the VO cannot be submitted or approved while it is being rewritten
      vo = await loadVo(tx, voId, true);
      if (vo.projectId !== projectId) throw new DomainError('NOT_FOUND', 'ไม่พบ VO', 404);
      assertEditable(vo.status);
    }
    await assertVoReferences(tx, projectId, data);

    const [existingBoq] = vo ? await tx.select().from(boqs).where(eq(boqs.voId, vo.id)).limit(1) : [];
    // A BOQ with item lines prices the added work; without one the entered amount is used.
    // When this save carries no BOQ, an already-saved BOQ keeps its total.
    let addAmount = D(data.addAmount);
    if (boqInput) {
      if (hasBoqItems(boqInput.data)) addAmount = boqInput.totals.afterDiscount;
    } else if (vo && existingBoq && (await voBoqHasItems(tx, existingBoq.id))) {
      addAmount = D(vo.addAmount);
    }
    assertTypeAmounts(data.voType, addAmount, data.deductAmount);

    const values = { ...headerValues(data, addAmount), ...(data.requestDate ? { requestDate: data.requestDate } : {}) };
    let saved: typeof variationOrders.$inferSelect;
    if (vo) {
      [saved] = await tx
        .update(variationOrders)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(variationOrders.id, vo.id))
        .returning();
    } else {
      const number = await nextDocNumber(tx, 'VO');
      [saved] = await tx
        .insert(variationOrders)
        .values({ ...values, projectId, number, requestDate: data.requestDate ?? bangkokDateString(), requestedBy: actor.id })
        .returning();
    }

    if (boqInput && (existingBoq || boqInput.data.lines.length > 0)) {
      assertNoConflict(existingBoq ?? null, boqInput.data.baseUpdatedAt);
      await writeBoqDocument(tx, actor, existingBoq ?? null, { projectId, kind: 'VO', voId: saved.id }, boqInput.data, boqInput.totals);
    }
    await logActivity(tx, { entityType: 'VO', entityId: saved.id, action: vo ? 'UPDATE' : 'CREATE', userId: actor.id });
    return { id: saved.id, number: saved.number };
  });
}

async function voBoqHasItems(tx: Db, boqId: string): Promise<boolean> {
  const [item] = await tx
    .select({ id: boqLines.id })
    .from(boqLines)
    .where(and(eq(boqLines.boqId, boqId), eq(boqLines.isCategory, false)))
    .limit(1);
  return !!item;
}

export async function createVo(
  db: Db,
  actor: SessionUser,
  projectId: string,
  input: VoInput,
): Promise<{ id: string; number: string }> {
  return saveVoDocument(db, actor, projectId, null, { vo: input, boq: null });
}

export async function updateVo(db: Db, actor: SessionUser, voId: string, input: VoInput): Promise<void> {
  const vo = await loadVo(db, voId);
  await saveVoDocument(db, actor, vo.projectId, voId, { vo: input, boq: null });
}

export async function getVoDocument(db: Db, actor: SessionUser, voId: string): Promise<VoDocumentDto> {
  const vo = await loadVo(db, voId);
  assertCan(actor, 'project.view', { projectId: vo.projectId });
  const [boq] = await db.select().from(boqs).where(eq(boqs.voId, voId)).limit(1);
  return {
    id: vo.id,
    projectId: vo.projectId,
    number: vo.number,
    status: vo.status,
    decisionNote: vo.decisionNote,
    input: {
      title: vo.title,
      voType: vo.voType,
      requestDate: vo.requestDate,
      requesterName: vo.requesterName,
      responsibleUserId: vo.responsibleUserId,
      workArea: vo.workArea,
      priority: vo.priority as VoPriority,
      description: vo.description,
      changeReason: vo.changeReason,
      originalAmount: Number(vo.originalAmount),
      addAmount: Number(vo.addAmount),
      deductAmount: Number(vo.deductAmount),
      deductNote: vo.deductNote,
      vatPercent: Number(vo.vatPercent),
      costCode: vo.costCode,
      costCategory: vo.costCategory,
      costNote: vo.costNote,
      scheduleImpact: vo.scheduleImpact,
      daysAdded: vo.daysAdded,
      daysReduced: vo.daysReduced,
      impactStartDate: vo.impactStartDate,
      impactEndDate: vo.impactEndDate,
      criticalPath: vo.criticalPath,
      affectedTaskId: vo.affectedTaskId,
      affectedActivity: vo.affectedActivity,
      timeReason: vo.timeReason,
    },
    boq: boq ? await toDto(db, boq) : null,
    canEdit: can(actor, 'vo.manage', { projectId: vo.projectId }) && isVoEditable(vo.status),
  };
}

export interface VoBoqSheet {
  vo: { id: string; number: string; title: string; status: VoStatus };
  project: { id: string; code: string; name: string };
  boq: BoqDocumentDto | null;
  canEdit: boolean;
}

export async function getVoBoqSheet(db: Db, actor: SessionUser, voId: string): Promise<VoBoqSheet> {
  const vo = await loadVo(db, voId);
  const project = await loadProject(db, vo.projectId);
  assertCan(actor, 'project.view', { projectId: vo.projectId });
  const [boq] = await db.select().from(boqs).where(eq(boqs.voId, voId)).limit(1);
  return {
    vo: { id: vo.id, number: vo.number, title: vo.title, status: vo.status },
    project: { id: project.id, code: project.code, name: project.name },
    boq: boq ? await toDto(db, boq) : null,
    canEdit: can(actor, 'vo.manage', { projectId: vo.projectId }) && isVoEditable(vo.status),
  };
}

/**
 * Saves the VO's BOQ from the BOQ tab. A BOQ with item lines sets the VO's add amount to its
 * after-discount (before-VAT) total, and the BOQ's VAT % becomes the VO's.
 */
export async function saveVoBoq(
  db: Db,
  actor: SessionUser,
  voId: string,
  input: SaveBoqInput,
): Promise<BoqDocumentDto> {
  const { data, totals } = parseBoqInput(input);
  const saved = await db.transaction(async (tx) => {
    // Row lock: the VO cannot be submitted or approved while its BOQ is being written
    const vo = await loadVo(tx, voId, true);
    assertCan(actor, 'vo.manage', { projectId: vo.projectId });
    assertEditable(vo.status);
    const [existing] = await tx.select().from(boqs).where(eq(boqs.voId, voId)).limit(1);
    assertNoConflict(existing ?? null, data.baseUpdatedAt);
    const addAmount = hasBoqItems(data) ? totals.afterDiscount : D(vo.addAmount);
    assertTypeAmounts(vo.voType, addAmount, vo.deductAmount);
    const boq = await writeBoqDocument(
      tx,
      actor,
      existing ?? null,
      { projectId: vo.projectId, kind: 'VO', voId },
      data,
      totals,
    );
    await tx
      .update(variationOrders)
      .set({ addAmount: addAmount.toFixed(2), vatPercent: D(data.vatPercent).toFixed(2), updatedAt: new Date() })
      .where(eq(variationOrders.id, voId));
    return boq;
  });
  return toDto(db, saved);
}

export async function submitVo(db: Db, actor: SessionUser, voId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const vo = await loadVo(tx, voId, true);
    assertCan(actor, 'vo.manage', { projectId: vo.projectId });
    assertEditable(vo.status);
    if (D(vo.addAmount).lte(0) && D(vo.deductAmount).lte(0) && vo.daysImpact === 0) {
      throw new DomainError('EMPTY_VO', 'VO ต้องมีงานเพิ่ม (BOQ) งานลด หรือวันกระทบอย่างน้อยหนึ่งอย่าง');
    }
    await tx
      .update(variationOrders)
      .set({ status: 'PENDING', submittedAt: new Date(), decisionNote: '', updatedAt: new Date() })
      .where(eq(variationOrders.id, voId));
    await logActivity(tx, { entityType: 'VO', entityId: voId, action: 'SUBMIT', userId: actor.id });
    const owners = await usersWithRole(tx, ['OWNER']);
    await notify(tx, owners, {
      title: `${vo.number} งานเพิ่ม-ลดรออนุมัติ`,
      href: `/projects/${vo.projectId}?tab=vo`,
      category: 'PROJECT',
      projectId: vo.projectId,
    });
  });
}

export async function decideVo(
  db: Db,
  actor: SessionUser,
  voId: string,
  approve: boolean,
  noteInput: string,
): Promise<void> {
  const note = noteInput.trim().slice(0, 1000);
  if (!approve && !note) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  await db.transaction(async (tx) => {
    const vo = await loadVo(tx, voId, true);
    assertCan(actor, 'vo.approve', { projectId: vo.projectId });
    if (vo.status !== 'PENDING') throw new DomainError('INVALID_STATE', 'VO นี้ไม่ได้อยู่ในสถานะรออนุมัติ', 409);
    await tx
      .update(variationOrders)
      .set({
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedBy: actor.id,
        decidedAt: new Date(),
        decisionNote: note,
        updatedAt: new Date(),
      })
      .where(eq(variationOrders.id, voId));
    await logActivity(tx, {
      entityType: 'VO',
      entityId: voId,
      action: approve ? 'APPROVE' : 'REJECT',
      userId: actor.id,
      note: note || undefined,
    });
    await notify(tx, [vo.requestedBy], {
      title: `${vo.number} ${approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`,
      href: `/projects/${vo.projectId}?tab=vo`,
      category: 'PROJECT',
      projectId: vo.projectId,
    });
  });
}

/** Approved VOs already changed the contract and are kept; anything else can be withdrawn. */
export async function cancelVo(db: Db, actor: SessionUser, voId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const vo = await loadVo(tx, voId, true);
    assertCan(actor, 'vo.manage', { projectId: vo.projectId });
    if (vo.status === 'APPROVED' || vo.status === 'CANCELLED') {
      throw new DomainError('VO_LOCKED', 'ยกเลิก VO ที่อนุมัติหรือยกเลิกแล้วไม่ได้', 409);
    }
    await tx
      .update(variationOrders)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(variationOrders.id, voId));
    await logActivity(tx, { entityType: 'VO', entityId: voId, action: 'CANCEL', userId: actor.id });
  });
}
