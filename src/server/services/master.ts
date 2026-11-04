import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  attachments,
  boqs,
  comments,
  customers,
  dailyReports,
  items,
  milestones,
  projectEvents,
  projectHandovers,
  projectMembers,
  projects,
  projectTasks,
  ROLES,
  stockBalances,
  units,
  userRoles,
  users,
  variationOrders,
  vendors,
  warrantyDefects,
  type Role,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, WHT_RATES } from '@/domain/money';
import { PROJECT_COVER_PRESETS, PROJECT_STATUSES, type ProjectStatus } from '@/domain/project';
import { hashPassword } from '@/server/auth/password';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { removeStoredFile, storeFile } from './attachments';
import { nextDocNumber } from './numbering';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');

/** Optional descriptive fields; omitted keys are left unchanged on update. */
const projectDetailFields = {
  status: z.enum(PROJECT_STATUSES).optional(),
  clientName: z.string().trim().max(300).optional(),
  projectGroup: z.string().trim().max(100).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactPhone: z.string().trim().max(50).optional(),
  location: z.string().trim().max(500).optional(),
  budget: z.number().finite().min(0, 'งบประมาณต้องไม่ติดลบ').max(10_000_000_000_000).optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  pmUserId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
};

type ProjectDetailInput = {
  [K in keyof typeof projectDetailFields]?: z.infer<(typeof projectDetailFields)[K]>;
};

const projectSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'กรุณาระบุรหัสโครงการ'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อโครงการ'),
  active: z.boolean().default(true),
  ...projectDetailFields,
});

const projectDetailsUpdateSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาระบุชื่อโครงการ').optional(),
  ...projectDetailFields,
});

function assertDateRange(start: string | null | undefined, end: string | null | undefined) {
  // ISO yyyy-mm-dd strings compare correctly as text
  if (start && end && end < start) {
    throw new DomainError('INVALID_PROJECT', 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
  }
}

async function assertPmUser(db: Db, pmUserId: string | null | undefined) {
  if (!pmUserId) return;
  const [pm] = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.id, pmUserId))
    .limit(1);
  if (!pm || !pm.active) {
    throw new DomainError('INVALID_PROJECT', 'ไม่พบผู้จัดการโครงการที่เลือก');
  }
}

function detailColumns(d: ProjectDetailInput) {
  const cols: Partial<typeof projects.$inferInsert> = {};
  if (d.status !== undefined) cols.status = d.status;
  if (d.clientName !== undefined) cols.clientName = d.clientName;
  if (d.projectGroup !== undefined) cols.projectGroup = d.projectGroup;
  if (d.contactName !== undefined) cols.contactName = d.contactName;
  if (d.contactPhone !== undefined) cols.contactPhone = d.contactPhone;
  if (d.location !== undefined) cols.location = d.location;
  if (d.budget !== undefined) cols.budget = D(d.budget).toFixed(2);
  if (d.startDate !== undefined) cols.startDate = d.startDate;
  if (d.endDate !== undefined) cols.endDate = d.endDate;
  if (d.pmUserId !== undefined) cols.pmUserId = d.pmUserId;
  if (d.customerId !== undefined) cols.customerId = d.customerId;
  return cols;
}

export async function upsertProject(
  db: Db,
  actor: SessionUser,
  input: z.input<typeof projectSchema>,
) {
  assertCan(actor, 'master.manage');
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_PROJECT', parsed.error.issues[0].message);
  }
  const data = parsed.data;
  assertDateRange(data.startDate, data.endDate);
  await assertPmUser(db, data.pmUserId);
  const details = detailColumns(data);

  if (data.id) {
    const [updated] = await db
      .update(projects)
      .set({
        code: data.code,
        name: data.name,
        active: data.active,
        ...details,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, data.id))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(projects)
    .values({
      code: data.code,
      name: data.name,
      active: data.active,
      ...details,
    })
    .onConflictDoUpdate({
      target: projects.code,
      set: {
        name: data.name,
        active: data.active,
        ...details,
        updatedAt: new Date(),
      },
    })
    .returning();
  return inserted;
}

