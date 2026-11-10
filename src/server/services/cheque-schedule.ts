import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { invoices, payables, poInstallments, pos, pvs, vendors, type SessionUser } from '@/db/schema';
import { D, round2, sum } from '@/domain/money';
import { type ChequeStatus, type PayMethod } from '@/domain/payment-terms';
import { assertCan } from '@/server/policy';

export interface DueBill {
  id: string;
  vendorId: string;
  vendorName: string;
  payMethod: PayMethod;
  poNumber: string | null;
  docRef: string;
  gross: string;
  status: 'OPEN' | 'IN_PV';
}

export interface DueGroup {
  dueDate: string;
  overdue: boolean;
  total: string;
  chequeCount: number;
  bills: DueBill[];
}

export interface OutstandingCheque {
  pvId: string;
  pvNumber: string;
  vendorName: string;
  chequeNo: string | null;
  chequeBank: string | null;
  chequeDate: string | null;
  status: ChequeStatus;
  collectedBy: string | null;
  net: string;
}

/**
 * Bills awaiting payment grouped by the day they fall due (the cheque round), up to `until`,
 * and cheques already written that the vendor has not collected or that have not cleared.
 */
export async function getChequeSchedule(db: Db, actor: SessionUser, opts: { today: string; until: string }) {
  assertCan(actor, 'pv.manage');

  const rows = await db
    .select({
      id: payables.id,
      dueDate: payables.dueDate,
      status: payables.status,
      gross: payables.gross,
      note: payables.note,
      vendorId: vendors.id,
      vendorName: vendors.name,
      vendorPayMethod: vendors.defaultPayMethod,
      poPayMethod: pos.payMethod,
      poNumber: pos.number,
      invoiceNo: invoices.invoiceNo,
      installmentName: poInstallments.name,
    })
    .from(payables)
    .innerJoin(vendors, eq(vendors.id, payables.vendorId))
    .leftJoin(pos, eq(pos.id, payables.poId))
    .leftJoin(invoices, eq(invoices.id, payables.invoiceId))
    .leftJoin(poInstallments, eq(poInstallments.id, payables.installmentId))
    .where(and(inArray(payables.status, ['OPEN', 'IN_PV']), lte(payables.dueDate, opts.until)))
    .orderBy(asc(payables.dueDate), asc(vendors.name));

  const groups = new Map<string, DueBill[]>();
  for (const r of rows) {
    const list = groups.get(r.dueDate) ?? [];
    list.push({
      id: r.id,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      payMethod: r.poPayMethod ?? r.vendorPayMethod,
      poNumber: r.poNumber ?? null,
      docRef: r.invoiceNo ?? r.installmentName ?? r.note,
      gross: r.gross,
      status: r.status as 'OPEN' | 'IN_PV',
    });
    groups.set(r.dueDate, list);
  }
  const due: DueGroup[] = [...groups.entries()].map(([dueDate, bills]) => ({
    dueDate,
    overdue: dueDate < opts.today,
    total: round2(sum(bills.map((b) => D(b.gross)))).toFixed(2),
    // One cheque per vendor per round
    chequeCount: new Set(bills.filter((b) => b.payMethod === 'CHEQUE').map((b) => b.vendorId)).size,
    bills,
  }));

  const chequeRows = await db
    .select({
      pvId: pvs.id,
      pvNumber: pvs.number,
      vendorName: vendors.name,
      chequeNo: pvs.chequeNo,
      chequeBank: pvs.chequeBank,
      chequeDate: pvs.chequeDate,
      status: pvs.chequeStatus,
      collectedBy: pvs.chequeCollectedBy,
      net: pvs.net,
    })
    .from(pvs)
    .innerJoin(vendors, eq(vendors.id, pvs.vendorId))
    .where(and(eq(pvs.status, 'PAID'), eq(pvs.payMethod, 'CHEQUE'), inArray(pvs.chequeStatus, ['ISSUED', 'COLLECTED'])))
    .orderBy(asc(pvs.chequeDate));
  const cheques: OutstandingCheque[] = chequeRows.map((c) => ({ ...c, status: c.status! }));

  return {
    due,
    cheques,
    totalDue: round2(sum(due.map((g) => D(g.total)))).toFixed(2),
    totalOverdue: round2(sum(due.filter((g) => g.overdue).map((g) => D(g.total)))).toFixed(2),
  };
}
