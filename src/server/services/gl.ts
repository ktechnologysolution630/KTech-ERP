import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  apCreditNotes,
  arCreditNotes,
  arInvoices,
  arReceipts,
  customers,
  glAccounts,
  invoices,
  journalEntries,
  journalLines,
  payables,
  poLines,
  pos,
  pvLines as pvLineTable,
  pvs,
  salesDocs,
  stockAdjustRequests,
  stockItems,
  stockMovements,
  vendors,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import {
  apCreditNoteLines,
  apInvoiceLines,
  arCreditNoteLines,
  arInvoiceLines,
  arReceiptLines,
  entryFingerprint,
  GL_ACCOUNT_TYPES,
  pvLines,
  salesDocLines,
  sideOf,
  stockAdjustLines,
  type EntryDraft,
  type GlAccountType,
  type JournalSource,
  type SystemAccountKey,
  type TrialBalanceRow,
} from '@/domain/gl';
import { D, round2, sum } from '@/domain/money';
import { SALES_DOC_META, type SalesDocKind } from '@/domain/sales-doc';
import { bangkokDateString } from '@/domain/thai';
import { assertCan } from '@/server/policy';
import { nextDocNumber } from './numbering';
import { assertPeriodOpen, closedThrough } from './gl-period';

/** The documents that post automatically, in the order a full re-post walks them */
export const AUTO_SOURCES = ['AP_INVOICE', 'AP_CREDIT_NOTE', 'PV', 'AR_INVOICE', 'AR_RECEIPT', 'AR_CREDIT_NOTE', 'SALES_DOC', 'STOCK_ADJUST'] as const;
export type AutoSource = (typeof AUTO_SOURCES)[number];

/**
 * What the document should post right now, or null when it should have no entry (draft, cancelled,
 * deleted, or a kind that is never posted).
 */
