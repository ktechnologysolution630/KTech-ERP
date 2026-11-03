import Link from 'next/link';
import { AR_INVOICE_STATUS_LABELS } from '@/domain/ar';
import { listArInvoices } from '@/server/services/ar';
import { baht, requireArUser } from '../ar-guard';

export default async function ArInvoicesPage() {
  const { actor, db } = await requireArUser();
  const rows = await listArInvoices(db, actor);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ใบแจ้งหนี้ / ใบวางบิล (ลูกค้า)</h1>
          <p className="text-xs text-slate-500">เรียกเก็บเงินลูกค้าตามงวดงาน · วางบิลจากงวดงานรับได้ที่หน้าค่าแรง/งวดงาน</p>
        </div>
        <Link
          href="/ar/invoices/new"
          className="px-3 py-2 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700"
        >
          + สร้างใบแจ้งหนี้
        </Link>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
        <table className="w-full text-xs min-w-[900px]">
          <thead className="bg-[#102d72] text-white">
            <tr>
              <th className="px-3 py-2 text-left">เลขที่</th>
              <th className="px-3 py-2 text-left">วันที่</th>
              <th className="px-3 py-2 text-left">ครบกำหนด</th>
              <th className="px-3 py-2 text-left">ลูกค้า</th>
              <th className="px-3 py-2 text-left">โครงการ</th>
              <th className="px-3 py-2 text-right">ยอดรวม</th>
              <th className="px-3 py-2 text-right">คงค้าง</th>
              <th className="px-3 py-2 text-left">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">ไม่มีรายการ</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/ar/invoices/${r.id}`} className="font-mono text-[#2453d4] hover:underline">
                    {r.number ?? '(ร่าง)'}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono">{r.docDate}</td>
                <td className="px-3 py-2 font-mono">{r.dueDate}</td>
                <td className="px-3 py-2">{r.customerName}</td>
                <td className="px-3 py-2">{r.projectName ?? '-'}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.gross)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{baht(r.balance)}</td>
                <td className="px-3 py-2">{AR_INVOICE_STATUS_LABELS[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
