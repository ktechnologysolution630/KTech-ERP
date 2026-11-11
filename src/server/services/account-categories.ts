import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { accountCategories, docCounters, type AccountCategoryType, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { docPeriod } from '@/domain/thai';
import { assertCan } from '@/server/policy';

const schema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'กรุณากรอกรหัสหมวด').max(20),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อหมวด').max(200),
  type: z.enum(['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY', 'OTHER']),
  groupName: z.string().trim().max(200).default(''),
  vatDefault: z.enum(['VAT7', 'NONE']).default('VAT7'),
  whtRate: z.number().finite().min(0).max(100).default(0),
  active: z.boolean().default(true),
});
export type AccountCategoryInput = z.input<typeof schema>;

export async function listAccountCategories(db: Db, actor: SessionUser, opts: { types?: AccountCategoryType[]; activeOnly?: boolean } = {}) {
  assertCan(actor, 'ar.manage');
  const where = and(opts.types ? inArray(accountCategories.type, opts.types) : undefined, opts.activeOnly ? eq(accountCategories.active, true) : undefined);
  return db.select().from(accountCategories).where(where).orderBy(asc(accountCategories.code));
}

/** Adds or edits a category; a code is used once */
export async function saveAccountCategory(db: Db, actor: SessionUser, input: AccountCategoryInput): Promise<string> {
  assertCan(actor, 'ar.manage');
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_CATEGORY', parsed.error.issues[0]!.message);
  const { id, whtRate, ...c } = parsed.data;
  const [taken] = await db.select({ id: accountCategories.id }).from(accountCategories).where(eq(accountCategories.code, c.code)).limit(1);
  if (taken && taken.id !== id) throw new DomainError('DUPLICATE_CODE', `รหัสหมวด ${c.code} มีอยู่แล้ว`, 409);
  const values = { ...c, whtRate: whtRate.toFixed(2), updatedAt: new Date() };
  if (id) {
    const [row] = await db.update(accountCategories).set(values).where(eq(accountCategories.id, id)).returning();
    if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบหมวด', 404);
    return row.id;
  }
  const [row] = await db.insert(accountCategories).values(values).returning();
  return row!.id;
}

const RUNNING = [
  ['QT', 'ใบเสนอราคา'],
  ['INV', 'ใบแจ้งหนี้'],
  ['REC', 'ใบเสร็จรับเงิน'],
  ['TI', 'ใบกำกับภาษี'],
  ['STI', 'ใบกำกับภาษีอย่างย่อ'],
  ['DN', 'ใบเพิ่มหนี้'],
  ['CN', 'ใบลดหนี้'],
  ['INC', 'รายรับ (ใบสำคัญรับ)'],
  ['EXP', 'รายจ่าย (ใบสำคัญจ่าย)'],
  ['PV', 'ใบสำคัญจ่ายตามใบสั่งซื้อ'],
  ['WHT', 'หัก ณ ที่จ่าย (50 ทวิ)'],
] as const;

/** Where each document's running number stands this month and what the next one will be */
export async function listDocRunning(db: Db, actor: SessionUser, at: Date = new Date()) {
  assertCan(actor, 'ar.manage');
  const period = docPeriod(at);
  const rows = await db.select().from(docCounters).where(eq(docCounters.period, period));
  const last = new Map(rows.map((r) => [r.prefix, r.last]));
  return RUNNING.map(([prefix, label]) => {
    const used = last.get(prefix) ?? 0;
    return { prefix, label, format: `${prefix}-${period}-0001`, used, next: `${prefix}-${period}-${String(used + 1).padStart(4, '0')}` };
  });
}
