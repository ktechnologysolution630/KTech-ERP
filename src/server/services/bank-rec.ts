import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { bankRecLines, bankReconciliations, glAccounts, journalEntries, journalLines, users, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, round2, sum } from '@/domain/money';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';

/**
 * กระทบยอดเงินฝากธนาคาร (Express: การเงิน › ธนาคาร). Each bank statement is matched against the posted lines of
 * one cash/bank account: the lines that appear on the statement are ticked, and what stays unticked is money
 * in transit (cheques not yet presented, deposits not yet credited). A statement saves only when the ticked
 * lines bring the reconciled balance to the statement balance exactly.
 */

export interface BankRecLine {
  id: string;
  date: string;
  number: string;
  description: string;
  partyName: string;
  /** Money in (debit) positive, money out negative */
  amount: number;
}

export interface BankRecView {
  account: { id: string; code: string; name: string };
  statementDate: string;
  /** Book balance of the account on the statement date */
  bookBalance: number;
  /** What all earlier reconciliations already matched */
  reconciledBalance: number;
  /** Posted lines up to the statement date not reconciled yet */
  open: BankRecLine[];
  lastStatement: { date: string; balance: number } | null;
}

/** The cash and bank accounts a statement can be reconciled against */
export async function listCashAccounts(db: Db, actor: SessionUser) {
  assertCan(actor, 'gl.view');
  const rows = await db.select().from(glAccounts).where(and(eq(glAccounts.type, 'ASSET'), eq(glAccounts.active, true))).orderBy(asc(glAccounts.code));
  // Cash and bank first (11xx), then the rest of the assets for companies with their own numbering
  return rows
    .filter((a) => a.systemKey === 'BANK' || a.systemKey === 'CASH' || a.code.startsWith('11'))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, isBank: a.systemKey === 'BANK' }));
}

const lineNet = sql<string>`${journalLines.debit} - ${journalLines.credit}`;

async function reconciledBalance(tx: Db, accountId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(bankRecLines)
    .innerJoin(journalLines, eq(journalLines.id, bankRecLines.journalLineId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.status, 'POSTED')));
  return round2(D(row?.total ?? 0)).toNumber();
}

export async function getBankRecView(db: Db, actor: SessionUser, accountId: string, statementDate: string): Promise<BankRecView> {
  assertCan(actor, 'gl.view');
  const [account] = await db.select({ id: glAccounts.id, code: glAccounts.code, name: glAccounts.name }).from(glAccounts).where(eq(glAccounts.id, accountId));
  if (!account) throw new DomainError('NOT_FOUND', 'ไม่พบบัญชี', 404);
  const [book] = await db
    .select({ total: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.status, 'POSTED'), lte(journalEntries.entryDate, statementDate)));
  const open = await db
    .select({ id: journalLines.id, date: journalEntries.entryDate, number: journalEntries.sourceNumber, jv: journalEntries.number, description: journalEntries.description, partyName: journalEntries.partyName, net: lineNet })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .leftJoin(bankRecLines, eq(bankRecLines.journalLineId, journalLines.id))
    .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.status, 'POSTED'), lte(journalEntries.entryDate, statementDate), isNull(bankRecLines.id)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.number));
  const [last] = await db
    .select({ date: bankReconciliations.statementDate, balance: bankReconciliations.statementBalance })
    .from(bankReconciliations)
    .where(eq(bankReconciliations.accountId, accountId))
    .orderBy(desc(bankReconciliations.statementDate), desc(bankReconciliations.createdAt))
    .limit(1);
  return {
    account,
    statementDate,
    bookBalance: round2(D(book?.total ?? 0)).toNumber(),
    reconciledBalance: await reconciledBalance(db, accountId),
    open: open.map((l) => ({ id: l.id, date: l.date, number: l.number || l.jv, description: l.description, partyName: l.partyName, amount: round2(D(l.net)).toNumber() })),
    lastStatement: last ? { date: last.date, balance: Number(last.balance) } : null,
  };
}

const saveSchema = z.object({
  accountId: z.string().uuid(),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง'),
  statementBalance: z.number().finite().min(-10_000_000_000_000).max(10_000_000_000_000),
  lineIds: z.array(z.string().uuid()).max(5000),
  note: z.string().trim().max(500).optional(),
});

export type SaveBankRecInput = z.input<typeof saveSchema>;