const createProjectSchema = z.object({
  /** Blank → next running number, e.g. PJ-6911-0001 */
  code: z.string().trim().max(50).default(''),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อโครงการ').max(300),
  ...projectDetailFields,
  status: z.enum(PROJECT_STATUSES).default('PLANNING'),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;

const COVER_TYPES: Record<string, true> = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'image/gif': true,
};
/** Keep in step with `serverActions.bodySizeLimit` in next.config.ts */
export const MAX_COVER_BYTES = 4 * 1024 * 1024;

function assertCoverFile(cover: File) {
  if (!COVER_TYPES[cover.type]) {
    throw new DomainError('INVALID_PROJECT', 'รูปโครงการต้องเป็นไฟล์ JPG, PNG, WebP หรือ GIF');
  }
  if (cover.size > MAX_COVER_BYTES) {
    throw new DomainError('INVALID_PROJECT', 'รูปโครงการต้องมีขนาดไม่เกิน 4 MB');
  }
}

export type ProjectCoverSource =
  | { kind: 'upload'; file: File }
  | { kind: 'preset'; url: string }
  | { kind: 'remove' };

/** Sets the workspace cover photo from an upload or a built-in preset, or clears it. */
export async function setProjectCover(
  db: Db,
  actor: SessionUser,
  projectId: string,
  source: ProjectCoverSource,
): Promise<string> {
  const previous = await getProjectDetail(db, actor, projectId);
  assertCan(actor, 'project.manage', { projectId });

  let url = '';
  if (source.kind === 'upload') {
    if (source.file.size === 0) throw new DomainError('INVALID_PROJECT', 'กรุณาเลือกไฟล์รูป');
    assertCoverFile(source.file);
    url = (await storeFile(db, source.file)).url;
  } else if (source.kind === 'preset') {
    if (!PROJECT_COVER_PRESETS.includes(source.url)) {
      throw new DomainError('INVALID_PROJECT', 'ไม่พบรูปที่เลือก');
    }
    url = source.url;
  }
  await db.update(projects).set({ coverImageUrl: url, updatedAt: new Date() }).where(eq(projects.id, projectId));
  await removeStoredFile(db, previous.coverImageUrl);
  return url;
}

/**
 * Creates a project from the "สร้างโครงการ" dialog. Unlike `upsertProject` (import/master use),
 * a duplicate code is rejected instead of overwriting the existing project.
 */
export async function createProject(
  db: Db,
  actor: SessionUser,
  input: CreateProjectInput,
  cover?: File | null,
) {
  assertCan(actor, 'master.manage');
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_PROJECT', parsed.error.issues[0].message);
  }
  const data = parsed.data;
  assertDateRange(data.startDate, data.endDate);
  await assertPmUser(db, data.pmUserId);
  if (cover && cover.size > 0) assertCoverFile(cover);

  const created = await db.transaction(async (tx) => {
    let code = data.code;
    if (code) {
      const [dup] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, code)).limit(1);
      if (dup) throw new DomainError('DUPLICATE_PROJECT', `รหัสโครงการ ${code} มีอยู่แล้ว`, 409);
    } else {
      // Skip numbers already taken by manually entered codes
      for (;;) {
        code = await nextDocNumber(tx, 'PJ');
        const [taken] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, code)).limit(1);
        if (!taken) break;
      }
    }
    const [row] = await tx
      .insert(projects)
      .values({ code, name: data.name, ...detailColumns(data) })
      .returning();
    return row;
  });

  if (cover && cover.size > 0) {
    // Stored after the row exists so a rejected project never leaves an orphan file
    const stored = await storeFile(db, cover);
    const [withCover] = await db
      .update(projects)
      .set({ coverImageUrl: stored.url, updatedAt: new Date() })
      .where(eq(projects.id, created.id))
      .returning();
    return withCover;
  }
  return created;
}

