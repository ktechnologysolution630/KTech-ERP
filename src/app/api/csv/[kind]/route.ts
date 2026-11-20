import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { GL_ACCOUNT_TYPE_LABEL, GL_BOOK_LABEL, JOURNAL_SOURCE_LABEL, SYSTEM_ACCOUNT_LABEL, type GlBook } from '@/domain/gl';
import { csvResponse, toCsv, type CsvCell } from '@/lib/csv';
import { requireUser } from '@/server/auth/current-user';
import { accountLedger, listGlAccounts, listJournal, trialBalance } from '@/server/services/gl';
import { getStockCard } from '@/server/services/stock-card';
import { getSalesStockSnapshot } from '@/server/services/dashboard';
import { listSalesDocs } from '@/server/services/sales-docs';
import { kindFromSlug, SALES_DOC_META, SALES_VAT_LABEL } from '@/domain/sales-doc';

/** Export CSV of a table, with the same filters as the page it was clicked on */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const { kind } = await params;
    const sp = new URL(req.url).searchParams;
    const actor = await requireUser();
    const db = await getDb();
    const from = sp.get('from') ?? '1900-01-01';
    const to = sp.get('to') ?? '2999-12-31';
    let headers: string[];
    let rows: CsvCell[][];
    switch (kind) {
      case 'gl-journal': {
        const j = await listJournal(db, actor, {
          from: sp.get('from') ?? undefined,
          to: sp.get('to') ?? undefined,
          book: sp.get('book') ?? undefined,
          source: sp.get('source') ?? undefined,
          q: sp.get('q') ?? undefined,
          includeVoid: sp.get('void') === '1',
          pageSize: 5000,
        });
        headers = ['เลขที่ JV', 'วันที่', 'สมุด', 'ประเภทเอกสาร', 'เลขที่เอกสาร', 'คู่ค้า', 'คำอธิบาย', 'รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต', 'สถานะ'];
        rows = j.rows.flatMap((e) =>
          e.lines.map((l) => [e.number, e.date, GL_BOOK_LABEL[e.book as GlBook], JOURNAL_SOURCE_LABEL[e.sourceType], e.sourceNumber, e.partyName, e.description, l.code, l.name, l.debit, l.credit, e.status === 'VOID' ? 'ยกเลิก' : 'ลงบัญชีแล้ว']),
        );
        break;
      }
      case 'gl-trial-balance': {
        const tb = await trialBalance(db, actor, { from, to });
        headers = ['รหัสบัญชี', 'ชื่อบัญชี', 'ประเภท', 'ยกมา เดบิต', 'ยกมา เครดิต', 'ระหว่างงวด เดบิต', 'ระหว่างงวด เครดิต', 'คงเหลือ เดบิต', 'คงเหลือ เครดิต'];
        rows = [
          ...tb.rows.map((r) => [r.code, r.name, GL_ACCOUNT_TYPE_LABEL[r.type], r.openingDebit, r.openingCredit, r.periodDebit, r.periodCredit, r.closingDebit, r.closingCredit]),
          ['', 'รวม', '', tb.totals.openingDebit, tb.totals.openingCredit, tb.totals.periodDebit, tb.totals.periodCredit, tb.totals.closingDebit, tb.totals.closingCredit],
        ];
        break;
      }
      case 'gl-accounts': {
        const accounts = await listGlAccounts(db, actor);
        headers = ['รหัสบัญชี', 'ชื่อบัญชี', 'ประเภท', 'ใช้ลงบัญชีอัตโนมัติ', 'ยอดคงเหลือ (เดบิต+)', 'สถานะ'];
        rows = accounts.map((a) => [a.code, a.name, GL_ACCOUNT_TYPE_LABEL[a.type], a.systemKey ? SYSTEM_ACCOUNT_LABEL[a.systemKey] : '', a.balance, a.active ? 'ใช้งาน' : 'ปิดใช้งาน']);
        break;
      }
      case 'gl-ledger': {
        const l = await accountLedger(db, actor, sp.get('account') ?? '', { from, to });
        headers = ['วันที่', 'เลขที่ JV', 'เลขที่เอกสาร', 'คู่ค้า', 'คำอธิบาย', 'เดบิต', 'เครดิต', 'ยอดคงเหลือ'];
        rows = [['', '', '', '', 'ยอดยกมา', '', '', l.opening], ...l.rows.map((r) => [r.date, r.number, r.sourceNumber, r.partyName, r.description, r.debit, r.credit, r.balance])];
        break;
      }
      case 'stock-card': {
        const c = await getStockCard(db, actor, { stockItemId: sp.get('item') ?? '', store: sp.get('store') ?? 'all', from, to });
        const TYPE = { RECEIVE: 'รับเข้า', ISSUE: 'จ่ายออก', TRANSFER: 'โอนย้าย', ADJUST: 'ปรับปรุง (AJ)', RETURN: 'รับคืน' };
        headers = ['วันที่', 'เลขที่', 'อ้างอิง', 'รายการ', 'หมายเหตุ', 'รับเข้า จำนวน', 'รับเข้า มูลค่า', 'จ่ายออก จำนวน', 'จ่ายออก มูลค่า', 'ทุน/หน่วย', 'คงเหลือ จำนวน', 'คงเหลือ มูลค่า', 'ทุนเฉลี่ย'];
        rows = [
          [from, '', '', `ยอดยกมา ${c.item.sku} ${c.item.name} (${c.storeName})`, '', '', '', '', '', '', c.opening.qty, c.opening.value, ''],
          ...c.rows.map((r) => [r.date, r.number, r.reference, TYPE[r.type], r.notes, r.qtyIn, r.valueIn, r.qtyOut, r.valueOut, r.unitCost, r.balanceQty, r.balanceValue, r.avgCost]),
        ];
        break;
      }
      case 'sales-docs': {
        const docKind = kindFromSlug(sp.get('kind') ?? '');
        if (!docKind) return NextResponse.json({ error: 'ไม่รู้จักประเภทเอกสาร' }, { status: 404 });
        const docs = await listSalesDocs(db, actor, docKind, { includeCancelled: sp.get('cancelled') === '1' });
        headers = ['เลขที่', 'วันที่', 'อ้างอิง', 'ลูกค้า / ผู้รับเงิน', 'เลขผู้เสียภาษี', 'โครงการ', 'VAT', 'ก่อน VAT', 'VAT', 'ยอดรวม', 'หัก ณ ที่จ่าย', 'สุทธิ', 'สถานะ'];
        rows = docs
          .filter((d) => d.docDate >= from && d.docDate <= to)
          .map((d) => [d.number, d.docDate, d.reference, d.customerName, d.customerTaxId, d.projectLabel, SALES_VAT_LABEL[d.vatMode], d.beforeVat, d.vat, d.total, d.wht, d.payable, d.status === 'ISSUED' ? 'ออกแล้ว' : `ยกเลิก: ${d.cancelReason ?? ''}`]);
        return csvResponse(`${SALES_DOC_META[docKind].prefix}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows));
      }
      case 'low-stock': {
        const s = await getSalesStockSnapshot(db, actor);
        headers = ['รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย', 'คงเหลือทุกคลัง', 'จุดสั่งซื้อ', 'ขาดอีก'];
        rows = s.lowStock.map((i) => [i.sku, i.name, i.unit, i.onHand, i.reorderPoint, Math.max(0, i.reorderPoint - i.onHand)]);
        break;
      }
      default:
        return NextResponse.json({ error: 'ไม่รู้จักรายงานนี้' }, { status: 404 });
    }
    return csvResponse(`${kind}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows));
  } catch (err) {
    if (err instanceof DomainError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
}
