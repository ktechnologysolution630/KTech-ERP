import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  advances,
  apCreditNotes,
  arCreditNotes,
  arInvoices,
  arReceipts,
  boqOverrunRequests,
  docCounters,
  invoices,
  pos,
  projects,
  prs,
  prvItems,
  prvs,
  pvs,
  salesDocs,
  stockDocs,
  variationOrders,
  type EntityType,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { SALES_DOC_META, type SalesDocKind } from '@/domain/sales-doc';
import { docPeriod } from '@/domain/thai';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import {
  formatDocNumber,
  formatProjectDocNumber,
  isDocNumberTaken,
  projectCounterPeriod,
  type DocPrefix,
} from './numbering';

/** Documents whose next number and existing numbers can be set by hand, in menu order */
export const DOC_NUMBER_TYPES = [
  { key: 'PR', label: 'ใบขอซื้อ (PR)' },
  { key: 'PO', label: 'ใบสั่งซื้อ (PO)' },
  { key: 'PV', label: 'ใบสำคัญจ่าย (PV)' },
  { key: 'PCN', label: 'ใบลดหนี้ผู้ขาย/ส่งคืนสินค้า' },
  { key: 'AP', label: 'ใบขอซื้อเกิน BOQ (ใบ AP)' },
  { key: 'PRV', label: 'ใบขอเบิกค่าแรง (PRV)' },
  { key: 'INV', label: 'ใบแจ้งหนี้ลูกค้า' },
  { key: 'RC', label: 'ใบเสร็จรับเงินงวดงาน' },
  { key: 'CN', label: 'ใบลดหนี้' },
  { key: 'QT', label: 'ใบเสนอราคา' },
  { key: 'REC', label: 'ใบเสร็จรับเงิน (เมนูบัญชี)' },
  { key: 'TI', label: 'ใบกำกับภาษี' },
  { key: 'STI', label: 'ใบกำกับภาษีอย่างย่อ' },
  { key: 'DN', label: 'ใบเพิ่มหนี้' },
  { key: 'ADV', label: 'เงินทดรองจ่าย' },
  { key: 'VO', label: 'งานเพิ่ม-ลด (VO)' },
] as const satisfies readonly { key: DocPrefix; label: string }[];

export type DocNumberKey = (typeof DOC_NUMBER_TYPES)[number]['key'];
const KEYS = DOC_NUMBER_TYPES.map((t) => t.key) as [DocNumberKey, ...DocNumberKey[]];

/** The sales document kind each sales prefix is issued for */
const SALES_KIND_OF: Partial<Record<DocNumberKey, SalesDocKind>> = Object.fromEntries(
  Object.entries(SALES_DOC_META).map(([kind, meta]) => [meta.prefix, kind as SalesDocKind]),
);

export interface DocNumberStatus {
  key: DocNumberKey;
  label: string;
  /** PR numbers run per project; the row needs a project */
  perProject: boolean;
  /** The last number handed out this month, or null when none yet */
  lastNumber: string | null;
  /** What the next document will get; null for PR until a project is chosen */
  nextNumber: string | null;
  /** The running count the next number carries */
  nextSeq: number | null;
}

const MAX_SEQ = 99999;