/** Saves a statement with the lines ticked on it; refused unless the reconciled balance meets the statement */
export async function saveBankReconciliation(db: Db, actor: SessionUser, input: SaveBankRecInput): Promise<string> {
  assertCan(actor, 'gl.manage');
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION', parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', 400);
  const d = parsed.data;
  const ids = [...new Set(d.lineIds)];
  return db.transaction(async (tx) => {
    const lines = ids.length
      ? await tx
          .select({ id: journalLines.id, net: lineNet, accountId: journalLines.accountId, date: journalEntries.entryDate, status: journalEntries.status, done: bankRecLines.id })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
          .leftJoin(bankRecLines, eq(bankRecLines.journalLineId, journalLines.id))
          .where(inArray(journalLines.id, ids))
      : [];
    if (lines.length !== ids.length) throw new DomainError('NOT_FOUND', 'ไม่พบบางรายการ ลองโหลดหน้าใหม่', 404);
    for (const l of lines) {
      if (l.accountId !== d.accountId || l.status !== 'POSTED' || l.date > d.statementDate) throw new DomainError('VALIDATION', 'มีรายการที่ไม่อยู่ในบัญชีหรือช่วงวันที่นี้', 400);
      if (l.done) throw new DomainError('ALREADY_RECONCILED', 'มีรายการที่กระทบยอดไปแล้ว ลองโหลดหน้าใหม่', 409);
    }
    const before = D(await reconciledBalance(tx, d.accountId));
    const after = round2(before.plus(sum(lines.map((l) => D(l.net)))));
    const statement = round2(D(d.statementBalance));
    if (!after.eq(statement)) {
      throw new DomainError('REC_DIFFERENCE', `ยอดที่กระทบแล้ว ${after.toFixed(2)} ไม่ตรงกับยอดตาม Statement ${statement.toFixed(2)} (ต่าง ${statement.minus(after).toFixed(2)})`, 409);
    }
    const [book] = await tx
      .select({ total: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalLines.accountId, d.accountId), eq(journalEntries.status, 'POSTED'), lte(journalEntries.entryDate, d.statementDate)));
    const [rec] = await tx
      .insert(bankReconciliations)
      .values({ accountId: d.accountId, statementDate: d.statementDate, statementBalance: statement.toFixed(2), bookBalance: round2(D(book?.total ?? 0)).toFixed(2), note: d.note ?? '', createdBy: actor.id })
      .returning();
    if (ids.length) await tx.insert(bankRecLines).values(ids.map((journalLineId) => ({ reconciliationId: rec!.id, journalLineId })));
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: rec!.id, action: 'BANK_RECONCILED', userId: actor.id, note: `กระทบยอด Statement ${d.statementDate} ยอด ${statement.toFixed(2)} (${ids.length} รายการ)` });
    return rec!.id;
  });
}

/** Undoes the latest statement of an account, so its lines can be ticked again */
export async function undoLastReconciliation(db: Db, actor: SessionUser, accountId: string): Promise<void> {
  assertCan(actor, 'gl.manage');
  await db.transaction(async (tx) => {
    const [last] = await tx
      .select()
      .from(bankReconciliations)
      .where(eq(bankReconciliations.accountId, accountId))
      .orderBy(desc(bankReconciliations.statementDate), desc(bankReconciliations.createdAt))
      .limit(1);
    if (!last) throw new DomainError('NOT_FOUND', 'ยังไม่มีการกระทบยอดของบัญชีนี้', 404);
    await tx.delete(bankReconciliations).where(eq(bankReconciliations.id, last.id));
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: last.id, action: 'BANK_REC_UNDONE', userId: actor.id, note: `ยกเลิกกระทบยอด Statement ${last.statementDate}` });
  });
}

export async function listReconciliations(db: Db, actor: SessionUser, accountId: string) {
  assertCan(actor, 'gl.view');
  const rows = await db
    .select({ r: bankReconciliations, by: users.name, lines: sql<number>`(select count(*) from ${bankRecLines} where ${bankRecLines.reconciliationId} = ${bankReconciliations.id})` })
    .from(bankReconciliations)
    .leftJoin(users, eq(users.id, bankReconciliations.createdBy))
    .where(eq(bankReconciliations.accountId, accountId))
    .orderBy(desc(bankReconciliations.statementDate), desc(bankReconciliations.createdAt));
  return rows.map((x) => ({
    id: x.r.id,
    statementDate: x.r.statementDate,
    statementBalance: Number(x.r.statementBalance),
    bookBalance: Number(x.r.bookBalance),
    lines: Number(x.lines),
    by: x.by,
  }));
}
