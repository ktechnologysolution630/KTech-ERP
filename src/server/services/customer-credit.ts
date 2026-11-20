import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { arCreditNotes, arInvoices, arReceipts, customers, users, type SessionUser } from '@/db/schema';
import { D, round2, type Decimal } from '@/domain/money';
import { assertCan } from '@/server/policy';

/**
 * วงเงินเครดิตลูกค้า (Express: เตือนเกินวงเงินเครดิต). A customer's outstanding is what their issued bills still
 * owe after receipts, withholding tax and credit notes. Going over the limit is a warning, not a block: the
 * person issuing the bill decides. Kept apart from bill issuing so it can be shown wherever a bill is made.
 */

/** Outstanding of each customer, from issued and part-paid bills */
export async function customerOutstanding(db: Db, customerIds?: string[]): Promise<Map<string, number>> {
  if (customerIds && customerIds.length === 0) return new Map();
  const open = inArray(arInvoices.status, ['ISSUED', 'PARTIAL']);
  const where = customerIds ? and(open, inArray(arInvoices.customerId, customerIds)) : open;
  const [billed, received, credited] = await Promise.all([
    db.select({ c: arInvoices.customerId, v: sql<string>`coalesce(sum(${arInvoices.gross}), 0)` }).from(arInvoices).where(where).groupBy(arInvoices.customerId),
    db
      .select({ c: arInvoices.customerId, v: sql<string>`coalesce(sum(${arReceipts.amountReceived} + ${arReceipts.whtAmount}), 0)` })
      .from(arReceipts)
      .innerJoin(arInvoices, eq(arInvoices.id, arReceipts.invoiceId))
      .where(and(where, eq(arReceipts.voided, false)))
      .groupBy(arInvoices.customerId),
    db
      .select({ c: arInvoices.customerId, v: sql<string>`coalesce(sum(${arCreditNotes.gross}), 0)` })
      .from(arCreditNotes)
      .innerJoin(arInvoices, eq(arInvoices.id, arCreditNotes.invoiceId))
      .where(and(where, eq(arCreditNotes.voided, false)))
      .groupBy(arInvoices.customerId),
  ]);
  const out = new Map<string, Decimal>();
  for (const r of billed) out.set(r.c, D(r.v));
  for (const r of received) out.set(r.c, (out.get(r.c) ?? D(0)).minus(r.v));
  for (const r of credited) out.set(r.c, (out.get(r.c) ?? D(0)).minus(r.v));
  return new Map([...out].map(([k, v]) => [k, round2(v.isNegative() ? D(0) : v).toNumber()]));
}

export interface CreditCheck {
  limit: number;
  outstanding: number;
  /** Outstanding once the bill in hand is issued */
  after: number;
  over: boolean;
  overBy: number;
}

/** Whether issuing `extra` more to the customer takes them over their limit; null when they have none */
export async function checkCustomerCredit(db: Db, actor: SessionUser, customerId: string, extra = 0): Promise<CreditCheck | null> {
  assertCan(actor, 'ar.manage');
  const [c] = await db.select({ limit: customers.creditLimit }).from(customers).where(eq(customers.id, customerId));
  const limit = Number(c?.limit ?? 0);
  if (!c || limit <= 0) return null;
  const outstanding = (await customerOutstanding(db, [customerId])).get(customerId) ?? 0;
  const after = round2(D(outstanding).plus(extra)).toNumber();
  const overBy = round2(D(after).minus(limit)).toNumber();
  return { limit, outstanding, after, over: overBy > 0, overBy: Math.max(0, overBy) };
}

/** People who can be named พนักงานขาย: active users */
export async function listSalespeople(db: Db, actor: SessionUser) {
  assertCan(actor, 'ar.manage');
  return db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name));
}

/** ยอดขายตามพนักงานขาย: issued bills (before VAT) in a date range, by the customer's salesperson */
export async function salesBySalesperson(db: Db, actor: SessionUser, range: { from: string; to: string }) {
  assertCan(actor, 'ar.manage');
  const rows = await db
    .select({
      salespersonId: customers.salespersonId,
      name: users.name,
      bills: sql<number>`count(*)`,
      beforeVat: sql<string>`coalesce(sum(${arInvoices.beforeVat}), 0)`,
    })
    .from(arInvoices)
    .innerJoin(customers, eq(customers.id, arInvoices.customerId))
    .leftJoin(users, eq(users.id, customers.salespersonId))
    .where(and(inArray(arInvoices.status, ['ISSUED', 'PARTIAL', 'PAID']), eq(arInvoices.isOpening, false), sql`${arInvoices.docDate} between ${range.from} and ${range.to}`))
    .groupBy(customers.salespersonId, users.name);
  return rows
    .map((r) => ({ salespersonId: r.salespersonId, name: r.name ?? 'ไม่ระบุพนักงานขาย', bills: Number(r.bills), beforeVat: round2(D(r.beforeVat)).toNumber() }))
    .sort((a, b) => b.beforeVat - a.beforeVat);
}