async function draftFor(tx: Db, source: AutoSource, id: string): Promise<EntryDraft | null> {
  switch (source) {
    case 'AP_INVOICE': {
      const [row] = await tx
        .select({ inv: invoices, poNumber: pos.number, projectId: pos.projectId, vendorName: vendors.name })
        .from(invoices)
        .innerJoin(pos, eq(pos.id, invoices.poId))
        .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
        .where(eq(invoices.id, id));
      if (!row || row.inv.status !== 'ACTIVE') return null;
      const [stocked] = await tx
        .select({ one: sql<number>`1` })
        .from(poLines)
        .where(and(eq(poLines.poId, row.inv.poId), isNotNull(poLines.stockItemId)))
        .limit(1);
      return {
        date: row.inv.invoiceDate,
        book: 'PU',
        sourceNumber: row.inv.invoiceNo,
        description: `ซื้อเชื่อตามใบสั่งซื้อ ${row.poNumber}`,
        partyName: row.vendorName,
        projectId: row.projectId,
        lines: apInvoiceLines({ ...row.inv, toInventory: Boolean(stocked) }),
      };
    }
    case 'AP_CREDIT_NOTE': {
      const [row] = await tx
        .select({ cn: apCreditNotes, inv: invoices, poNumber: pos.number, projectId: pos.projectId, vendorName: vendors.name })
        .from(apCreditNotes)
        .innerJoin(invoices, eq(invoices.id, apCreditNotes.invoiceId))
        .innerJoin(pos, eq(pos.id, invoices.poId))
        .innerJoin(vendors, eq(vendors.id, apCreditNotes.vendorId))
        .where(eq(apCreditNotes.id, id));
      if (!row || row.cn.voided) return null;
      const [stocked] = await tx
        .select({ one: sql<number>`1` })
        .from(poLines)
        .where(and(eq(poLines.poId, row.inv.poId), isNotNull(poLines.stockItemId)))
        .limit(1);
      return {
        date: row.cn.docDate,
        book: 'PU',
        sourceNumber: row.cn.number,
        description: `ลดหนี้/ส่งคืนสินค้า ตามใบแจ้งหนี้ ${row.inv.invoiceNo}: ${row.cn.reason}`,
        partyName: row.vendorName,
        projectId: row.projectId,
        lines: apCreditNoteLines({ ...row.cn, isTaxInvoice: row.inv.isTaxInvoice, toInventory: Boolean(stocked) }),
      };
    }
    case 'PV': {
      const [pv] = await tx.select({ pv: pvs, vendorName: vendors.name }).from(pvs).innerJoin(vendors, eq(vendors.id, pvs.vendorId)).where(eq(pvs.id, id));
      if (!pv || pv.pv.status !== 'PAID' || !pv.pv.paidAt) return null;
      const lines = await tx
        .select({ line: pvLineTable, sourceType: payables.sourceType, projectId: payables.projectId })
        .from(pvLineTable)
        .innerJoin(payables, eq(payables.id, pvLineTable.payableId))
        .where(eq(pvLineTable.pvId, id));
      const projectIds = new Set(lines.map((l) => l.projectId));
      return {
        date: pv.pv.paidAt,
        book: 'PS',
        sourceNumber: pv.pv.number,
        description: `จ่ายชำระหนี้ ${pv.pv.number}`,
        partyName: pv.vendorName,
        projectId: projectIds.size === 1 ? [...projectIds][0]! : null,
        lines: pvLines({ payMethod: pv.pv.payMethod, lines: lines.map((l) => ({ ...l.line, sourceType: l.sourceType })) }),
      };
    }
    case 'AR_INVOICE': {
      const [row] = await tx.select({ inv: arInvoices, customerName: customers.name }).from(arInvoices).innerJoin(customers, eq(customers.id, arInvoices.customerId)).where(eq(arInvoices.id, id));
      if (!row || !['ISSUED', 'PARTIAL', 'PAID'].includes(row.inv.status)) return null;
      // Brought forward: its debt is already in the opening entry
      if (row.inv.isOpening) return null;
      return {
        date: row.inv.docDate,
        book: 'SA',
        sourceNumber: row.inv.number ?? '',
        description: `ขายเชื่อ ${row.inv.number ?? ''}`.trim(),
        partyName: row.customerName,
        projectId: row.inv.projectId,
        lines: arInvoiceLines(row.inv),
      };
    }
    case 'AR_RECEIPT': {
      const [row] = await tx
        .select({ r: arReceipts, invNumber: arInvoices.number, projectId: arInvoices.projectId, customerName: customers.name })
        .from(arReceipts)
        .innerJoin(arInvoices, eq(arInvoices.id, arReceipts.invoiceId))
        .innerJoin(customers, eq(customers.id, arInvoices.customerId))
        .where(eq(arReceipts.id, id));
      if (!row || row.r.voided) return null;
      return {
        date: row.r.receiptDate,
        book: 'RV',
        sourceNumber: row.r.number,
        description: `รับชำระหนี้ตามใบแจ้งหนี้ ${row.invNumber ?? ''}`.trim(),
        partyName: row.customerName,
        projectId: row.projectId,
        lines: arReceiptLines(row.r),
      };
    }
    case 'AR_CREDIT_NOTE': {
      const [row] = await tx
        .select({ c: arCreditNotes, invNumber: arInvoices.number, projectId: arInvoices.projectId, customerName: customers.name })
        .from(arCreditNotes)
        .innerJoin(arInvoices, eq(arInvoices.id, arCreditNotes.invoiceId))
        .innerJoin(customers, eq(customers.id, arInvoices.customerId))
        .where(eq(arCreditNotes.id, id));
      if (!row || row.c.voided) return null;
      return {
        date: row.c.docDate,
        book: 'SA',
        sourceNumber: row.c.number,
        description: `ลดหนี้ใบแจ้งหนี้ ${row.invNumber ?? ''}: ${row.c.reason}`.trim(),
        partyName: row.customerName,
        projectId: row.projectId,
        lines: arCreditNoteLines(row.c),
      };
    }
    case 'STOCK_ADJUST': {
      const [row] = await tx
        .select({ req: stockAdjustRequests, itemName: stockItems.name })
        .from(stockAdjustRequests)
        .innerJoin(stockItems, eq(stockItems.id, stockAdjustRequests.stockItemId))
        .where(eq(stockAdjustRequests.id, id));
      if (!row || row.req.status !== 'APPROVED') return null;
      const [mv] = await tx
        .select({ quantity: stockMovements.quantity, unitCost: stockMovements.unitCost, createdAt: stockMovements.createdAt })
        .from(stockMovements)
        .where(and(eq(stockMovements.referenceType, 'ADJUSTMENT'), eq(stockMovements.referenceId, id)))
        .limit(1);
      if (!mv) return null;
      const value = round2(D(mv.quantity).times(D(mv.unitCost)));
      if (value.isZero()) return null;
      const at = row.req.approvedAt ?? mv.createdAt;
      return {
        date: bangkokDateString(at),
        book: 'GL',
        sourceNumber: row.req.requestNumber,
        description: `ปรับปรุงสต็อก ${row.itemName} ${D(mv.quantity).gt(0) ? '+' : ''}${D(mv.quantity).toNumber()}: ${row.req.reason}`,
        partyName: '',
        projectId: row.req.projectId,
        lines: stockAdjustLines({ value }),
      };
    }
    case 'SALES_DOC': {
      const [d] = await tx.select().from(salesDocs).where(eq(salesDocs.id, id));
      if (!d || d.status !== 'ISSUED') return null;
      const lines = salesDocLines({ ...d, payMethod: d.payMethod });
      if (!lines) return null;
      const kind = d.kind as SalesDocKind;
      const book = kind === 'EXP' ? 'PS' : kind === 'TI' || kind === 'DN' ? 'SA' : 'RV';
      return {
        date: d.docDate,
        book,
        sourceNumber: d.number,
        description: `${SALES_DOC_META[kind].th} ${d.accountCategory}`.trim(),
        partyName: d.customerName,
        projectId: d.projectId,
        lines,
      };
    }
  }
}

