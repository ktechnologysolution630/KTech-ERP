import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AGING_LABELS, AR_INVOICE_STATUS_LABELS, PAY_METHOD_LABELS } from '@/domain/ar';
import { DomainError } from '@/domain/errors';
import { getArInvoice } from '@/server/services/ar';
import { baht, requireArUser } from '../../ar-guard';
import { InvoiceActions, VoidReceiptButton } from './invoice-actions';

export default async function ArInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db } = await requireArUser();
  let inv: Awaited<ReturnType<typeof getArInvoice>>;
  try {
    inv = await getArInvoice(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="space-y-4 text-xs">
      <Link href="/ar/invoices" className="text-slate-500 hover:text-slate-800">
        ← ใบแจ้งหนี้ทั้งหมด
      </Link>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-mono">{inv.number ?? 'ใบแจ้งหนี้ (ร่าง)'}</h1>
            <p className="text-slate-600">
              {inv.customerName}
              {inv.customerTaxId && ` · เลขผู้เสียภาษี ${inv.customerTaxId}`}
              {inv.projectName && ` · โครงการ ${inv.projectName}`}
            </p>
            <p className="text-slate-500">
              วันที่ {inv.docDate} · ครบกำหนด {inv.dueDate}
              {inv.balance > 0 && inv.aging !== 'NOT_DUE' && ` · เกินกำหนด ${inv.daysOverdue} วัน (${AGING_LABELS[inv.aging]})`}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-semibold">{AR_INVOICE_STATUS_LABELS[inv.status]}</span>
        </div>

        <table className="w-full">
          <thead className="text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2 text-left">รายการ</th>
              <th className="py-2 text-right">จำนวน</th>
              <th className="py-2 text-right">ราคา/หน่วย</th>
              <th className="py-2 text-right">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-2">{l.description}</td>
                <td className="py-2 text-right font-mono">{l.qty}</td>
                <td className="py-2 text-right font-mono">{baht(l.unitPrice)}</td>
                <td className="py-2 text-right font-mono">{baht(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['ก่อน VAT', inv.beforeVat],
            ['VAT', inv.vat],
            ['รวมทั้งสิ้น', inv.gross],
            ['หักประกันผลงาน', inv.retentionAmount],
            ['รับชำระแล้ว (รวม WHT)', inv.settled],
            ['หัก ณ ที่จ่าย', inv.wht],
            ['ลดหนี้', inv.credited],
            ['คงค้าง', inv.balance],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-slate-50 p-2">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-mono font-semibold">{baht(v as number)}</dd>
            </div>
          ))}
        </dl>
        {inv.note && <p className="text-slate-600">หมายเหตุ: {inv.note}</p>}
      </div>

      <InvoiceActions
        // Remount after each movement so the receipt form re-suggests amounts from the new balance
        key={`${inv.status}-${inv.balance}`}
        invoiceId={inv.id}
        status={inv.status}
        balance={inv.balance}
        retention={inv.retentionAmount}
        beforeVat={inv.beforeVat}
        gross={inv.gross}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <h2 className="font-bold text-sm">ใบเสร็จรับเงิน / ใบกำกับภาษี</h2>
          {inv.receipts.length === 0 && <p className="text-slate-400">ยังไม่มี</p>}
          {inv.receipts.map((r) => (
            <div key={r.id} className={`flex flex-wrap items-center gap-2 border-b border-slate-50 py-1.5 ${r.voided ? 'opacity-50 line-through' : ''}`}>
              <span className="font-mono font-semibold">{r.number}</span>
              <span>{r.receiptDate}</span>
              <span>{PAY_METHOD_LABELS[r.method]}</span>
              <span className="ml-auto font-mono">
                {baht(r.amountReceived)}
                {r.whtAmount > 0 && ` + WHT ${baht(r.whtAmount)}`} · VAT {baht(r.vat)}
              </span>
              {!r.voided && <VoidReceiptButton invoiceId={inv.id} receiptId={r.id} number={r.number} />}
            </div>
          ))}
        </section>
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <h2 className="font-bold text-sm">ใบลดหนี้</h2>
          {inv.creditNotes.length === 0 && <p className="text-slate-400">ยังไม่มี</p>}
          {inv.creditNotes.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 border-b border-slate-50 py-1.5">
              <span className="font-mono font-semibold">{c.number}</span>
              <span>{c.docDate}</span>
              <span className="text-slate-500">{c.reason}</span>
              <span className="ml-auto font-mono">{baht(c.gross)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