export interface ProjectDetailDto {
  id: string;
  code: string;
  name: string;
  active: boolean;
  status: ProjectStatus;
  coverImageUrl: string;
  clientName: string;
  projectGroup: string;
  contactName: string;
  contactPhone: string;
  location: string;
  budget: number;
  startDate: string | null;
  endDate: string | null;
  pmUserId: string | null;
  pmName: string | null;
  customerId: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

/** Loads one project for its workspace; 404 for unknown ids, 403 without project access. */
export async function getProjectDetail(
  db: Db,
  actor: SessionUser,
  projectId: string,
): Promise<ProjectDetailDto> {
  if (!z.string().uuid().safeParse(projectId).success) {
    throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  }
  const [row] = await db
    .select({ project: projects, pmName: users.name })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.pmUserId))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  assertCan(actor, 'project.view', { projectId });

  const p = row.project;
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    active: p.active,
    status: p.status,
    coverImageUrl: p.coverImageUrl,
    clientName: p.clientName,
    projectGroup: p.projectGroup,
    contactName: p.contactName,
    contactPhone: p.contactPhone,
    location: p.location,
    budget: Number(p.budget),
    startDate: p.startDate,
    endDate: p.endDate,
    pmUserId: p.pmUserId,
    pmName: row.pmName,
    customerId: p.customerId,
    canEdit: can(actor, 'project.manage', { projectId }),
    canDelete: can(actor, 'project.delete', { projectId }),
  };
}

/** Workspace settings: PMs of the project, owner and admin may edit descriptive fields. */
export async function updateProjectDetails(
  db: Db,
  actor: SessionUser,
  projectId: string,
  input: z.input<typeof projectDetailsUpdateSchema>,
): Promise<ProjectDetailDto> {
  const current = await getProjectDetail(db, actor, projectId);
  assertCan(actor, 'project.manage', { projectId });
  const parsed = projectDetailsUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_PROJECT', parsed.error.issues[0].message);
  }
  const data = parsed.data;
  assertDateRange(
    data.startDate !== undefined ? data.startDate : current.startDate,
    data.endDate !== undefined ? data.endDate : current.endDate,
  );
  await assertPmUser(db, data.pmUserId);
  if (data.customerId) {
    const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, data.customerId)).limit(1);
    if (!c) throw new DomainError('INVALID_PROJECT', 'ไม่พบลูกค้าที่เลือก');
  }

  await db
    .update(projects)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...detailColumns(data),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
  return getProjectDetail(db, actor, projectId);
}

const isForeignKeyViolation = (err: unknown): boolean => {
  const { code, cause } = err as { code?: string; cause?: { code?: string } };
  return code === '23503' || cause?.code === '23503';
};

/**
 * Removes a project created by mistake. Cascades would silently take BOQs, reports and the like with it,
 * so anything beyond the project and its member list is refused; closing a used project is what status "ยกเลิก" is for.
 */
