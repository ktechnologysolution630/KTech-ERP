import Link from 'next/link';
import { getDb } from '@/db/client';
import { RECEIPT_SUBSTITUTE_STATUS_LABELS } from '@/domain/advance';
import { requireUser } from '@/server/auth/current-user';
import { listReceiptSubstitutes } from '@/server/services/advances';

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ReceiptSubstitutesPage() {
  const actor = await requireUser();
  const db = await getDb();
  const { rows } = await listReceiptSubstitutes(db, actor);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ใบรับรองแทนใบเสร็จรับเงิน</h1>
          <p className="text-xs text-slate-500">ใช้เมื่อจ่ายเงินแล้วผู้รับเงินออกใบเสร็จให้ไม่ได้ เช่น ค่าแรงรายวัน ค่าขนส่งรายย่อย</p>
        </div>
        <Link href="/receipt-substitutes/new" className="px-3 py-2 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700">
          + สร้างเอกสาร
        </Link>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="bg-[#102d72] text-white">
            <tr>
              <th className="px-3 py-2 text-left">เลขที่</th>
              <th className="px-3 py-2 text-left">วันที่</th>
              <th className="px-3 py-2 text-left">ผู้เบิกจ่าย</th>
              <th className="px-3 py-2 text-left">โครงการ</th>
              <th className="px-3 py-2 text-left">เงินทดรอง</th>
              <th className="px-3 py-2 text-right">รวมทั้งสิ้น</th>
              <th className="px-3 py-2 text-left">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">ไม่มีรายการ</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <Link href={`/receipt-substitutes/${r.id}`} className="font-mono text-[#2453d4] hover:underline">
                    {r.number ?? '(ร่าง)'}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono">{r.docDate}</td>
                <td className="px-3 py-2">{r.payerName}</td>
                <td className="px-3 py-2">{r.projectName ?? '-'}</td>
                <td className="px-3 py-2 font-mono">{r.advanceNumber ?? '-'}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.total)}</td>
                <td className="px-3 py-2">{RECEIPT_SUBSTITUTE_STATUS_LABELS[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
