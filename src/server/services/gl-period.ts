import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { glAccounts, glClosings, journalEntries, journalLines, users, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, round2, sum } from '@/domain/money';
import { assertCan, can } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';

/**
 * ปิดงวด / ปิดบัญชีสิ้นปี. Closing locks the books up to a date: no journal entry dated on or before it may be
 * posted, changed or voided, so every document that posts (bills, vouchers, receipts, sales documents) is
 * refused a change in a closed month. Closings stack; only the latest one can be reopened, by the owner or admin.
 */

/** The last day the books are closed through, or null when nothing is closed */
export async function closedThrough(tx: Db): Promise<string | null> {
  const [row] = await tx
    .select({ d: sql<string | null>`max(${glClosings.closedThrough})` })
    .from(glClosings)
    .where(isNull(glClosings.reopenedAt));
  return row?.d ?? null;
}

/** Refuses a posting dated in a closed period. Called by the journal before it writes anything. */
export async function assertPeriodOpen(tx: Db, date: string): Promise<void> {
  const through = await closedThrough(tx);
  if (through && date <= through) {
    throw new DomainError('PERIOD_CLOSED', `ปิดงวดบัญชีถึงวันที่ ${through} แล้ว ไม่สามารถบันทึกหรือแก้ไขรายการวันที่ ${date} ได้ ให้ลงวันที่ในงวดที่เปิดอยู่ หรือขอให้เจ้าของเปิดงวด`, 409);
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');

const lastDayOfMonth = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};

/** ปิดงวด: closes the books through the end of the month of `through` */
export async function closePeriod(db: Db, actor: SessionUser, input: { through: string; note?: string }): Promise<string> {
  assertCan(actor, 'gl.manage');
  const parsed = isoDate.safeParse(input.through);
  if (!parsed.success) throw new DomainError('VALIDATION', 'รูปแบบวันที่ไม่ถูกต้อง', 400);
  const through = lastDayOfMonth(parsed.data);
  return db.transaction(async (tx) => {
    const current = await closedThrough(tx);
    if (current && through <= current) throw new DomainError('ALREADY_CLOSED', `ปิดงวดถึง ${current} อยู่แล้ว`, 409);
    const [row] = await tx.insert(glClosings).values({ closedThrough: through, kind: 'PERIOD', note: input.note?.trim() ?? '', closedBy: actor.id }).returning();
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: row!.id, action: 'PERIOD_CLOSED', userId: actor.id, note: `ปิดงวดถึง ${through}` });
    return through;
  });
}

/** Income and expense balances up to a date, net debit-positive, for the accounts that have one */
async function profitAndLoss(tx: Db, through: string) {
  const rows = await tx
    .select({
      accountId: journalLines.accountId,
      net: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.status, 'POSTED'), lte(journalEntries.entryDate, through), inArray(glAccounts.type, ['INCOME', 'EXPENSE'])))
    .groupBy(journalLines.accountId);
  return rows.map((r) => ({ accountId: r.accountId, net: round2(D(r.net)) })).filter((r) => !r.net.isZero());
}

/** What the year-end closing would move: net profit (positive) or loss of the year */
export async function previewYearClose(db: Db, actor: SessionUser, year: number): Promise<{ through: string; netProfit: number; accounts: number }> {
  assertCan(actor, 'gl.view');
  const through = `${year}-12-31`;
  const pl = await profitAndLoss(db, through);
  return { through, netProfit: round2(sum(pl.map((r) => r.net)).neg()).toNumber(), accounts: pl.length };
}

/**
 * ปิดบัญชีสิ้นปี: moves every income and expense balance into กำไร(ขาดทุน)สะสม with one entry dated 31 Dec,
 * then closes the books through that day.
 */