export async function deleteProject(db: Db, actor: SessionUser, projectId: string): Promise<void> {
  const project = await getProjectDetail(db, actor, projectId);
  assertCan(actor, 'project.delete', { projectId });
  const inUse = new DomainError('PROJECT_IN_USE', 'โครงการนี้มีข้อมูลงานหรือเอกสารแล้ว จึงลบไม่ได้ หากเลิกใช้งานให้เปลี่ยนสถานะเป็น "ยกเลิก"', 409);

  const content = await Promise.all([
    db.select({ id: boqs.id }).from(boqs).where(eq(boqs.projectId, projectId)).limit(1),
    db.select({ id: variationOrders.id }).from(variationOrders).where(eq(variationOrders.projectId, projectId)).limit(1),
    db.select({ id: projectTasks.id }).from(projectTasks).where(eq(projectTasks.projectId, projectId)).limit(1),
    db.select({ id: milestones.id }).from(milestones).where(eq(milestones.projectId, projectId)).limit(1),
    db.select({ id: dailyReports.id }).from(dailyReports).where(eq(dailyReports.projectId, projectId)).limit(1),
    db.select({ id: projectEvents.id }).from(projectEvents).where(eq(projectEvents.projectId, projectId)).limit(1),
    db.select({ id: projectHandovers.id }).from(projectHandovers).where(eq(projectHandovers.projectId, projectId)).limit(1),
    db.select({ id: warrantyDefects.id }).from(warrantyDefects).where(eq(warrantyDefects.projectId, projectId)).limit(1),
    db.select({ id: stockBalances.id }).from(stockBalances).where(eq(stockBalances.projectId, projectId)).limit(1),
    db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.entityType, 'PROJECT'), eq(attachments.entityId, projectId))).limit(1),
    db.select({ id: comments.id }).from(comments).where(and(eq(comments.entityType, 'PROJECT'), eq(comments.entityId, projectId))).limit(1),
  ]);
  if (content.some((rows) => rows.length > 0)) throw inUse;

  try {
    await db.delete(projects).where(eq(projects.id, projectId));
  } catch (err) {
    // PRs, POs, payables and other documents keep the project through a foreign key
    if (isForeignKeyViolation(err)) throw inUse;
    throw err;
  }
  await removeStoredFile(db, project.coverImageUrl);
  await logActivity(db, { entityType: 'PROJECT', entityId: projectId, action: 'project.delete', userId: actor.id, note: `${project.code} ${project.name}` });
}

export async function listProjects(db: Db, actor: SessionUser) {
  const all = await db.select().from(projects).orderBy(asc(projects.code));
  if (isSiteScopedOnly(actor)) {
    return all.filter((p) => actor.projectIds.includes(p.id));
  }
  return all;
}

const vendorSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'กรุณาระบุรหัสผู้ขาย'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อผู้ขาย'),
  type: z.enum(['INDIVIDUAL', 'COMPANY']).default('COMPANY'),
  taxId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{13}$/.test(v), {
      message: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก',
    }),
  branch: z
    .string()
    .trim()
    .default('00000')
    .refine((v) => /^\d{5}$/.test(v), {
      message: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก (เช่น 00000)',
    }),
  address: z.string().default(''),
  phone: z.string().default(''),
  bankName: z.string().default(''),
  bankAccountNo: z.string().default(''),
  bankAccountName: z.string().default(''),
  defaultCreditDays: z.number().int().min(0).default(30),
  defaultWhtRate: z
    .number()
    .int()
    .default(0)
    .refine((v) => (WHT_RATES as readonly number[]).includes(v), {
      message: 'อัตราหัก ณ ที่จ่ายต้องเป็น 0, 1, 2, 3 หรือ 5%',
    }),
  active: z.boolean().default(true),
});

