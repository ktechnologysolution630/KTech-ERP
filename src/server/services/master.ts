import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  items,
  projectMembers,
  projects,
  ROLES,
  units,
  userRoles,
  users,
  vendors,
  type Role,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { WHT_RATES } from '@/domain/money';
import { hashPassword } from '@/server/auth/password';
import { assertCan, isSiteScopedOnly } from '@/server/policy';

const projectSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'กรุณาระบุรหัสโครงการ'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อโครงการ'),
  active: z.boolean().default(true),
});

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

  if (data.id) {
    const [updated] = await db
      .update(projects)
      .set({
        code: data.code,
        name: data.name,
        active: data.active,
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
    })
    .onConflictDoUpdate({
      target: projects.code,
      set: {
        name: data.name,
        active: data.active,
        updatedAt: new Date(),
      },
    })
    .returning();
  return inserted;
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

const userSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อผู้ใช้'),
  password: z.string().min(4, 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร').optional(),
  roles: z.array(z.enum(ROLES)).min(1, 'ต้องเลือกอย่างน้อย 1 บทบาท'),
  projectIds: z.array(z.string().uuid()).default([]),
  active: z.boolean().default(true),
});

export async function upsertUser(
  db: Db,
  actor: SessionUser,
  input: z.input<typeof userSchema>,
) {
  assertCan(actor, 'users.manage');
  const parsed = userSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_USER', parsed.error.issues[0].message);
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();

  return db.transaction(async (tx) => {
    let userId = d.id;
    if (userId) {
      await tx
        .update(users)
        .set({
          email,
          name: d.name,
          active: d.active,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      if (d.password) {
        const passwordHash = await hashPassword(d.password);
        await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
      }
    } else {
      const passwordHash = await hashPassword(d.password || 'ktec1234');
      const [created] = await tx
        .insert(users)
        .values({
          email,
          name: d.name,
          passwordHash,
          active: d.active,
        })
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
  if (!newPassword || newPassword.length < 4) {
    throw new DomainError('INVALID_PASSWORD', 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
  }
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function listUsersWithRoles(db: Db) {
  const allUsers = await db.select().from(users).orderBy(asc(users.email));
  const allRoles = await db.select().from(userRoles);
  const allMembers = await db.select().from(projectMembers);

  return allUsers.map((u) => ({
    ...u,
    roles: allRoles.filter((r) => r.userId === u.id).map((r) => r.role),
    projectIds: allMembers.filter((m) => m.userId === u.id).map((m) => m.projectId),
  }));
}