async function accountIdsByKey(tx: Db): Promise<Map<SystemAccountKey, string>> {
  const rows = await tx.select({ id: glAccounts.id, key: glAccounts.systemKey }).from(glAccounts).where(isNotNull(glAccounts.systemKey));
  return new Map(rows.map((r) => [r.key!, r.id]));
}

const bangkokNoon = (date: string) => new Date(`${date}T12:00:00+07:00`);

/**
 * Brings one document's journal in line with the document: posts it when it should have an entry,
 * voids the entry when it no longer should (cancelled, voided, deleted), and voids and re-posts when
 * the figures changed. Safe to call any number of times; called in the same transaction as the
 * document change, so the books never disagree with the documents.
 */
export async function syncJournal(tx: Db, source: AutoSource, id: string, actorId: string | null = null): Promise<string | null> {
  const draft = await draftFor(tx, source, id);
  const existing = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.sourceType, source), eq(journalEntries.sourceId, id), eq(journalEntries.status, 'POSTED')));

  let resolved: { accountId: string; debit: string; credit: string; memo: string }[] = [];
  if (draft) {
    const ids = await accountIdsByKey(tx);
    resolved = draft.lines.map((l) => {
      const accountId = ids.get(l.account);
      if (!accountId) throw new DomainError('GL_ACCOUNT_MISSING', `ยังไม่ได้กำหนดบัญชีสำหรับ "${l.account}" ในผังบัญชี`, 409);
      return { accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), memo: l.memo ?? '' };
    });
  }

  if (draft && existing.length === 1) {
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, existing[0]!.id));
    if (entryFingerprint({ date: existing[0]!.entryDate, lines }) === entryFingerprint({ date: draft.date, lines: resolved })) return existing[0]!.id;
  }
  // A closed period's books stay as they are: refuse before anything is written
  for (const e of existing) await assertPeriodOpen(tx, e.entryDate);
  if (draft) await assertPeriodOpen(tx, draft.date);
  if (existing.length > 0) {
    await tx
      .update(journalEntries)
      .set({ status: 'VOID', voidedAt: new Date(), voidReason: draft ? 'เอกสารถูกแก้ไข ลงบัญชีใหม่' : 'เอกสารถูกยกเลิก/ลบ' })
      .where(inArray(journalEntries.id, existing.map((e) => e.id)));
  }
  if (!draft) return null;

  const number = await nextDocNumber(tx, 'JV', bangkokNoon(draft.date));
  const total = round2(sum(draft.lines.map((l) => l.debit)));
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      number,
      entryDate: draft.date,
      book: draft.book,
      sourceType: source,
      sourceId: id,
      sourceNumber: draft.sourceNumber,
      description: draft.description,
      partyName: draft.partyName,
      projectId: draft.projectId,
      total: total.toFixed(2),
      createdBy: actorId,
    })
    .returning();
  await tx.insert(journalLines).values(resolved.map((l, i) => ({ ...l, entryId: entry!.id, sort: i })));
  return entry!.id;
}

