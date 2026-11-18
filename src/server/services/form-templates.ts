import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { formTemplates, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import {
  formDef,
  FORM_KINDS,
  hiddenFieldsOf,
  resolveFormHeader,
  resolveFormText,
  type FormHeader,
  type FormKind,
  type FormText,
  type FormTextOverride,
} from '@/domain/form-templates';
import { can } from '@/server/policy';

/** The row that holds the letterhead lines every form shares */
const HEADER_KIND = 'HEADER';

export interface FormTemplates {
  header: FormHeader;
  /** What each form prints */
  texts: Record<FormKind, FormText>;
  /** What the owner changed, by form; the settings page shows the rest as the default */
  saved: Partial<Record<FormKind, FormTextOverride>>;
  savedHeader: Partial<FormHeader>;
}

/** Postgres "undefined_table": the server is running ahead of the migration that adds form_templates */
function isMissingTable(err: unknown): boolean {
  const codes = [err, (err as { cause?: unknown } | null)?.cause].map((e) => (e as { code?: unknown } | null)?.code);
  return codes.includes('42P01');
}

async function savedRows(db: Db): Promise<Map<string, Record<string, unknown>>> {
  try {
    const rows = await db.select({ kind: formTemplates.kind, fields: formTemplates.fields }).from(formTemplates);
    return new Map(rows.map((r) => [r.kind, r.fields ?? {}]));
  } catch (err) {
    // Every form keeps printing its defaults until `npm run db:migrate` has run
    if (isMissingTable(err)) return new Map();
    throw err;
  }
}

const overrideSchema = z.object({
  titleTh: z.string().optional(),
  titleEn: z.string().optional(),
  signatureLabels: z.array(z.string()).optional(),
  footerNote: z.string().optional(),
  hiddenFields: z.array(z.string()).optional(),
});

const headerSchema = z.object({
  companyNameEn: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

/** A stored row read back loosely: a field of the wrong shape is ignored, not fatal to printing */
const readOverride = (fields: Record<string, unknown> | undefined): FormTextOverride => {
  const parsed = overrideSchema.safeParse(fields ?? {});
  return parsed.success ? parsed.data : {};
};

export async function getFormTemplates(db: Db): Promise<FormTemplates> {
  const rows = await savedRows(db);
  const saved: Partial<Record<FormKind, FormTextOverride>> = {};
  for (const kind of FORM_KINDS) {
    const fields = rows.get(kind);
    if (fields) saved[kind] = readOverride(fields);
  }
  const headerParsed = headerSchema.safeParse(rows.get(HEADER_KIND) ?? {});
  const savedHeader = headerParsed.success ? headerParsed.data : {};
  return {
    header: resolveFormHeader(savedHeader),
    texts: Object.fromEntries(FORM_KINDS.map((k) => [k, resolveFormText(k, saved[k])])) as Record<FormKind, FormText>,
    saved,
    savedHeader,
  };
}

/** What one form prints, with the shared letterhead lines */
export async function getFormText(db: Db, kind: FormKind): Promise<{ text: FormText; header: FormHeader }> {
  const t = await getFormTemplates(db);
  return { text: t.texts[kind], header: t.header };
}

/** Checks input from the settings page; the first problem comes back as a message the page can show */
function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION', parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', 400);
  return parsed.data;
}

function assertManager(actor: SessionUser) {
  if (!can(actor, 'settings.manage')) {
    throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์แก้ไขแบบฟอร์มเอกสาร', 403);
  }
}

const trimmed = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what}ยาวเกิน ${max} ตัวอักษร`);

const formTextInput = z.object({
  titleTh: trimmed(80, 'ชื่อเอกสาร (ไทย) '),
  titleEn: trimmed(80, 'ชื่อเอกสาร (อังกฤษ) '),
  signatureLabels: z.array(trimmed(60, 'ชื่อช่องลงนาม ')),
  footerNote: trimmed(1000, 'หมายเหตุท้ายฟอร์ม '),
  hiddenFields: z.array(z.string().max(40)).max(20).optional(),
});

export type FormTextInput = z.input<typeof formTextInput>;

/** A write before the migration has run says so, instead of failing with a database error */
async function write(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isMissingTable(err)) {
      throw new DomainError('NOT_READY', 'ฐานข้อมูลยังไม่มีตารางแบบฟอร์ม ต้องรัน npm run db:migrate ก่อนจึงจะบันทึกได้', 409);
    }
    throw err;
  }
}

async function upsert(db: Db, actor: SessionUser, kind: string, fields: Record<string, unknown>) {
  await write(() =>
    db
      .insert(formTemplates)
      .values({ kind, fields, updatedBy: actor.id, updatedAt: new Date() })
      .onConflictDoUpdate({ target: formTemplates.kind, set: { fields, updatedBy: actor.id, updatedAt: sql`now()` } }),
  );
}

/**
 * Saves the words of one form. A field left blank, or the same as the default, is not stored, so it
 * follows the default if the default is changed later.
 */
export async function saveFormText(db: Db, actor: SessionUser, kind: FormKind, input: FormTextInput): Promise<FormText> {
  assertManager(actor);
  const d = formDef(kind).defaults;
  const parsed = parseInput(formTextInput, input);
  if (parsed.signatureLabels.length > d.signatureLabels.length) {
    throw new DomainError('VALIDATION', `ฟอร์มนี้มีช่องลงนาม ${d.signatureLabels.length} ช่อง`, 400);
  }
  const changed = (v: string, def: string) => (v && v !== def ? v : undefined);
  const labels = d.signatureLabels.map((def, i) => changed(parsed.signatureLabels[i] ?? '', def) ?? '');
  const fields: FormTextOverride = {
    titleTh: changed(parsed.titleTh, d.titleTh),
    titleEn: changed(parsed.titleEn, d.titleEn),
    signatureLabels: labels.some(Boolean) ? labels : undefined,
    footerNote: changed(parsed.footerNote, d.footerNote),
    // Every part prints unless the owner ticked it off
    hiddenFields: hiddenFieldsOf(kind, parsed.hiddenFields).length > 0 ? hiddenFieldsOf(kind, parsed.hiddenFields) : undefined,
  };
  const stored = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  await upsert(db, actor, kind, stored);
  return resolveFormText(kind, stored);
}

/** Back to the words in the code */
export async function resetFormText(db: Db, actor: SessionUser, kind: FormKind): Promise<FormText> {
  assertManager(actor);
  await write(() => db.delete(formTemplates).where(eq(formTemplates.kind, kind)));
  return resolveFormText(kind);
}

const headerInput = z.object({
  companyNameEn: trimmed(120, 'ชื่อบริษัทภาษาอังกฤษ'),
  phone: trimmed(60, 'เบอร์โทร'),
  email: z
    .string()
    .trim()
    .max(120, 'อีเมลยาวเกิน 120 ตัวอักษร')
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'รูปแบบอีเมลไม่ถูกต้อง'),
});

export type FormHeaderInput = z.input<typeof headerInput>;

export async function saveFormHeader(db: Db, actor: SessionUser, input: FormHeaderInput): Promise<FormHeader> {
  assertManager(actor);
  const parsed = parseInput(headerInput, input);
  const stored = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== ''));
  await upsert(db, actor, HEADER_KIND, stored);
  return resolveFormHeader(stored);
}
