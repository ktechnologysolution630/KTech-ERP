import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  arCreditNotes,
  arInvoices,
  arReceipts,
  customers,
  invoices,
  payables,
  pos,
  projects,
  pvLines,
  pvs,
  salesDocs,
  stockDocs,
  vendors,
  whtCerts,
  type SessionUser,
} from '@/db/schema';
import { D, round2, sum } from '@/domain/money';
import { SALES_DOC_META, type SalesDocKind } from '@/domain/sales-doc';
import { assertCan } from '@/server/policy';

/** One money document as the accounting pages list it */
export interface LedgerRow {
  key: string;
  date: string;
  direction: 'IN' | 'OUT';
  docType: string;
  number: string;
  party: string;
  partyTaxId: string;
  projectId: string | null;
  projectName: string;
  category: string;
  /** Money received or paid after withholding */
  net: number;
  beforeVat: number;
  vat: number;
  wht: number;
  href: string;
}

const n = (v: string | number | null | undefined) => Number(v ?? 0);

/**
 * Money in and out between two dates (inclusive): receipts against invoices, receipts, income
 * vouchers and abbreviated tax invoices in; paid vouchers (PV) and payment vouchers out. A PV paid
 * for several projects is split per project.
 */
export async function listLedger(db: Db, actor: SessionUser, range: { from: string; to: string; projectId?: string | null }): Promise<LedgerRow[]> {
  assertCan(actor, 'ar.manage');
  const { from, to } = range;
  const [rcRows, sales, pvRows, projectRows] = await Promise.all([
    db
      .select({ r: arReceipts, customerName: customers.name, customerTaxId: customers.taxId, projectId: arInvoices.projectId, invoiceId: arInvoices.id })
      .from(arReceipts)
      .innerJoin(arInvoices, eq(arInvoices.id, arReceipts.invoiceId))
      .innerJoin(customers, eq(customers.id, arInvoices.customerId))
      .where(and(eq(arReceipts.voided, false), gte(arReceipts.receiptDate, from), lte(arReceipts.receiptDate, to))),
    db
      .select()
      .from(salesDocs)
      .where(and(eq(salesDocs.status, 'ISSUED'), inArray(salesDocs.kind, ['RC', 'INC', 'STI', 'EXP']), gte(salesDocs.docDate, from), lte(salesDocs.docDate, to))),
    db
      .select({ pv: pvs, vendorName: vendors.name, vendorTaxId: vendors.taxId, line: pvLines, projectId: payables.projectId })
      .from(pvs)
      .innerJoin(vendors, eq(vendors.id, pvs.vendorId))
      .innerJoin(pvLines, eq(pvLines.pvId, pvs.id))
      .innerJoin(payables, eq(payables.id, pvLines.payableId))
      .where(and(eq(pvs.status, 'PAID'), gte(pvs.paidAt, from), lte(pvs.paidAt, to))),
    db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects),
  ]);
  const projectName = new Map(projectRows.map((p) => [p.id, `${p.code} ${p.name}`]));
  const name = (id: string | null) => (id ? (projectName.get(id) ?? '-') : 'สำนักงาน / ส่วนกลาง');
  const rows: LedgerRow[] = [];

  for (const { r, customerName, customerTaxId, projectId, invoiceId } of rcRows) {
    rows.push({
      key: `ar-${r.id}`,
      date: r.receiptDate,
      direction: 'IN',
      docType: 'ใบเสร็จรับเงิน (งวดงาน)',
      number: r.number,
      party: customerName,
      partyTaxId: customerTaxId ?? '',
      projectId,
      projectName: name(projectId),
      category: 'รายได้ค่าก่อสร้าง',
      net: n(r.amountReceived),
      beforeVat: n(r.beforeVat),
      vat: n(r.vat),
      wht: n(r.whtAmount),
      href: `/ar/invoices/${invoiceId}`,
    });
  }
  for (const d of sales) {
    const kind = d.kind as SalesDocKind;
    rows.push({
      key: `sd-${d.id}`,
      date: d.docDate,
      direction: kind === 'EXP' ? 'OUT' : 'IN',
      docType: SALES_DOC_META[kind].th,
      number: d.number,
      party: d.customerName,
      partyTaxId: d.customerTaxId,
      projectId: d.projectId,
      projectName: name(d.projectId),
      category: d.accountCategory || (kind === 'EXP' ? 'ค่าใช้จ่ายอื่น' : 'รายได้อื่น'),
      net: n(d.payable),
      beforeVat: n(d.beforeVat),
      vat: n(d.vat),
      wht: n(d.wht),
      href: `/sales/${SALES_DOC_META[kind].slug}/${d.id}`,
    });
  }
  // A PV per project it paid for
  const pvGroups = new Map<string, { pv: (typeof pvRows)[number]['pv']; vendorName: string; vendorTaxId: string | null; projectId: string | null; net: number; beforeVat: number; vat: number; wht: number }>();
  for (const { pv, vendorName, vendorTaxId, line, projectId } of pvRows) {
    const k = `${pv.id}|${projectId ?? ''}`;
    const g = pvGroups.get(k) ?? { pv, vendorName, vendorTaxId, projectId, net: 0, beforeVat: 0, vat: 0, wht: 0 };
    g.net += n(line.net);
    g.beforeVat += n(line.beforeVat);
    g.vat += n(line.vat);
    g.wht += n(line.wht);
    pvGroups.set(k, g);
  }
  for (const [k, g] of pvGroups) {
    rows.push({
      key: `pv-${k}`,
      date: g.pv.paidAt ?? g.pv.createdAt.toISOString().slice(0, 10),
      direction: 'OUT',
      docType: 'ใบสำคัญจ่าย (PV)',
      number: g.pv.number,
      party: g.vendorName,
      partyTaxId: g.vendorTaxId ?? '',
      projectId: g.projectId,
      projectName: name(g.projectId),
      category: 'ค่าวัสดุและผู้รับเหมา (จัดซื้อ)',
      net: round2(D(g.net)).toNumber(),
      beforeVat: round2(D(g.beforeVat)).toNumber(),
      vat: round2(D(g.vat)).toNumber(),
      wht: round2(D(g.wht)).toNumber(),
      href: `/pv/${g.pv.id}`,
    });
  }
  const filtered = range.projectId === undefined ? rows : rows.filter((r) => r.projectId === range.projectId);
  return filtered.sort((a, b) => (a.date === b.date ? a.number.localeCompare(b.number) : a.date < b.date ? 1 : -1));
}