export async function closeYear(db: Db, actor: SessionUser, year: number): Promise<{ entryId: string | null; netProfit: number }> {
  assertCan(actor, 'gl.manage');
  if (!Number.isInteger(year) || year < 2000 || year > 2600) throw new DomainError('VALIDATION', 'ปีไม่ถูกต้อง', 400);
  const through = `${year}-12-31`;
  return db.transaction(async (tx) => {
    const current = await closedThrough(tx);
    if (current && through <= current) throw new DomainError('ALREADY_CLOSED', `ปิดงวดถึง ${current} อยู่แล้ว`, 409);
    const [re] = await tx.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.systemKey, 'RETAINED_EARNINGS'));
    if (!re) throw new DomainError('GL_ACCOUNT_MISSING', 'ยังไม่ได้กำหนดบัญชี "กำไร(ขาดทุน)สะสม" ในผังบัญชี', 409);

    const pl = await profitAndLoss(tx, through);
    const total = round2(sum(pl.map((r) => r.net)));
    const netProfit = total.neg();
    let entryId: string | null = null;
    if (pl.length > 0) {
      const lines = pl.map((r) => ({ accountId: r.accountId, debit: r.net.isNegative() ? r.net.abs() : D(0), credit: r.net.isPositive() ? r.net : D(0), memo: 'ปิดบัญชีสิ้นปี' }));
      if (!netProfit.isZero()) {
        lines.push({ accountId: re.id, debit: netProfit.isNegative() ? netProfit.abs() : D(0), credit: netProfit.isPositive() ? netProfit : D(0), memo: netProfit.isPositive() ? 'กำไรสุทธิประจำปี' : 'ขาดทุนสุทธิประจำปี' });
      }
      const number = await nextDocNumber(tx, 'JV', new Date(`${through}T12:00:00+07:00`));
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          number,
          entryDate: through,
          book: 'GL',
          sourceType: 'YEAR_CLOSE',
          sourceNumber: `ปิดบัญชีปี ${year}`,
          description: `ปิดบัญชีรายได้และค่าใช้จ่ายเข้ากำไร(ขาดทุน)สะสม ปี ${year}`,
          total: round2(sum(lines.map((l) => l.debit))).toFixed(2),
          createdBy: actor.id,
        })
        .returning();
      entryId = entry!.id;
      await tx.insert(journalLines).values(lines.map((l, i) => ({ entryId: entry!.id, accountId: l.accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), memo: l.memo, sort: i })));
    }
    const [row] = await tx.insert(glClosings).values({ closedThrough: through, kind: 'YEAR', yearCloseEntryId: entryId, note: `ปิดบัญชีปี ${year}`, closedBy: actor.id }).returning();
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: row!.id, action: 'YEAR_CLOSED', userId: actor.id, note: `ปิดบัญชีปี ${year} กำไรสุทธิ ${netProfit.toFixed(2)}` });
    return { entryId, netProfit: netProfit.toNumber() };
  });
}

/** เปิดงวด: undoes the latest closing (and voids its year-end entry). Owner or admin only. */
export async function reopenLatest(db: Db, actor: SessionUser, reason: string): Promise<void> {
  assertCan(actor, 'gl.manage');
  if (!can(actor, 'data.delete')) throw new DomainError('FORBIDDEN', 'เปิดงวดที่ปิดแล้วได้เฉพาะเจ้าของหรือผู้ดูแลระบบ', 403);
  const why = reason.trim();
  if (!why) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่เปิดงวด', 400);
  await db.transaction(async (tx) => {
    const [latest] = await tx.select().from(glClosings).where(isNull(glClosings.reopenedAt)).orderBy(desc(glClosings.closedThrough), desc(glClosings.createdAt)).limit(1);
    if (!latest) throw new DomainError('NOT_FOUND', 'ยังไม่มีงวดที่ปิด', 404);
    await tx.update(glClosings).set({ reopenedAt: new Date(), reopenedBy: actor.id, reopenReason: why }).where(eq(glClosings.id, latest.id));
    if (latest.yearCloseEntryId) {
      await tx.update(journalEntries).set({ status: 'VOID', voidedAt: new Date(), voidReason: `เปิดงวด: ${why}` }).where(eq(journalEntries.id, latest.yearCloseEntryId));
    }
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: latest.id, action: 'PERIOD_REOPENED', userId: actor.id, note: `เปิดงวดที่ปิดถึง ${latest.closedThrough}: ${why}` });
  });
}

export interface GlClosingRow {
  id: string;
  closedThrough: string;
  kind: 'PERIOD' | 'YEAR';
  note: string;
  closedByName: string | null;
  createdAt: Date;
  reopenedAt: Date | null;
  reopenReason: string | null;
}

export async function listClosings(db: Db, actor: SessionUser): Promise<GlClosingRow[]> {
  assertCan(actor, 'gl.view');
  const rows = await db
    .select({ c: glClosings, closedByName: users.name })
    .from(glClosings)
    .leftJoin(users, eq(users.id, glClosings.closedBy))
    .orderBy(desc(glClosings.createdAt));
  return rows.map((r) => ({
    id: r.c.id,
    closedThrough: r.c.closedThrough,
    kind: r.c.kind,
    note: r.c.note,
    closedByName: r.closedByName,
    createdAt: r.c.createdAt,
    reopenedAt: r.c.reopenedAt,
    reopenReason: r.c.reopenReason,
  }));
}
