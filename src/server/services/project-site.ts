import { and, asc, count, desc, eq, gte, inArray, lte, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  attachments,
  comments,
  dailyReports,
  projectEvents,
  projectMembers,
  projects,
  projectTasks,
  userRoles,
  users,
  type DailyEquipmentLine,
  type DailyLabourLine,
  type DailyReportStatus,
  type DailyWeather,
  type DailyWorkLine,
  type Role,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can } from '@/server/policy';
import { logActivity } from './activity';
import { listAttachments } from './attachments';
import { notify } from './notifications';
import { nextDocNumber } from './numbering';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'รูปแบบเวลาไม่ถูกต้อง');

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_INPUT', r.error.issues[0].message);
  return r.data;
}

async function assertProject(db: Db, actor: SessionUser, projectId: string) {
  if (!uuid.safeParse(projectId).success) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  const [p] = await db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  assertCan(actor, 'project.view', { projectId });
  return p;
}

/** Header numbers for the workspace (caller has already checked project access). */
export async function countProjectSite(db: Db, projectId: string) {
  const [[team], [photos]] = await Promise.all([
    db.select({ n: count() }).from(projectMembers).where(eq(projectMembers.projectId, projectId)),
    db
      .select({ n: count() })
      .from(attachments)
      .where(and(eq(attachments.entityType, 'PROJECT'), eq(attachments.entityId, projectId), eq(attachments.kind, 'PHOTO'))),
  ]);
  return { team: Number(team?.n ?? 0), photos: Number(photos?.n ?? 0) };
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export interface TeamMemberDto {
  userId: string;
  name: string;
  email: string;
  roles: Role[];
  openTasks: number;
}

export async function getProjectTeam(db: Db, actor: SessionUser, projectId: string) {
  await assertProject(db, actor, projectId);
  const memberRows = await db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.name));
  const ids = memberRows.map((m) => m.userId);
  const [roleRows, taskRows] = await Promise.all([
    ids.length ? db.select().from(userRoles).where(inArray(userRoles.userId, ids)) : Promise.resolve([]),
    ids.length
      ? db
          .select({ assigneeId: projectTasks.assigneeId, n: count() })
          .from(projectTasks)
          .where(and(eq(projectTasks.projectId, projectId), inArray(projectTasks.assigneeId, ids), notInArray(projectTasks.status, ['DONE', 'REJECTED'])))
          .groupBy(projectTasks.assigneeId)
      : Promise.resolve([]),
  ]);
  const members: TeamMemberDto[] = memberRows.map((m) => ({
    ...m,
    roles: roleRows.filter((r) => r.userId === m.userId).map((r) => r.role),
    openTasks: Number(taskRows.find((t) => t.assigneeId === m.userId)?.n ?? 0),
  }));
  const canManage = can(actor, 'project.manage', { projectId });
  const candidates = canManage
    ? (
        await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(and(eq(users.active, true), ids.length ? notInArray(users.id, ids) : undefined))
          .orderBy(asc(users.name))
      )
    : [];
  return { members, candidates, canManage };
}

export async function addProjectMember(db: Db, actor: SessionUser, projectId: string, userId: string) {
  const project = await assertProject(db, actor, projectId);
  assertCan(actor, 'project.manage', { projectId });
  if (!uuid.safeParse(userId).success) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ใช้งาน', 404);
  const [u] = await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.active) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ใช้งาน', 404);
  await db.insert(projectMembers).values({ projectId, userId }).onConflictDoNothing();
  await notify(db, [userId], { title: `คุณได้รับมอบหมายให้อยู่ในทีมโครงการ ${project.code}`, href: `/projects/${projectId}` });
}