const monthKey = (iso: string) => iso.slice(0, 7);
function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/** Figures for ภาพรวมบัญชี: this month against last, 12 months of money in and out, what is owed both ways */
export async function getAccountingOverview(db: Db, actor: SessionUser, opts: { today: string; projectId?: string | null }) {
  const months = lastMonths(opts.today, 12);
  const from = `${months[0]}-01`;
  const rows = await listLedger(db, actor, { from, to: opts.today, projectId: opts.projectId });
  const byMonth = months.map((m) => ({
    month: m,
    income: round2(sum(rows.filter((r) => r.direction === 'IN' && monthKey(r.date) === m).map((r) => D(r.net)))).toNumber(),
    expense: round2(sum(rows.filter((r) => r.direction === 'OUT' && monthKey(r.date) === m).map((r) => D(r.net)))).toNumber(),
  }));
  const thisMonth = byMonth[11]!;
  const lastMonth = byMonth[10]!;
  const change = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : 100) : Math.round(((now - before) / before) * 1000) / 10);
  const year = opts.today.slice(0, 4);
  const ytd = rows.filter((r) => r.date.startsWith(year));
  const ytdIncome = sum(ytd.filter((r) => r.direction === 'IN').map((r) => D(r.net))).toNumber();
  const ytdExpense = sum(ytd.filter((r) => r.direction === 'OUT').map((r) => D(r.net))).toNumber();
  const categories = new Map<string, number>();
  for (const r of rows.filter((x) => x.direction === 'OUT')) categories.set(r.category, (categories.get(r.category) ?? 0) + r.net);

  // Owed to us: issued invoices less what was received, withheld and credited
  const [openInvoices, openPayables] = await Promise.all([
    db
      .select({ gross: arInvoices.gross, id: arInvoices.id, projectId: arInvoices.projectId })
      .from(arInvoices)
      .where(inArray(arInvoices.status, ['ISSUED', 'PARTIAL'])),
    db
      .select({ gross: payables.gross, projectId: payables.projectId })
      .from(payables)
      .where(inArray(payables.status, ['OPEN', 'IN_PV'])),
  ]);
  const invIds = openInvoices.filter((i) => opts.projectId === undefined || i.projectId === opts.projectId).map((i) => i.id);
  const [received, credited] = invIds.length
    ? await Promise.all([
        db
          .select({ invoiceId: arReceipts.invoiceId, amount: arReceipts.amountReceived, wht: arReceipts.whtAmount })
          .from(arReceipts)
          .where(and(inArray(arReceipts.invoiceId, invIds), eq(arReceipts.voided, false))),
        db
          .select({ gross: arCreditNotes.gross })
          .from(arCreditNotes)
          .where(and(inArray(arCreditNotes.invoiceId, invIds), eq(arCreditNotes.voided, false))),
      ])
    : [[], []];
  const arOutstanding = round2(
    sum(openInvoices.filter((i) => invIds.includes(i.id)).map((i) => D(i.gross))).minus(sum(received.map((r) => D(r.amount).plus(D(r.wht))))).minus(sum(credited.map((c) => D(c.gross)))),
  ).toNumber();
  const apOutstanding = round2(sum(openPayables.filter((p) => opts.projectId === undefined || p.projectId === opts.projectId).map((p) => D(p.gross)))).toNumber();

  return {
    thisMonth,
    incomeChange: change(thisMonth.income, lastMonth.income),
    expenseChange: change(thisMonth.expense, lastMonth.expense),
    arOutstanding: Math.max(0, arOutstanding),
    apOutstanding,
    byMonth,
    ytdIncome,
    ytdExpense,
    ytdProfit: round2(D(ytdIncome).minus(ytdExpense)).toNumber(),
    margin: ytdIncome === 0 ? 0 : Math.round(((ytdIncome - ytdExpense) / ytdIncome) * 1000) / 10,
    categories: [...categories.entries()].map(([name, amount]) => ({ name, amount: round2(D(amount)).toNumber() })).sort((a, b) => b.amount - a.amount),
    recent: rows.slice(0, 20),
  };
}