export async function upsertVendor(
  db: Db,
  actor: SessionUser,
  input: z.input<typeof vendorSchema>,
) {
  assertCan(actor, 'master.manage');
  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_VENDOR', parsed.error.issues[0].message);
  }
  const d = parsed.data;

  if (d.id) {
    const [updated] = await db
      .update(vendors)
      .set({
        code: d.code,
        name: d.name,
        type: d.type,
        taxId: d.taxId,
        branch: d.branch,
        address: d.address,
        phone: d.phone,
        bankName: d.bankName,
        bankAccountNo: d.bankAccountNo,
        bankAccountName: d.bankAccountName,
        defaultCreditDays: d.defaultCreditDays,
        defaultWhtRate: d.defaultWhtRate,
        active: d.active,
        updatedAt: new Date(),
      })
      .where(eq(vendors.id, d.id))
      .returning();
    return updated;
  }

  const [saved] = await db
    .insert(vendors)
    .values({
      code: d.code,
      name: d.name,
      type: d.type,
      taxId: d.taxId,
      branch: d.branch,
      address: d.address,
      phone: d.phone,
      bankName: d.bankName,
      bankAccountNo: d.bankAccountNo,
      bankAccountName: d.bankAccountName,
      defaultCreditDays: d.defaultCreditDays,
      defaultWhtRate: d.defaultWhtRate,
      active: d.active,
    })
    .onConflictDoUpdate({
      target: vendors.code,
      set: {
        name: d.name,
        type: d.type,
        taxId: d.taxId,
        branch: d.branch,
        address: d.address,
        phone: d.phone,
        bankName: d.bankName,
        bankAccountNo: d.bankAccountNo,
        bankAccountName: d.bankAccountName,
        defaultCreditDays: d.defaultCreditDays,
        defaultWhtRate: d.defaultWhtRate,
        active: d.active,
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved;
}

export async function listVendors(db: Db) {
  return db.select().from(vendors).orderBy(asc(vendors.code));
}

export async function ensureUnit(db: Db, unitName: string): Promise<string> {
  const clean = unitName.trim();
  if (!clean) throw new DomainError('INVALID_UNIT', 'กรุณาระบุหน่วยสินค้า');
  const existing = await db.select().from(units).where(eq(units.name, clean)).limit(1);
  if (existing.length > 0) return existing[0].id;
  const [inserted] = await db.insert(units).values({ name: clean }).returning();
  return inserted.id;
}

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'กรุณาระบุรหัสสินค้า'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อสินค้า'),
  unitId: z.string().uuid().optional(),
  unitName: z.string().trim().optional(),
  category: z.string().trim().nullable().optional(),
  active: z.boolean().default(true),
});

