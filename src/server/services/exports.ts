import ExcelJS from 'exceljs';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  invoices,
  payables,
  pos,
  pvLines,
  pvs,
  vendors,
  whtCerts,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D } from '@/domain/money';
import { assertCan } from '@/server/policy';

export type ExportKind = 'pv-paid' | 'purchase-vat' | 'wht';

function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, '0');
  const start = `${year}-${mm}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export async function listWhtCertsWithRefs(db: Db) {
  const [certs, allVendors, allPvs] = await Promise.all([
    db.select().from(whtCerts).orderBy(desc(whtCerts.paidAt), desc(whtCerts.number)),
    db.select().from(vendors),
    db.select().from(pvs),
  ]);
  return { certs, allVendors, allPvs };
}

export async function exportMonthly(
  db: Db,
  actor: SessionUser,
  kind: ExportKind,
  period: { year: number; month: number },
): Promise<Buffer> {
  assertCan(actor, 'export.view');

  const { start, end } = getMonthDateRange(period.year, period.month);
  const wb = new ExcelJS.Workbook();

  const allVendors = await db.select().from(vendors);
  const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
  const allPos = await db.select().from(pos);
  const poMap = new Map(allPos.map((p) => [p.id, p]));

  if (kind === 'pv-paid') {
    const sheet = wb.addWorksheet('PV จ่ายแล้ว');
    sheet.addRow([
      'เลขที่ PV',
      'วันที่จ่าย',
      'ผู้ขาย',
      'เลขผู้เสียภาษี',
      'เลขที่ PO',
      'ก่อน VAT',
      'VAT',
      'ยอดรวม (Gross)',
      'หัก ณ ที่จ่าย',
      'จ่ายสุทธิ (Net)',
      'วิธีจ่าย',
      'อ้างอิงการโอน',
    ]);

    const allPayables = await db.select().from(payables);
    const payableMap = new Map(allPayables.map((p) => [p.id, p]));

    const paidPvs = await db
      .select()
      .from(pvs)
      .where(
        and(
          eq(pvs.status, 'PAID'),
          gte(pvs.paidAt, start),
          lte(pvs.paidAt, end),
        ),
      )
      .orderBy(asc(pvs.paidAt), asc(pvs.number));

    for (const pv of paidPvs) {
      const v = vendorMap.get(pv.vendorId);
      const lines = await db
        .select()
        .from(pvLines)
        .where(eq(pvLines.pvId, pv.id));

      const poNumbers = Array.from(
        new Set(
          lines
            .map((l) => payableMap.get(l.payableId)?.poId)
            .filter((pid): pid is string => Boolean(pid))
            .map((pid) => poMap.get(pid)?.number ?? ''),
        ),
      )
        .filter(Boolean)
        .join(', ');

      sheet.addRow([
        pv.number,
        pv.paidAt ?? '',
        v?.name ?? '',
        v?.taxId ?? '',
        poNumbers,
        Number(pv.beforeVat),
        Number(pv.vat),
        Number(pv.gross),
        Number(pv.wht),
        Number(pv.net),
        pv.payMethod ?? '',
        pv.payRef ?? '',
      ]);
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (kind === 'purchase-vat') {
    const sheet = wb.addWorksheet('รายงานภาษีซื้อ');
    sheet.addRow([
      'วันที่ใบกำกับภาษี',
      'เลขที่ใบกำกับภาษี',
      'ชื่อผู้ขาย',
      'เลขประจำตัวผู้เสียภาษี',
      'สาขา',
      'มูลค่าสินค้า/บริการ (ก่อน VAT)',
      'ภาษีมูลค่าเพิ่ม (VAT)',
      'จำนวนเงินรวม',
      'เลขที่ PO',
    ]);

    const taxInvs = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.status, 'ACTIVE'),
          eq(invoices.isTaxInvoice, true),
          gte(invoices.invoiceDate, start),
          lte(invoices.invoiceDate, end),
        ),
      )
      .orderBy(asc(invoices.invoiceDate), asc(invoices.invoiceNo));

    for (const inv of taxInvs) {
      const v = vendorMap.get(inv.vendorId);
      const po = poMap.get(inv.poId);
      sheet.addRow([
        inv.invoiceDate,
        inv.invoiceNo,
        v?.name ?? '',
        v?.taxId ?? '',
        v?.branch ?? '00000',
        Number(inv.beforeVat),
        Number(inv.vat),
        Number(inv.gross),
        po?.number ?? '',
      ]);
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (kind === 'wht') {
    const sheetPnd3 = wb.addWorksheet('ภ.ง.ด.3');
    const sheetPnd53 = wb.addWorksheet('ภ.ง.ด.53');

    const headers = [
      'เลขที่หนังสือรับรอง',
      'วันที่จ่าย',
      'ชื่อผู้ถูกหัก',
      'เลขประจำตัวผู้เสียภาษี',
      'สาขา',
      'ที่อยู่',
      'ประเภทเงินได้',
      'อัตรา (%)',
      'จำนวนเงินที่จ่าย',
      'ภาษีที่หักไว้',
    ];
    sheetPnd3.addRow(headers);
    sheetPnd53.addRow(headers);

    const certs = await db
      .select()
      .from(whtCerts)
      .where(
        and(
          eq(whtCerts.status, 'ACTIVE'),
          gte(whtCerts.paidAt, start),
          lte(whtCerts.paidAt, end),
        ),
      )
      .orderBy(asc(whtCerts.paidAt), asc(whtCerts.number));

    for (const c of certs) {
      const v = vendorMap.get(c.vendorId);
      const basisDec = D(c.basis);
      const whtDec = D(c.wht);
      const rate = basisDec.gt(0)
        ? whtDec.times(100).div(basisDec).toDecimalPlaces(2).toNumber()
        : 0;

      const row = [
        c.number,
        c.paidAt,
        v?.name ?? '',
        v?.taxId ?? '',
        v?.branch ?? '00000',
        v?.address ?? '',
        c.incomeType,
        rate,
        Number(c.basis),
        Number(c.wht),
      ];

      if (c.formType === 'PND3') {
        sheetPnd3.addRow(row);
      } else {
        sheetPnd53.addRow(row);
      }
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new DomainError('INVALID_KIND', 'ประเภทรายงานไม่ถูกต้อง', 400);
}