/** Each document kind's count for the current month, and the number the next document will get */
export async function listDocNumberStatus(db: Db, actor: SessionUser, prProjectId?: string | null): Promise<DocNumberStatus[]> {
  assertCan(actor, 'settings.manage');
  const period = docPeriod(new Date());
  const project = prProjectId ? (await db.select({ id: projects.id, code: projects.code }).from(projects).where(eq(projects.id, prProjectId)).limit(1))[0] : undefined;

  const keys = DOC_NUMBER_TYPES.filter((t) => t.key !== 'PR').map((t) => t.key);
  const counters = await db
    .select()
    .from(docCounters)
    .where(
      project
        ? sql`(${docCounters.period} = ${period} and ${inArray(docCounters.prefix, keys)}) or (${docCounters.prefix} = 'PR' and ${docCounters.period} = ${projectCounterPeriod(project.id, period)})`
        : and(eq(docCounters.period, period), inArray(docCounters.prefix, keys)),
    );
  const lastOf = (prefix: string, key: string) => counters.find((c) => c.prefix === prefix && c.period === key)?.last ?? 0;

  const out: DocNumberStatus[] = [];
  for (const t of DOC_NUMBER_TYPES) {
    if (t.key === 'PR') {
      if (!project) {
        out.push({ key: t.key, label: t.label, perProject: true, lastNumber: null, nextNumber: null, nextSeq: null });
        continue;
      }
      const last = lastOf('PR', projectCounterPeriod(project.id, period));
      const format = (seq: number) => formatProjectDocNumber('PR', project.code, period, seq);
      const nextSeq = await firstFree(db, 'PR', last + 1, format);
      out.push({ key: t.key, label: t.label, perProject: true, lastNumber: last ? format(last) : null, nextNumber: format(nextSeq), nextSeq });
      continue;
    }
    const last = lastOf(t.key, period);
    const format = (seq: number) => formatDocNumber(t.key, period, seq);
    const nextSeq = await firstFree(db, t.key, last + 1, format);
    out.push({ key: t.key, label: t.label, perProject: false, lastNumber: last ? format(last) : null, nextNumber: format(nextSeq), nextSeq });
  }
  return out;
}

/** The first count from `from` whose number no document uses yet, as the issuing code will find it */
async function firstFree(db: Db, prefix: DocPrefix, from: number, format: (seq: number) => string): Promise<number> {
  let seq = from;
  while (seq < from + 1000 && (await isDocNumberTaken(db, prefix, format(seq)))) seq++;
  return seq;
}

const setNextSchema = z.object({
  key: z.enum(KEYS),
  next: z.coerce.number().int('เลขถัดไปต้องเป็นจำนวนเต็ม').min(1, 'เลขถัดไปต้องตั้งแต่ 1').max(MAX_SEQ, `เลขถัดไปต้องไม่เกิน ${MAX_SEQ}`),
  projectId: z.string().uuid().nullable().optional(),
});

/**
 * Sets the count the next document of this kind gets this month. Lower than numbers already used is
 * allowed: those are skipped when they come up.
 */