export async function upsertItem(
  db: Db,
  actor: SessionUser,
  input: z.input<typeof itemSchema>,
) {
  assertCan(actor, 'master.manage');
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_ITEM', parsed.error.issues[0].message);
  }
  const d = parsed.data;
  const unitId = d.unitId ?? (d.unitName ? await ensureUnit(db, d.unitName) : null);
  if (!unitId) {
    throw new DomainError('INVALID_ITEM', 'กรุณาระบุหน่วยสินค้า');
  }

  if (d.id) {
    const [updated] = await db
      .update(items)
      .set({
        code: d.code,
        name: d.name,
        unitId,
        category: d.category ?? null,
        active: d.active,
        updatedAt: new Date(),
      })
      .where(eq(items.id, d.id))
      .returning();
    return updated;
  }

  const [saved] = await db
    .insert(items)
    .values({
      code: d.code,
      name: d.name,
      unitId,
      category: d.category ?? null,
      active: d.active,
    })
    .onConflictDoUpdate({
      target: items.code,
      set: {
        name: d.name,
        unitId,
        category: d.category ?? null,
        active: d.active,
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved;
}

export async function listItems(db: Db) {
  return db
    .select({
      id: items.id,
      code: items.code,
      name: items.name,
      unitId: items.unitId,
      unitName: units.name,
      category: items.category,
      active: items.active,
    })
    .from(items)
    .innerJoin(units, eq(units.id, items.unitId))
    .orderBy(asc(items.code));
}

export async function listUnits(db: Db) {
  return db.select().from(units).orderBy(asc(units.name));
}

export const MIN_PASSWORD_LENGTH = 8;
const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`)
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข');

const userSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อผู้ใช้').max(200),
  /** Required when creating; when editing, empty keeps the current password */
  password: passwordSchema.optional(),
  roles: z.array(z.enum(ROLES)).min(1, 'ต้องเลือกอย่างน้อย 1 บทบาท'),
  projectIds: z.array(z.string().uuid()).default([]),
  active: z.boolean().default(true),
});
export type UserInput = z.input<typeof userSchema>;

const ADMIN_ROLES: Role[] = ['ADMIN', 'OWNER'];

/** At least one active user must keep the ability to manage users, or nobody can fix accounts. */
async function assertUserManagerRemains(tx: Db, excludingUserId: string) {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(users.active, true), inArray(userRoles.role, ADMIN_ROLES), sql`${users.id} <> ${excludingUserId}`))
    .limit(1);
  if (!row) {
    throw new DomainError('LAST_ADMIN', 'ต้องมีผู้ดูแลระบบหรือเจ้าของที่ใช้งานได้อย่างน้อย 1 คน', 409);
  }
}

export async function upsertUser(db: Db, actor: SessionUser, input: UserInput) {
  assertCan(actor, 'users.manage');
  const parsed = userSchema.safeParse({ ...input, password: input.password || undefined });
  if (!parsed.success) {
    throw new DomainError('INVALID_USER', parsed.error.issues[0].message);
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();
  if (!d.id && !d.password) throw new DomainError('INVALID_USER', 'กรุณาตั้งรหัสผ่านเริ่มต้น');

  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (dup && dup.id !== d.id) throw new DomainError('DUPLICATE_EMAIL', `อีเมล ${email} มีผู้ใช้งานแล้ว`, 409);
    if (d.projectIds.length > 0) {
      const found = await tx.select({ id: projects.id }).from(projects).where(inArray(projects.id, d.projectIds));
      if (found.length !== new Set(d.projectIds).size) throw new DomainError('INVALID_USER', 'ไม่พบโครงการที่เลือก');
    }

    let userId = d.id;
    if (userId) {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      if (!existing) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ใช้งาน', 404);
      const keepsAdmin = d.active && d.roles.some((r) => ADMIN_ROLES.includes(r));
      if (userId === actor.id && !keepsAdmin) {
        throw new DomainError('SELF_LOCKOUT', 'ไม่สามารถปิดการใช้งานหรือถอดสิทธิ์ผู้ดูแลของตนเองได้', 409);
      }
      if (!keepsAdmin) await assertUserManagerRemains(tx, userId);
      await tx
        .update(users)
        .set({
          email,
          name: d.name,
          active: d.active,
          ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      const [created] = await tx
        .insert(users)
        .values({ email, name: d.name, passwordHash: await hashPassword(d.password!), active: d.active })
        .returning();
      userId = created.id;
    }

    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values(
      d.roles.map((role) => ({
        userId: userId!,
        role: role as Role,
      })),
    );

    await tx.delete(projectMembers).where(eq(projectMembers.userId, userId));
    if (d.projectIds.length > 0) {
      await tx.insert(projectMembers).values(
        d.projectIds.map((projectId) => ({
          projectId,
          userId: userId!,
        })),
      );
    }

    const [saved] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return saved;
  });
}

export async function setProjectMembers(
  db: Db,
  actor: SessionUser,
  projectId: string,
  userIds: string[],
): Promise<void> {
  assertCan(actor, 'users.manage');
  await db.transaction(async (tx) => {
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    const unique = Array.from(new Set(userIds));
    if (unique.length > 0) {
      await tx.insert(projectMembers).values(
        unique.map((userId) => ({
          projectId,
          userId,
        })),
      );
    }
  });
}

export async function resetPassword(
  db: Db,
  actor: SessionUser,
  userId: string,
  newPassword: string,
): Promise<void> {
  assertCan(actor, 'users.manage');
  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) throw new DomainError('INVALID_PASSWORD', parsed.error.issues[0].message);
  if (!z.string().uuid().safeParse(userId).success) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ใช้งาน', 404);
  const updated = await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data), updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (updated.length === 0) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ใช้งาน', 404);
}

export interface UserRowDto {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roles: Role[];
  projectIds: string[];
}

/** User list for administrators; the password hash never leaves the server. */
export async function listUsersWithRoles(db: Db, actor: SessionUser): Promise<UserRowDto[]> {
  assertCan(actor, 'users.manage');
  const [allUsers, allRoles, allMembers] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, active: users.active }).from(users).orderBy(asc(users.name)),
    db.select().from(userRoles),
    db.select().from(projectMembers),
  ]);
  return allUsers.map((u) => ({
    ...u,
    roles: allRoles.filter((r) => r.userId === u.id).map((r) => r.role),
    projectIds: allMembers.filter((m) => m.userId === u.id).map((m) => m.projectId),
  }));
}
