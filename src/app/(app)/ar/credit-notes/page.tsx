import Link from 'next/link';
import { getDb } from '@/db/client';
import { formatMoneyDisplay } from '@/domain/money';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listArCreditNotes, listCreditableInvoices } from '@/server/services/ar-credit-notes';
import { NewCreditNotePicker } from './new-credit-note-picker';

export default async function CreditNotesPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [notes, invoices] = await Promise.all([listArCreditNotes(db, actor), listCreditableInvoices(db, actor)]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ใบลดหนี้</h1>
          <p className="text-xs text-slate-500">ลดยอดจากใบแจ้งหนี้ที่วางบิลไปแล้ว เช่น ลดราคา คืนงาน หรือคิดเงินเกิน</p>
        </div>
        <NewCreditNotePicker invoices={invoices.map((i) => ({ id: i.id, label: `${i.number ?? '-'} · ${i.customerName}` }))} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-[#102d72] text-white">
            <tr>
              {['เลขที่', 'วันที่', 'ลูกค้า', 'โครงการ', 'อ้างอิงใบแจ้งหนี้', 'เหตุผล', 'ยอดรวม', 'สถานะ'].map((h) => (
                <th key={h} className={`px-3 py-2.5 font-medium ${h === 'ยอดรวม' ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {notes.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  ไม่มีรายการ
                </td>
              </tr>
            ) : (
              notes.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono font-semibold">{c.number}</td>
                  <td className="px-3 py-2.5">{formatThaiDate(c.docDate)}</td>
                  <td className="px-3 py-2.5">{c.customerName}</td>
                  <td className="px-3 py-2.5 text-slate-600">{c.projectLabel || '-'}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/ar/invoices/${c.invoiceId}`} className="font-mono text-[#2453d4] hover:underline">
                      {c.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{c.reason}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">฿{formatMoneyDisplay(c.gross)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.voided ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {c.voided ? 'ยกเลิก' : 'ออกแล้ว'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