export async function setNextDocNumber(
  db: Db,
  actor: SessionUser,
  input: { key: string; next: number | string; projectId?: string | null },
): Promise<{ nextNumber: string }> {
  assertCan(actor, 'settings.manage');
  const parsed = setNextSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_INPUT', parsed.error.issues[0]!.message);
  const { key, next, projectId } = parsed.data;
  const period = docPeriod(new Date());

  let counterPeriod = period;
  let nextNumber = formatDocNumber(key, period, next);
  if (key === 'PR') {
    if (!projectId) throw new DomainError('INVALID_INPUT', 'เลข PR นับแยกแต่ละโครงการ กรุณาเลือกโครงการ');
    const [project] = await db.select({ id: projects.id, code: projects.code }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
    counterPeriod = projectCounterPeriod(project.id, period);
    nextNumber = formatProjectDocNumber('PR', project.code, period, next);
  }

  // The counter holds the last number handed out
  await db
    .insert(docCounters)
    .values({ prefix: key, period: counterPeriod, last: next - 1 })
    .onConflictDoUpdate({ target: [docCounters.prefix, docCounters.period], set: { last: next - 1, updatedAt: new Date() } });
  return { nextNumber };
}

/** A document found by its number, with what renumbering it needs */
interface FoundDoc {
  id: string;
  /** Where the change is recorded */
  entityType: EntityType;
  entityId: string;
  href: string;
  update: (tx: Db, number: string) => Promise<unknown>;
}

async function findDoc(tx: Db, key: DocNumberKey, number: string): Promise<FoundDoc | null> {
  switch (key) {
    case 'PR': {
      const [d] = await tx.select({ id: prs.id }).from(prs).where(eq(prs.number, number)).limit(1);
      return d ? { id: d.id, entityType: 'PR', entityId: d.id, href: `/pr/${d.id}`, update: (t, n) => t.update(prs).set({ number: n, updatedAt: new Date() }).where(eq(prs.id, d.id)) } : null;
    }
    case 'PO': {
      const [d] = await tx.select({ id: pos.id }).from(pos).where(eq(pos.number, number)).limit(1);
      return d
        ? {
            id: d.id,
            entityType: 'PO',
            entityId: d.id,
            href: `/po/${d.id}`,
            update: async (t, n) => {
              await t.update(pos).set({ number: n, updatedAt: new Date() }).where(eq(pos.id, d.id));
              // Labour claims and stock receipts keep a copy of the PO number
              await t.update(prvItems).set({ poNumber: n }).where(eq(prvItems.poNumber, number));
              await t.update(stockDocs).set({ poNumber: n }).where(eq(stockDocs.poNumber, number));
            },
          }
        : null;
    }
    case 'PV': {
      const [d] = await tx.select({ id: pvs.id }).from(pvs).where(eq(pvs.number, number)).limit(1);
      return d ? { id: d.id, entityType: 'PV', entityId: d.id, href: `/pv/${d.id}`, update: (t, n) => t.update(pvs).set({ number: n }).where(eq(pvs.id, d.id)) } : null;
    }
    case 'PCN': {
      const [d] = await tx.select({ id: apCreditNotes.id, invoiceId: apCreditNotes.invoiceId }).from(apCreditNotes).where(eq(apCreditNotes.number, number)).limit(1);
      if (!d) return null;
      const [inv] = await tx.select({ poId: invoices.poId }).from(invoices).where(eq(invoices.id, d.invoiceId)).limit(1);
      return { id: d.id, entityType: 'PO', entityId: inv!.poId, href: `/invoices/${d.invoiceId}`, update: (t, n) => t.update(apCreditNotes).set({ number: n }).where(eq(apCreditNotes.id, d.id)) };
    }
    case 'AP': {
      const [d] = await tx.select({ id: boqOverrunRequests.id, poId: boqOverrunRequests.poId }).from(boqOverrunRequests).where(eq(boqOverrunRequests.number, number)).limit(1);
      return d
        ? { id: d.id, entityType: 'PO', entityId: d.poId, href: `/po/${d.poId}`, update: (t, n) => t.update(boqOverrunRequests).set({ number: n, updatedAt: new Date() }).where(eq(boqOverrunRequests.id, d.id)) }
        : null;
    }
    case 'PRV': {
      const [d] = await tx.select({ id: prvs.id }).from(prvs).where(eq(prvs.prvNumber, number)).limit(1);
      return d ? { id: d.id, entityType: 'PRV', entityId: d.id, href: `/prv/${d.id}`, update: (t, n) => t.update(prvs).set({ prvNumber: n }).where(eq(prvs.id, d.id)) } : null;
    }
    case 'INV': {
      const [d] = await tx.select({ id: arInvoices.id }).from(arInvoices).where(eq(arInvoices.number, number)).limit(1);
      return d ? { id: d.id, entityType: 'AR_INVOICE', entityId: d.id, href: `/ar/invoices/${d.id}`, update: (t, n) => t.update(arInvoices).set({ number: n }).where(eq(arInvoices.id, d.id)) } : null;
    }
    case 'RC': {
      const [d] = await tx.select({ id: arReceipts.id, invoiceId: arReceipts.invoiceId }).from(arReceipts).where(eq(arReceipts.number, number)).limit(1);
      return d
        ? { id: d.id, entityType: 'AR_INVOICE', entityId: d.invoiceId, href: `/ar/invoices/${d.invoiceId}`, update: (t, n) => t.update(arReceipts).set({ number: n }).where(eq(arReceipts.id, d.id)) }
        : null;
    }
    case 'CN': {
      const [d] = await tx.select({ id: arCreditNotes.id, invoiceId: arCreditNotes.invoiceId }).from(arCreditNotes).where(eq(arCreditNotes.number, number)).limit(1);
      return d
        ? { id: d.id, entityType: 'AR_INVOICE', entityId: d.invoiceId, href: `/ar/invoices/${d.invoiceId}`, update: (t, n) => t.update(arCreditNotes).set({ number: n }).where(eq(arCreditNotes.id, d.id)) }
        : null;
    }
    case 'QT':
    case 'REC':
    case 'TI':
    case 'STI':
    case 'DN': {
      const kind = SALES_KIND_OF[key]!;
      const [d] = await tx.select({ id: salesDocs.id }).from(salesDocs).where(and(eq(salesDocs.number, number), eq(salesDocs.kind, kind))).limit(1);
      return d
        ? { id: d.id, entityType: 'SALES_DOC', entityId: d.id, href: `/sales/${SALES_DOC_META[kind].slug}/${d.id}`, update: (t, n) => t.update(salesDocs).set({ number: n }).where(eq(salesDocs.id, d.id)) }
        : null;
    }
    case 'ADV': {
      const [d] = await tx.select({ id: advances.id }).from(advances).where(eq(advances.number, number)).limit(1);
      return d ? { id: d.id, entityType: 'ADVANCE', entityId: d.id, href: `/advances/${d.id}`, update: (t, n) => t.update(advances).set({ number: n }).where(eq(advances.id, d.id)) } : null;
    }
    case 'VO': {
      const [d] = await tx.select({ id: variationOrders.id, projectId: variationOrders.projectId }).from(variationOrders).where(eq(variationOrders.number, number)).limit(1);
      return d
        ? { id: d.id, entityType: 'VO', entityId: d.id, href: `/projects/${d.projectId}?tab=vo`, update: (t, n) => t.update(variationOrders).set({ number: n }).where(eq(variationOrders.id, d.id)) }
        : null;
    }
  }
}

const renumberSchema = z.object({
  key: z.enum(KEYS),
  currentNumber: z.string().trim().min(1, 'กรุณาระบุเลขที่เอกสารเดิม'),
  newNumber: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุเลขที่ใหม่')
    .max(60, 'เลขที่ใหม่ต้องไม่เกิน 60 ตัวอักษร')
    .regex(/^\S+$/, 'เลขที่ใหม่ต้องไม่มีช่องว่าง'),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่เปลี่ยนเลข').max(500),
});

/**
 * Changes the number of a document already issued. The new number must not be used by another
 * document of the same kind; the change is kept in the document's history with the reason.
 */
export async function renumberDocument(
  db: Db,
  actor: SessionUser,
  input: { key: string; currentNumber: string; newNumber: string; reason: string },
): Promise<{ href: string; number: string }> {
  assertCan(actor, 'settings.manage');
  const parsed = renumberSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_INPUT', parsed.error.issues[0]!.message);
  const { key, currentNumber, newNumber, reason } = parsed.data;
  if (newNumber === currentNumber) throw new DomainError('INVALID_INPUT', 'เลขที่ใหม่ต้องต่างจากเลขเดิม');

  return db.transaction(async (tx) => {
    const doc = await findDoc(tx, key, currentNumber);
    if (!doc) throw new DomainError('NOT_FOUND', `ไม่พบ${DOC_NUMBER_TYPES.find((t) => t.key === key)!.label} เลขที่ ${currentNumber}`, 404);
    if (await isDocNumberTaken(tx, key, newNumber)) {
      throw new DomainError('NUMBER_TAKEN', `เลขที่ ${newNumber} มีเอกสารใช้อยู่แล้ว`, 409);
    }
    await doc.update(tx, newNumber);
    await logActivity(tx, {
      entityType: doc.entityType,
      entityId: doc.entityId,
      action: 'renumber',
      userId: actor.id,
      note: `เปลี่ยนเลขจาก ${currentNumber} เป็น ${newNumber}: ${reason}`,
    });
    return { href: doc.href, number: newNumber };
  });
}
