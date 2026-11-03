import Link from 'next/link';
import { getDb } from '@/db/client';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listPvs } from '@/server/services/pv';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { formatMoneyDisplay } from '@/domain/money';

export default async function PvListPage() {
  const actor = await requireUser();
  const db = await getDb();
  const items = await listPvs(db, actor);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            ใบสำคัญจ่าย (Payment Vouchers)
          </h1>
          <p className="text-xs text-slate-600">
            รวบรวมรายการตั้งหนี้ คำนวณภาษีหัก ณ ที่จ่าย ส่งเจ้าของอนุมัติ และบันทึกการโอนเงิน
          </p>
        </div>
        <Link
          href="/pv/new"
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-medium"
        >
          + สร้างใบสำคัญจ่าย (PV)
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">เลขที่ PV</th>
              <th className="px-4 py-3 text-left">ผู้ขาย</th>
              <th className="px-4 py-3 text-right">ยอดรวม</th>
              <th className="px-4 py-3 text-right">หัก ณ ที่จ่าย</th>
              <th className="px-4 py-3 text-right">ยอดจ่ายสุทธิ</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
              <th className="px-4 py-3 text-left">วันที่จ่าย</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  ยังไม่มีใบสำคัญจ่าย
                </td>
              </tr>
            ) : (
              items.map((pv) => (
                <tr key={pv.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/pv/${pv.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {pv.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{pv.vendorName}</td>
                  <td className="px-4 py-3 text-right">
                    ฿{formatMoneyDisplay(pv.gross)}
                  </td>
                  <td className="px-4 py-3 text-right text-amber-700">
                    ฿{formatMoneyDisplay(pv.wht)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    ฿{formatMoneyDisplay(pv.net)}
                  </td>
                  <td className="px-4 py-3">
                    <DocStatusBadge status={pv.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {pv.paidAt ? pv.paidAt : formatThaiDate(pv.createdAt)}
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