export async function removeProjectMember(db: Db, actor: SessionUser, projectId: string, userId: string) {
  await assertProject(db, actor, projectId);
  assertCan(actor, 'project.manage', { projectId });
  await db.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

// ---------------------------------------------------------------------------
// Documents & photos (attachments on the PROJECT entity)
// ---------------------------------------------------------------------------

export const DOCUMENT_FOLDERS = [
  'เอกสารก่อนเริ่มโครงการ',
  'แบบก่อสร้าง',
  'เอกสารระหว่างดำเนินงาน',
  'เอกสารตรวจงาน',
  'เอกสารอนุมัติ',
  'เอกสารการเงิน',
  'เอกสารส่งมอบและปิดโครงการ',
] as const;

export interface ProjectFileDto {
  id: string;
  url: string;
  name: string;
  size: number;
  contentType: string;
  folder: string;
  uploaderName: string;
  uploadedBy: string;
  createdAt: Date;
  /** 1 = first upload of this name in this folder */
  version: number;
  /** false for older versions of the same document */
  latest: boolean;
}

export async function listProjectFiles(db: Db, actor: SessionUser, projectId: string, kind: 'FILE' | 'PHOTO'): Promise<ProjectFileDto[]> {
  await assertProject(db, actor, projectId);
  const rows = await listAttachments(db, 'PROJECT', projectId, kind);
  // Same name in the same folder = new version of one document
  const oldestFirst = [...rows].reverse();
  const seen = new Map<string, number>();
  const versioned = oldestFirst.map((r) => {
    const key = `${r.folder}\u0000${r.name.toLowerCase()}`;
    const v = (seen.get(key) ?? 0) + 1;
    seen.set(key, v);
    return { ...r, version: v, key };
  });
  return versioned
    .map(({ key, ...r }) => ({ ...r, latest: seen.get(key) === r.version }))
    .reverse();
}

// ---------------------------------------------------------------------------
// Chat (comments on the PROJECT entity)
// ---------------------------------------------------------------------------

export interface ChatMessageDto {
  id: string;
  body: string;
  userId: string;
  userName: string;
  createdAt: Date;
}

export async function listProjectChat(db: Db, actor: SessionUser, projectId: string, limit = 200): Promise<ChatMessageDto[]> {
  await assertProject(db, actor, projectId);
  const rows = await db
    .select({ id: comments.id, body: comments.body, userId: comments.userId, userName: users.name, createdAt: comments.createdAt })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(and(eq(comments.entityType, 'PROJECT'), eq(comments.entityId, projectId)))
    .orderBy(desc(comments.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.reverse();
}

export async function postProjectChat(db: Db, actor: SessionUser, projectId: string, bodyInput: string) {
  await assertProject(db, actor, projectId);
  const body = bodyInput.trim().slice(0, 4000);
  if (!body) throw new DomainError('INVALID_INPUT', 'กรุณาพิมพ์ข้อความ');
  const [msg] = await db.insert(comments).values({ entityType: 'PROJECT', entityId: projectId, userId: actor.id, body }).returning();
  return msg;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'กรุณาระบุหัวข้อนัดหมาย').max(200),
    eventDate: isoDate,
    startTime: hhmm.nullable().default(null),
    endTime: hhmm.nullable().default(null),
    note: z.string().trim().max(1000).default(''),
  })
  .refine((e) => !e.startTime || !e.endTime || e.endTime >= e.startTime, { message: 'เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม' });
export type ProjectEventInput = z.input<typeof eventSchema>;

export interface CalendarItemDto {
  id: string;
  kind: 'EVENT' | 'TASK_START' | 'TASK_DUE';
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  note: string;
  canDelete: boolean;
}

/** Appointments plus task start/due dates, for one inclusive date range. */
export async function listProjectCalendar(db: Db, actor: SessionUser, projectId: string, from: string, to: string): Promise<CalendarItemDto[]> {
  await assertProject(db, actor, projectId);
  parse(isoDate, from);
  parse(isoDate, to);
  const canManage = can(actor, 'project.manage', { projectId });
  const [events, tasks] = await Promise.all([
    db
      .select()
      .from(projectEvents)
      .where(and(eq(projectEvents.projectId, projectId), gte(projectEvents.eventDate, from), lte(projectEvents.eventDate, to)))
      .orderBy(asc(projectEvents.eventDate), asc(projectEvents.startTime)),
    db.select({ id: projectTasks.id, title: projectTasks.title, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate }).from(projectTasks).where(eq(projectTasks.projectId, projectId)),
  ]);
  const items: CalendarItemDto[] = events.map((e) => ({
    id: e.id,
    kind: 'EVENT',
    title: e.title,
    date: e.eventDate,
    startTime: e.startTime?.slice(0, 5) ?? null,
    endTime: e.endTime?.slice(0, 5) ?? null,
    note: e.note,
    canDelete: e.createdBy === actor.id || canManage,
  }));
  for (const t of tasks) {
    if (t.startDate && t.startDate >= from && t.startDate <= to) {
      items.push({ id: `${t.id}-s`, kind: 'TASK_START', title: `เริ่ม: ${t.title}`, date: t.startDate, startTime: null, endTime: null, note: '', canDelete: false });
    }
    if (t.dueDate && t.dueDate >= from && t.dueDate <= to) {
      items.push({ id: `${t.id}-d`, kind: 'TASK_DUE', title: `กำหนดส่ง: ${t.title}`, date: t.dueDate, startTime: null, endTime: null, note: '', canDelete: false });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

export async function createProjectEvent(db: Db, actor: SessionUser, projectId: string, input: ProjectEventInput) {
  await assertProject(db, actor, projectId);
  const data = parse(eventSchema, input);
  const [row] = await db.insert(projectEvents).values({ ...data, projectId, createdBy: actor.id }).returning();
  return row;
}

export async function deleteProjectEvent(db: Db, actor: SessionUser, eventId: string) {
  if (!uuid.safeParse(eventId).success) throw new DomainError('NOT_FOUND', 'ไม่พบนัดหมาย', 404);
  const [e] = await db.select().from(projectEvents).where(eq(projectEvents.id, eventId)).limit(1);
  if (!e) throw new DomainError('NOT_FOUND', 'ไม่พบนัดหมาย', 404);
  assertCan(actor, 'project.view', { projectId: e.projectId });
  if (e.createdBy !== actor.id && !can(actor, 'project.manage', { projectId: e.projectId })) {
    throw new DomainError('FORBIDDEN', 'ลบได้เฉพาะผู้สร้างหรือผู้ดูแลโครงการ', 403);
  }
  await db.delete(projectEvents).where(eq(projectEvents.id, eventId));
}

// ---------------------------------------------------------------------------
// Daily reports
// ---------------------------------------------------------------------------

export const WEATHER_LABELS: Record<DailyWeather, string> = {
  SUNNY: 'แดด',
  CLOUDY: 'เมฆครึ้ม',
  RAIN: 'ฝนตก',
  HEAVY_RAIN: 'ฝนตกหนัก',
  OTHER: 'อื่นๆ',
};
const WEATHERS = Object.keys(WEATHER_LABELS) as [DailyWeather, ...DailyWeather[]];

const dailySchema = z.object({
  reportDate: isoDate,
  startTime: hhmm.nullable().default(null),
  endTime: hhmm.nullable().default(null),
  weatherMorning: z.enum(WEATHERS).default('SUNNY'),
  weatherAfternoon: z.enum(WEATHERS).default('SUNNY'),
  scheduleImpact: z.boolean().default(false),
  work: z
    .array(
      z.object({
        taskId: uuid.nullable().default(null),
        description: z.string().trim().max(500).default(''),
        progressPercent: z.number().finite().min(0).max(100).nullable().default(null),
        note: z.string().trim().max(500).default(''),
      }),
    )
    .max(50)
    .default([]),
  labour: z
    .array(
      z.object({
        company: z.string().trim().max(200),
        workers: z.number().int().min(0).max(10000),
        hours: z.number().finite().min(0).max(24),
      }),
    )
    .max(50)
    .default([]),
  equipment: z
    .array(z.object({ type: z.string().trim().max(200), hours: z.number().finite().min(0).max(24) }))
    .max(50)
    .default([]),
  accident: z.boolean().default(false),
  safetyNote: z.string().trim().max(2000).default(''),
  visitors: z.string().trim().max(1000).default(''),
  issues: z.string().trim().max(3000).default(''),
  summary: z.string().trim().max(3000).default(''),
});
export type DailyReportInput = z.input<typeof dailySchema>;

export interface DailyReportListDto {
  id: string;
  number: string;
  reportDate: string;
  status: DailyReportStatus;
  weatherMorning: DailyWeather;
  weatherAfternoon: DailyWeather;
  workers: number;
  accident: boolean;
  summary: string;
  createdByName: string;
  photoCount: number;
}

function cleanReport(data: z.output<typeof dailySchema>) {
  // Blank lines from the form are dropped rather than stored
  return {
    ...data,
    work: data.work.filter((w) => w.taskId || w.description) as DailyWorkLine[],
    labour: data.labour.filter((l) => l.company || l.workers > 0) as DailyLabourLine[],
    equipment: data.equipment.filter((e) => e.type) as DailyEquipmentLine[],
  };
}

async function assertTasksInProject(db: Db, projectId: string, work: DailyWorkLine[]) {
  const ids = [...new Set(work.map((w) => w.taskId).filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const found = await db.select({ id: projectTasks.id }).from(projectTasks).where(and(eq(projectTasks.projectId, projectId), inArray(projectTasks.id, ids)));
  if (found.length !== ids.length) throw new DomainError('INVALID_INPUT', 'งานที่เลือกไม่อยู่ในโครงการนี้');
}

export async function listDailyReports(db: Db, actor: SessionUser, projectId: string): Promise<DailyReportListDto[]> {
  await assertProject(db, actor, projectId);
  const rows = await db
    .select({ r: dailyReports, createdByName: users.name })
    .from(dailyReports)
    .innerJoin(users, eq(users.id, dailyReports.createdBy))
    .where(eq(dailyReports.projectId, projectId))
    .orderBy(desc(dailyReports.reportDate), desc(dailyReports.createdAt));
  const ids = rows.map((r) => r.r.id);
  const photoCounts = ids.length
    ? await db
        .select({ entityId: attachments.entityId, n: count() })
        .from(attachments)
        .where(and(eq(attachments.entityType, 'DAILY_REPORT'), inArray(attachments.entityId, ids)))
        .groupBy(attachments.entityId)
    : [];
  return rows.map(({ r, createdByName }) => ({
    id: r.id,
    number: r.number,
    reportDate: r.reportDate,
    status: r.status,
    weatherMorning: r.weatherMorning,
    weatherAfternoon: r.weatherAfternoon,
    workers: r.labour.reduce((s, l) => s + (l.workers || 0), 0),
    accident: r.accident,
    summary: r.summary || r.work.map((w) => w.description).filter(Boolean).join(', '),
    createdByName,
    photoCount: Number(photoCounts.find((p) => p.entityId === r.id)?.n ?? 0),
  }));
}

export async function getDailyReport(db: Db, actor: SessionUser, reportId: string) {
  if (!uuid.safeParse(reportId).success) throw new DomainError('NOT_FOUND', 'ไม่พบรายงาน', 404);
  const [row] = await db
    .select({ r: dailyReports, createdByName: users.name })
    .from(dailyReports)
    .innerJoin(users, eq(users.id, dailyReports.createdBy))
    .where(eq(dailyReports.id, reportId))
    .limit(1);
  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบรายงาน', 404);
  assertCan(actor, 'project.view', { projectId: row.r.projectId });
  const photos = await listAttachments(db, 'DAILY_REPORT', reportId);
  return {
    ...row.r,
    createdByName: row.createdByName,
    startTime: row.r.startTime?.slice(0, 5) ?? null,
    endTime: row.r.endTime?.slice(0, 5) ?? null,
    photos,
    canEdit: row.r.status === 'DRAFT' && (row.r.createdBy === actor.id || can(actor, 'project.manage', { projectId: row.r.projectId })),
  };
}

export async function saveDailyReport(
  db: Db,
  actor: SessionUser,
  projectId: string,
  reportId: string | null,
  input: DailyReportInput,
): Promise<{ id: string; number: string }> {
  const project = await assertProject(db, actor, projectId);
  const data = cleanReport(parse(dailySchema, input));
  if (data.reportDate > bangkokDateString()) throw new DomainError('INVALID_INPUT', 'วันที่รายงานต้องไม่เกินวันนี้');
  await assertTasksInProject(db, projectId, data.work);

  return db.transaction(async (tx) => {
    if (reportId) {
      const [r] = await tx.select().from(dailyReports).where(eq(dailyReports.id, reportId)).for('update');
      if (!r || r.projectId !== projectId) throw new DomainError('NOT_FOUND', 'ไม่พบรายงาน', 404);
      if (r.status !== 'DRAFT') throw new DomainError('INVALID_STATE', 'รายงานที่ส่งแล้วแก้ไขไม่ได้', 409);
      if (r.createdBy !== actor.id && !can(actor, 'project.manage', { projectId })) {
        throw new DomainError('FORBIDDEN', 'แก้ไขได้เฉพาะผู้เขียนรายงานหรือผู้ดูแลโครงการ', 403);
      }
      await tx.update(dailyReports).set({ ...data, updatedAt: new Date() }).where(eq(dailyReports.id, reportId));
      return { id: r.id, number: r.number };
    }
    const number = await nextDocNumber(tx, 'DR');
    const [created] = await tx.insert(dailyReports).values({ ...data, projectId, number, createdBy: actor.id }).returning();
    await logActivity(tx, { entityType: 'DAILY_REPORT', entityId: created.id, action: 'CREATE', userId: actor.id, note: `${project.code} ${data.reportDate}` });
    return { id: created.id, number };
  });
}

/** Submitting locks the report; task progress entered in it is applied to the tasks. */
export async function submitDailyReport(db: Db, actor: SessionUser, reportId: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(dailyReports).where(eq(dailyReports.id, reportId)).for('update');
    if (!r) throw new DomainError('NOT_FOUND', 'ไม่พบรายงาน', 404);
    assertCan(actor, 'project.view', { projectId: r.projectId });
    if (r.status !== 'DRAFT') throw new DomainError('INVALID_STATE', 'รายงานนี้ส่งแล้ว', 409);
    if (r.createdBy !== actor.id && !can(actor, 'project.manage', { projectId: r.projectId })) {
      throw new DomainError('FORBIDDEN', 'ส่งได้เฉพาะผู้เขียนรายงานหรือผู้ดูแลโครงการ', 403);
    }
    for (const w of r.work) {
      if (!w.taskId || w.progressPercent === null) continue;
      // Progress never moves backwards from a daily report
      await tx
        .update(projectTasks)
        .set({ progress: Math.round(w.progressPercent), updatedAt: new Date() })
        .where(and(eq(projectTasks.id, w.taskId), eq(projectTasks.projectId, r.projectId), lte(projectTasks.progress, Math.round(w.progressPercent))));
    }
    await tx.update(dailyReports).set({ status: 'SUBMITTED', updatedAt: new Date() }).where(eq(dailyReports.id, reportId));
    await logActivity(tx, { entityType: 'DAILY_REPORT', entityId: reportId, action: 'SUBMIT', userId: actor.id });
  });
}
