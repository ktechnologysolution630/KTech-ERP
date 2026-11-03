import Link from 'next/link';
import { AGING_LABELS, type AgingBucket } from '@/domain/ar';
import { listArInvoices } from '@/server/services/ar';
import { baht, requireArUser } from '../ar-guard';

const BUCKETS: AgingBucket[] = ['NOT_DUE', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'];

export default async function ReceivablesPage() {
  const { actor, db } = await requireArUser();
  const open = (await listArInvoices(db, actor)).filter((r) => r.balance > 0);
  const totals = new Map(BUCKETS.map((b) => [b, 0]));
  for (const r of open) totals.set(r.aging, (totals.get(r.aging) ?? 0) + r.balance);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">ลูกหนี้การค้า</h1>
        <p className="text-xs text-slate-500">ยอดค้างรับจากใบแจ้งหนี้ที่วางบิลแล้ว แยกตามอายุลูกหนี้</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {BUCKETS.map((b) => (
          <div key={b} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500">{AGING_LABELS[b]}</div>
            <div className={`font-mono font-bold mt-1 ${b === 'NOT_DUE' ? 'text-slate-900' : 'text-red-600'}`}>
              {baht(totals.get(b) ?? 0)}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
        <table className="w-full text-xs min-w-[1000px]">
          <thead className="bg-[#102d72] text-white">
            <tr>
              <th className="px-3 py-2 text-left">ลูกค้า</th>
              <th className="px-3 py-2 text-left">เลขที่ใบแจ้งหนี้</th>
              <th className="px-3 py-2 text-left">โครงการ</th>
              <th className="px-3 py-2 text-left">วันที่เอกสาร</th>
              <th className="px-3 py-2 text-left">ครบกำหนด</th>
              <th className="px-3 py-2 text-right">ยอดตั้งหนี้</th>
              <th className="px-3 py-2 text-right">รับชำระแล้ว</th>
              <th className="px-3 py-2 text-right">หัก ณ ที่จ่าย</th>
              <th className="px-3 py-2 text-right">ยอดคงเหลือ</th>
              <th className="px-3 py-2 text-left">อายุลูกหนี้</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {open.length === 0 && (
              <tr>
                <td colSpan={10} className="py-12 text-center text-slate-400">ไม่มียอดค้างรับ</td>
              </tr>
            )}
            {open.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.customerName}</td>
                <td className="px-3 py-2">
                  <Link href={`/ar/invoices/${r.id}`} className="font-mono text-[#2453d4] hover:underline">
                    {r.number}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.projectName ?? '-'}</td>
                <td className="px-3 py-2 font-mono">{r.docDate}</td>
                <td className="px-3 py-2 font-mono">{r.dueDate}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.gross - r.credited)}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.settled - r.wht)}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.wht)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{baht(r.balance)}</td>
                <td className={`px-3 py-2 ${r.aging === 'NOT_DUE' ? '' : 'text-red-600 font-semibold'}`}>
                  {AGING_LABELS[r.aging]}
                  {r.daysOverdue > 0 && ` (${r.daysOverdue} วัน)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