async function sourceIds(db: Db, source: AutoSource): Promise<string[]> {
  const table = { AP_INVOICE: invoices, AP_CREDIT_NOTE: apCreditNotes, PV: pvs, AR_INVOICE: arInvoices, AR_RECEIPT: arReceipts, AR_CREDIT_NOTE: arCreditNotes, SALES_DOC: salesDocs, STOCK_ADJUST: stockAdjustRequests }[source];
  const rows = await db.select({ id: table.id }).from(table);
  return rows.map((r) => r.id);
}

/**
 * ลงบัญชีย้อนหลัง: walks every document that posts and syncs its journal, and voids entries whose
 * document is gone. Used once after this feature arrives, and whenever the books need checking.
 */
export async function repostAll(db: Db, actor: SessionUser): Promise<{ posted: number; voided: number; unchanged: number }> {
  assertCan(actor, 'gl.manage');
  return db.transaction(async (tx) => {
    const before = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.status, 'POSTED'));
    const beforeIds = new Set(before.map((r) => r.id));
    const kept = new Set<string>();
    let posted = 0;
    for (const source of AUTO_SOURCES) {
      for (const id of await sourceIds(tx, source)) {
        let entryId: string | null;
        try {
          entryId = await syncJournal(tx, source, id, actor.id);
        } catch (err) {
          // A document in a closed period keeps the entry it has; nothing was written before the refusal
          if (err instanceof DomainError && err.code === 'PERIOD_CLOSED') {
            const [kept_] = await tx
              .select({ id: journalEntries.id })
              .from(journalEntries)
              .where(and(eq(journalEntries.sourceType, source), eq(journalEntries.sourceId, id), eq(journalEntries.status, 'POSTED')));
            if (kept_) kept.add(kept_.id);
            continue;
          }
          throw err;
        }
        if (!entryId) continue;
        kept.add(entryId);
        if (!beforeIds.has(entryId)) posted++;
      }
    }
    // Entries of documents that were deleted outright
    const orphans = await tx
      .select({ id: journalEntries.id, entryDate: journalEntries.entryDate })
      .from(journalEntries)
      .where(and(eq(journalEntries.status, 'POSTED'), inArray(journalEntries.sourceType, [...AUTO_SOURCES])));
    const through = await closedThrough(tx);
    const orphanIds = orphans.filter((o) => !kept.has(o.id) && !(through && o.entryDate <= through)).map((o) => o.id);
    if (orphanIds.length > 0) {
      await tx.update(journalEntries).set({ status: 'VOID', voidedAt: new Date(), voidReason: 'ไม่พบเอกสารต้นทาง' }).where(inArray(journalEntries.id, orphanIds));
    }
    const unchanged = [...kept].filter((k) => beforeIds.has(k)).length;
    return { posted, voided: beforeIds.size - unchanged, unchanged };
  });
}