export interface InputVatRow {
  key: string;
  date: string;
  number: string;
  source: string;
  vendorName: string;
  vendorTaxId: string;
  projectName: string;
  base: number;
  vat: number;
  total: number;
  href: string;
}

/**
 * ภาษีซื้อ of a month: tax invoices billed on POs, payment vouchers with VAT and stock receipts
 * with a tax invoice number. Cancelled documents are left out.
 */
export async function inputVatReport(db: Db, actor: SessionUser, year: number, month: number) {
  assertCan(actor, 'ar.manage');
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const [inv, exp, gr, projectRows] = await Promise.all([
    db
      .select({ i: invoices, vendorName: vendors.name, vendorTaxId: vendors.taxId, projectId: pos.projectId })
      .from(invoices)
      .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
      .innerJoin(pos, eq(pos.id, invoices.poId))
      .where(and(eq(invoices.status, 'ACTIVE'), eq(invoices.isTaxInvoice, true), gte(invoices.invoiceDate, from), lte(invoices.invoiceDate, to))),
    db
      .select()
      .from(salesDocs)
      .where(and(eq(salesDocs.kind, 'EXP'), eq(salesDocs.status, 'ISSUED'), ne(salesDocs.vat, '0.00'), gte(salesDocs.docDate, from), lte(salesDocs.docDate, to))),
    db
      .select()
      .from(stockDocs)
      .where(and(eq(stockDocs.type, 'RECEIVE'), ne(stockDocs.vat, '0.00'), ne(stockDocs.taxInvoiceNo, ''), gte(stockDocs.docDate, from), lte(stockDocs.docDate, to))),
    db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects),
  ]);
  const projectName = new Map(projectRows.map((p) => [p.id, `${p.code} ${p.name}`]));
  const name = (id: string | null) => (id ? (projectName.get(id) ?? '-') : 'สำนักงาน / ส่วนกลาง');
  const rows: InputVatRow[] = [
    ...inv.map(({ i, vendorName, vendorTaxId, projectId }) => ({
      key: `inv-${i.id}`,
      date: i.invoiceDate,
      number: i.invoiceNo,
      source: 'ใบกำกับภาษีตาม PO',
      vendorName,
      vendorTaxId: vendorTaxId ?? '',
      projectName: name(projectId),
      base: n(i.beforeVat),
      vat: n(i.vat),
      total: n(i.gross),
      href: `/invoices/${i.id}`,
    })),
    ...exp.map((d) => ({
      key: `exp-${d.id}`,
      date: d.docDate,
      number: d.number,
      source: 'ใบสำคัญจ่าย',
      vendorName: d.customerName,
      vendorTaxId: d.customerTaxId,
      projectName: name(d.projectId),
      base: n(d.beforeVat),
      vat: n(d.vat),
      total: n(d.total),
      href: `/sales/expense/${d.id}`,
    })),
    ...gr.map((d) => ({
      key: `gr-${d.id}`,
      date: d.taxInvoiceDate ?? d.docDate,
      number: d.taxInvoiceNo,
      source: `รับเข้าสต็อก ${d.number}`,
      vendorName: d.supplierName,
      vendorTaxId: '',
      projectName: name(d.projectId),
      base: n(d.beforeVat),
      vat: n(d.vat),
      total: round2(D(d.beforeVat).plus(d.vat)).toNumber(),
      href: '/stock?tab=all-stock',
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number.localeCompare(b.number)));
  return {
    rows,
    totalBase: round2(sum(rows.map((r) => D(r.base)))).toNumber(),
    totalVat: round2(sum(rows.map((r) => D(r.vat)))).toNumber(),
  };
}

export interface WhtRow {
  id: string;
  number: string;
  paidAt: string;
  formType: 'PND3' | 'PND53';
  payee: string;
  payeeTaxId: string;
  pvId: string;
  pvNumber: string;
  incomeType: string;
  basis: number;
  rate: number;
  wht: number;
  status: 'ACTIVE' | 'VOID';
}

/** 50 ทวิ certificates the company issued, newest first */
export async function listWhtRows(db: Db, actor: SessionUser): Promise<WhtRow[]> {
  assertCan(actor, 'ar.manage');
  const rows = await db
    .select({ c: whtCerts, payee: vendors.name, payeeTaxId: vendors.taxId, pvNumber: pvs.number })
    .from(whtCerts)
    .innerJoin(vendors, eq(vendors.id, whtCerts.vendorId))
    .innerJoin(pvs, eq(pvs.id, whtCerts.pvId))
    .orderBy(asc(whtCerts.paidAt), asc(whtCerts.number));
  return rows
    .map(({ c, payee, payeeTaxId, pvNumber }) => ({
      id: c.id,
      number: c.number,
      paidAt: c.paidAt,
      formType: c.formType,
      payee,
      payeeTaxId: payeeTaxId ?? '',
      pvId: c.pvId,
      pvNumber,
      incomeType: c.incomeType,
      basis: n(c.basis),
      rate: n(c.basis) > 0 ? Math.round((n(c.wht) / n(c.basis)) * 10000) / 100 : 0,
      wht: n(c.wht),
      status: c.status,
    }))
    .reverse();
}
