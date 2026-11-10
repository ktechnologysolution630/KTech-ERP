import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { poLines, pos, prLines, projects, receiptLines, receipts, vendors, type PoStatus, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, Decimal, round2 } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { assertCan } from '@/server/policy';

/** POs that are real purchases: submitted or further, not drafts, rejected or cancelled ones. */
const REPORTED_STATUSES: PoStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'COMPLETED'];
const NO_CATEGORY = 'ไม่ระบุหมวด';

const inputSchema = z.object({
  projectId: z.string().uuid('กรุณาเลือกโครงการ'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  q: z.string().trim().max(200).optional(),
});
export type ProjectPurchaseReportInput = z.input<typeof inputSchema>;

export interface ReportLine {
  description: string;
  category: string;
  qty: number;
  unit: string;
  unitPrice: number;
  /** Before VAT, after discounts and shipping */
  amount: number;
  receivedQty: number;
}

export interface ReportPo {
  id: string;
  number: string;
  /** Bangkok date the PO was made */
  date: string;
  vendorName: string;
  status: PoStatus;
  amount: number;
  vat: number;
  gross: number;
  lines: ReportLine[];
}

export interface ProjectPurchaseReport {
  project: { id: string; code: string; name: string };
  from: string | null;
  to: string | null;
  q: string;
  summary: {
    poCount: number;
    vendorCount: number;
    lineCount: number;
    amount: number;
    vat: number;
    gross: number;
    /** Value of what has been received so far, before VAT */
    receivedAmount: number;
    outstandingAmount: number;
  };
  byVendor: { vendorName: string; poCount: number; amount: number; share: number }[];
  byCategory: { category: string; lineCount: number; amount: number; share: number }[];
  byStatus: { status: PoStatus; poCount: number; gross: number }[];
  pos: ReportPo[];
}

const num = (d: Decimal) => round2(d).toNumber();
const share = (part: Decimal, whole: Decimal) => (whole.isZero() ? 0 : part.div(whole).times(100).toDecimalPlaces(1).toNumber());

/**
 * Purchasing summary of one project: its POs (by the date they were made), with totals by vendor,
 * work category and status. The search keeps a PO whose number or vendor matches, otherwise only
 * its lines that match.
 */
export async function getProjectPurchaseReport(db: Db, actor: SessionUser, input: ProjectPurchaseReportInput): Promise<ProjectPurchaseReport> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_REPORT', parsed.error.issues[0]!.message);
  const { projectId, from = null, to = null } = parsed.data;
  const q = parsed.data.q ?? '';
  if (from && to && from > to) throw new DomainError('INVALID_REPORT', 'วันที่เริ่มต้นต้องไม่หลังวันที่สิ้นสุด');
  assertCan(actor, 'project.view', { projectId });

  const [project] = await db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);

  const poRows = (
    await db
      .select({ po: pos, vendorName: vendors.name })
      .from(pos)
      .innerJoin(vendors, eq(vendors.id, pos.vendorId))
      .where(and(eq(pos.projectId, projectId), inArray(pos.status, REPORTED_STATUSES)))
      .orderBy(asc(pos.createdAt))
  )
    .map((r) => ({ ...r, date: bangkokDateString(r.po.createdAt) }))
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to));

  const poIds = poRows.map((r) => r.po.id);
  const [lineRows, receivedRows] = poIds.length
    ? await Promise.all([
        db
          .select({ line: poLines, category: prLines.category })
          .from(poLines)
          .leftJoin(prLines, eq(prLines.id, poLines.prLineId))
          .where(inArray(poLines.poId, poIds))
          .orderBy(asc(poLines.sort)),
        db
          .select({ poLineId: receiptLines.poLineId, qty: receiptLines.qty })
          .from(receiptLines)
          .innerJoin(receipts, and(eq(receipts.id, receiptLines.receiptId), eq(receipts.status, 'CONFIRMED')))
          .where(inArray(receipts.poId, poIds)),
      ])
    : [[], []];
  const received = new Map<string, Decimal>();
  for (const r of receivedRows) received.set(r.poLineId, (received.get(r.poLineId) ?? D(0)).plus(r.qty));

  const needle = q.toLowerCase();
  const reportPos: ReportPo[] = [];
  let amount = D(0);
  let vat = D(0);
  let gross = D(0);
  let receivedAmount = D(0);
  let lineCount = 0;
  const vendorTotals = new Map<string, { poCount: number; amount: Decimal }>();
  const categoryTotals = new Map<string, { lineCount: number; amount: Decimal }>();
  const statusTotals = new Map<PoStatus, { poCount: number; gross: Decimal }>();

  for (const { po, vendorName, date } of poRows) {
    const wholePo = !needle || `${po.number} ${vendorName}`.toLowerCase().includes(needle);
    const lines = lineRows.filter((l) => l.line.poId === po.id && (wholePo || l.line.description.toLowerCase().includes(needle)));
    if (lines.length === 0) continue;

    let poAmount = D(0);
    let poVat = D(0);
    let poGross = D(0);
    const reportLines: ReportLine[] = lines.map(({ line, category }) => {
      const qty = D(line.qty);
      const lineAmount = D(line.allocatedBeforeVat);
      const got = received.get(line.id) ?? D(0);
      poAmount = poAmount.plus(lineAmount);
      poVat = poVat.plus(line.vat);
      poGross = poGross.plus(line.gross);
      // Received value at the line's own net price, never more than the line
      receivedAmount = receivedAmount.plus(qty.isZero() ? D(0) : Decimal.min(lineAmount, lineAmount.times(got).div(qty)));
      const cat = category || NO_CATEGORY;
      const c = categoryTotals.get(cat) ?? { lineCount: 0, amount: D(0) };
      categoryTotals.set(cat, { lineCount: c.lineCount + 1, amount: c.amount.plus(lineAmount) });
      return {
        description: line.description,
        category: cat,
        qty: qty.toNumber(),
        unit: line.unitName,
        unitPrice: Number(line.unitPrice),
        amount: num(lineAmount),
        receivedQty: got.toNumber(),
      };
    });

    lineCount += reportLines.length;
    amount = amount.plus(poAmount);
    vat = vat.plus(poVat);
    gross = gross.plus(poGross);
    const v = vendorTotals.get(vendorName) ?? { poCount: 0, amount: D(0) };
    vendorTotals.set(vendorName, { poCount: v.poCount + 1, amount: v.amount.plus(poAmount) });
    const s = statusTotals.get(po.status) ?? { poCount: 0, gross: D(0) };
    statusTotals.set(po.status, { poCount: s.poCount + 1, gross: s.gross.plus(poGross) });
    reportPos.push({ id: po.id, number: po.number, date, vendorName, status: po.status, amount: num(poAmount), vat: num(poVat), gross: num(poGross), lines: reportLines });
  }

  return {
    project,
    from,
    to,
    q,
    summary: {
      poCount: reportPos.length,
      vendorCount: vendorTotals.size,
      lineCount,
      amount: num(amount),
      vat: num(vat),
      gross: num(gross),
      receivedAmount: num(receivedAmount),
      outstandingAmount: num(amount.minus(receivedAmount)),
    },
    byVendor: [...vendorTotals.entries()]
      .map(([vendorName, t]) => ({ vendorName, poCount: t.poCount, amount: num(t.amount), share: share(t.amount, amount) }))
      .sort((a, b) => b.amount - a.amount),
    byCategory: [...categoryTotals.entries()]
      .map(([category, t]) => ({ category, lineCount: t.lineCount, amount: num(t.amount), share: share(t.amount, amount) }))
      .sort((a, b) => b.amount - a.amount),
    byStatus: REPORTED_STATUSES.filter((st) => statusTotals.has(st)).map((st) => ({ status: st, poCount: statusTotals.get(st)!.poCount, gross: num(statusTotals.get(st)!.gross) })),
    pos: reportPos,
  };
}