// ---------------------------------------------------------------- chart of accounts

export interface GlAccountDto {
  id: string;
  code: string;
  name: string;
  type: GlAccountType;
  systemKey: SystemAccountKey | null;
  active: boolean;
  /** Net of posted lines, debit positive */
  balance: number;
  used: boolean;
}

export async function listGlAccounts(db: Db, actor: SessionUser): Promise<GlAccountDto[]> {
  assertCan(actor, 'gl.view');
  const [accounts, totals] = await Promise.all([
    db.select().from(glAccounts).orderBy(asc(glAccounts.code)),
    db
      .select({
        accountId: journalLines.accountId,
        net: sql<string>`coalesce(sum(case when ${journalEntries.status} = 'POSTED' then ${journalLines.debit} - ${journalLines.credit} else 0 end), 0)`,
        n: sql<number>`count(*)::int`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .groupBy(journalLines.accountId),
  ]);
  const byId = new Map(totals.map((t) => [t.accountId, t]));
  return accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    systemKey: a.systemKey,
    active: a.active,
    balance: Number(byId.get(a.id)?.net ?? 0),
    used: (byId.get(a.id)?.n ?? 0) > 0,
  }));
}

export interface GlAccountInput {
  id?: string;
  code: string;
  name: string;
  type: GlAccountType;
  active?: boolean;
}

export async function saveGlAccount(db: Db, actor: SessionUser, input: GlAccountInput): Promise<string> {
  assertCan(actor, 'gl.manage');
  const code = input.code.trim();
  const name = input.name.trim();
  if (!/^[0-9A-Za-z-]{1,20}$/.test(code)) throw new DomainError('INVALID_INPUT', 'รหัสบัญชีใช้ตัวเลข/ตัวอักษร ไม่เกิน 20 ตัว', 400);
  if (!name) throw new DomainError('INVALID_INPUT', 'กรุณาระบุชื่อบัญชี', 400);
  if (!GL_ACCOUNT_TYPES.includes(input.type)) throw new DomainError('INVALID_INPUT', 'ประเภทบัญชีไม่ถูกต้อง', 400);
  return db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: glAccounts.id })
      .from(glAccounts)
      .where(input.id ? and(eq(glAccounts.code, code), ne(glAccounts.id, input.id)) : eq(glAccounts.code, code));
    if (dup) throw new DomainError('DUPLICATE_CODE', `รหัสบัญชี ${code} มีอยู่แล้ว`, 409);
    if (input.id) {
      const [cur] = await tx.select().from(glAccounts).where(eq(glAccounts.id, input.id));
      if (!cur) throw new DomainError('NOT_FOUND', 'ไม่พบบัญชี', 404);
      if (cur.systemKey && input.active === false) throw new DomainError('SYSTEM_ACCOUNT', 'บัญชีนี้ใช้ลงบัญชีอัตโนมัติ ปิดใช้งานไม่ได้', 409);
      await tx
        .update(glAccounts)
        .set({ code, name, type: input.type, active: input.active ?? cur.active, updatedAt: new Date() })
        .where(eq(glAccounts.id, input.id));
      return input.id;
    }
    const [row] = await tx.insert(glAccounts).values({ code, name, type: input.type }).returning();
    return row!.id;
  });
}

/** Points an automatic posting at another account of the chart; past entries keep theirs */
export async function setSystemAccount(db: Db, actor: SessionUser, key: SystemAccountKey, accountId: string): Promise<void> {
  assertCan(actor, 'gl.manage');
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(glAccounts).where(eq(glAccounts.id, accountId));
    if (!target) throw new DomainError('NOT_FOUND', 'ไม่พบบัญชี', 404);
    if (target.systemKey && target.systemKey !== key) throw new DomainError('SYSTEM_ACCOUNT', 'บัญชีนี้ใช้กับการลงบัญชีอัตโนมัติรายการอื่นอยู่แล้ว', 409);
    await tx.update(glAccounts).set({ systemKey: null, updatedAt: new Date() }).where(eq(glAccounts.systemKey, key));
    await tx.update(glAccounts).set({ systemKey: key, active: true, updatedAt: new Date() }).where(eq(glAccounts.id, accountId));
  });
}

// ---------------------------------------------------------------- journal and reports

export interface JournalFilter {
  from?: string;
  to?: string;
  book?: string;
  source?: string;
  q?: string;
  includeVoid?: boolean;
  page?: number;
  pageSize?: number;
}

export interface JournalLineDto {
  code: string;
  name: string;
  debit: number;
  credit: number;
  memo: string;
}

export interface JournalEntryDto {
  id: string;
  number: string;
  date: string;
  book: string;
  sourceType: JournalSource;
  sourceId: string | null;
  sourceNumber: string;
  description: string;
  partyName: string;
  total: number;
  status: 'POSTED' | 'VOID';
  voidReason: string | null;
  lines: JournalLineDto[];
}

function journalWhere(f: JournalFilter): SQL | undefined {
  const conds: SQL[] = [];
  if (!f.includeVoid) conds.push(eq(journalEntries.status, 'POSTED'));
  if (f.from) conds.push(gte(journalEntries.entryDate, f.from));
  if (f.to) conds.push(lte(journalEntries.entryDate, f.to));
  if (f.book) conds.push(eq(journalEntries.book, f.book as never));
  if (f.source) conds.push(eq(journalEntries.sourceType, f.source as never));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q}%`;
    conds.push(or(ilike(journalEntries.number, like), ilike(journalEntries.sourceNumber, like), ilike(journalEntries.partyName, like), ilike(journalEntries.description, like))!);
  }
  return conds.length ? and(...conds) : undefined;
}

export async function listJournal(db: Db, actor: SessionUser, f: JournalFilter): Promise<{ rows: JournalEntryDto[]; total: number; page: number; pageSize: number }> {
  assertCan(actor, 'gl.view');
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 5000);
  const page = Math.max(f.page ?? 1, 1);
  const where = journalWhere(f);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(journalEntries).where(where);
  const entries = await db
    .select()
    .from(journalEntries)
    .where(where)
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.number))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const lines = entries.length
    ? await db
        .select({ entryId: journalLines.entryId, sort: journalLines.sort, code: glAccounts.code, name: glAccounts.name, debit: journalLines.debit, credit: journalLines.credit, memo: journalLines.memo })
        .from(journalLines)
        .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
        .where(inArray(journalLines.entryId, entries.map((e) => e.id)))
        .orderBy(asc(journalLines.sort))
    : [];
  const byEntry = new Map<string, JournalLineDto[]>();
  for (const l of lines) {
    const arr = byEntry.get(l.entryId) ?? [];
    arr.push({ code: l.code, name: l.name, debit: Number(l.debit), credit: Number(l.credit), memo: l.memo });
    byEntry.set(l.entryId, arr);
  }
  return {
    total: n,
    page,
    pageSize,
    rows: entries.map((e) => ({
      id: e.id,
      number: e.number,
      date: e.entryDate,
      book: e.book,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceNumber: e.sourceNumber,
      description: e.description,
      partyName: e.partyName,
      total: Number(e.total),
      status: e.status,
      voidReason: e.voidReason,
      lines: byEntry.get(e.id) ?? [],
    })),
  };
}

/** Where the document behind a journal entry opens */
export function sourceHref(e: { sourceType: JournalSource; sourceId: string | null }, extra: { poId?: string; invoiceId?: string; kind?: SalesDocKind } = {}): string | null {
  if (!e.sourceId) return null;
  switch (e.sourceType) {
    case 'PV':
      return `/pv/${e.sourceId}`;
    case 'AR_INVOICE':
      return `/ar/invoices/${e.sourceId}`;
    case 'AR_RECEIPT':
    case 'AR_CREDIT_NOTE':
      return extra.invoiceId ? `/ar/invoices/${extra.invoiceId}` : null;
    case 'AP_INVOICE':
      return `/invoices/${e.sourceId}`;
    case 'AP_CREDIT_NOTE':
      return extra.invoiceId ? `/invoices/${extra.invoiceId}` : null;
    case 'SALES_DOC':
      return extra.kind ? `/sales/${SALES_DOC_META[extra.kind].slug}/${e.sourceId}` : null;
    default:
      return null;
  }
}

/** งบทดลอง: every account's balance brought forward, movement in the period and closing balance */
export async function trialBalance(db: Db, actor: SessionUser, range: { from: string; to: string }): Promise<{ rows: TrialBalanceRow[]; totals: Omit<TrialBalanceRow, 'accountId' | 'code' | 'name' | 'type'> }> {
  assertCan(actor, 'gl.view');
  const [accounts, opening, period] = await Promise.all([
    db.select().from(glAccounts).orderBy(asc(glAccounts.code)),
    db
      .select({ accountId: journalLines.accountId, net: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalEntries.status, 'POSTED'), lt(journalEntries.entryDate, range.from)))
      .groupBy(journalLines.accountId),
    db
      .select({ accountId: journalLines.accountId, debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalEntries.status, 'POSTED'), gte(journalEntries.entryDate, range.from), lte(journalEntries.entryDate, range.to)))
      .groupBy(journalLines.accountId),
  ]);
  const openBy = new Map(opening.map((o) => [o.accountId, D(o.net)]));
  const periodBy = new Map(period.map((p) => [p.accountId, p]));
  const rows: TrialBalanceRow[] = [];
  for (const a of accounts) {
    const open = openBy.get(a.id) ?? D(0);
    const p = periodBy.get(a.id);
    const pd = D(p?.debit ?? 0);
    const pc = D(p?.credit ?? 0);
    if (open.isZero() && pd.isZero() && pc.isZero()) continue;
    const o = sideOf(open);
    const c = sideOf(open.plus(pd).minus(pc));
    rows.push({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      openingDebit: o.debit,
      openingCredit: o.credit,
      periodDebit: pd.toNumber(),
      periodCredit: pc.toNumber(),
      closingDebit: c.debit,
      closingCredit: c.credit,
    });
  }
  const t = (k: keyof Omit<TrialBalanceRow, 'accountId' | 'code' | 'name' | 'type'>) => round2(sum(rows.map((r) => D(r[k])))).toNumber();
  return {
    rows,
    totals: {
      openingDebit: t('openingDebit'),
      openingCredit: t('openingCredit'),
      periodDebit: t('periodDebit'),
      periodCredit: t('periodCredit'),
      closingDebit: t('closingDebit'),
      closingCredit: t('closingCredit'),
    },
  };
}

/** บัญชีแยกประเภท: one account's lines with a running balance */
export async function accountLedger(db: Db, actor: SessionUser, accountId: string, range: { from: string; to: string }) {
  assertCan(actor, 'gl.view');
  const [account] = await db.select().from(glAccounts).where(eq(glAccounts.id, accountId));
  if (!account) throw new DomainError('NOT_FOUND', 'ไม่พบบัญชี', 404);
  const [open] = await db
    .select({ net: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.status, 'POSTED'), lt(journalEntries.entryDate, range.from)));
  const lines = await db
    .select({ e: journalEntries, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.status, 'POSTED'), gte(journalEntries.entryDate, range.from), lte(journalEntries.entryDate, range.to)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.number));
  let running = D(open?.net ?? 0);
  const opening = running.toNumber();
  return {
    account,
    opening,
    rows: lines.map((l) => {
      running = running.plus(D(l.debit)).minus(D(l.credit));
      return {
        id: l.e.id,
        date: l.e.entryDate,
        number: l.e.number,
        sourceNumber: l.e.sourceNumber,
        description: l.e.description,
        partyName: l.e.partyName,
        debit: Number(l.debit),
        credit: Number(l.credit),
        balance: running.toNumber(),
      };
    }),
    closing: running.toNumber(),
  };
}
