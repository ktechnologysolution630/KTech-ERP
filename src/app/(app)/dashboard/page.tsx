import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { getOwnerDashboard } from '@/server/services/dashboard';
import { formatMoneyDisplay } from '@/components/money-input';

export default async function DashboardPage() {
  const actor = await requireUser();
  const db = await getDb();
  const dash = await getOwnerDashboard(db, actor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          ภาพรวมผู้บริหารและการเงิน (Owner & Finance Dashboard)
        </h1>
        <p className="text-xs text-slate-600">
          ติดตามยอดค้างจ่าย กำหนดชำระ รายการจ่ายแล้วของยังไม่มา และสรุปยอดซื้อตามโครงการ
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">PO รออนุมัติ</div>
          <div className="text-2xl font-bold text-blue-700 mt-1">
            {dash.pendingApprovals.po} ใบ
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">ใบสำคัญจ่าย (PV) รออนุมัติ</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">
            {dash.pendingApprovals.pv} ใบ
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">คำขอปิดยอดค้างรับรออนุมัติ</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {dash.pendingApprovals.closeShort} รายการ
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-red-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-red-800">
            เกินกำหนดชำระ (Overdue: {dash.overdue.length})
          </h2>
          {dash.overdue.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">ไม่มีรายการเกินกำหนด</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-red-50 text-red-900">
                <tr>
                  <th className="px-2 py-1.5 text-left">ครบกำหนด</th>
                  <th className="px-2 py-1.5 text-left">ผู้ขาย</th>
                  <th className="px-2 py-1.5 text-right">ยอดเงิน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.overdue.map((o) => (
                  <tr key={o.id}>
                    <td className="px-2 py-1.5 font-medium text-red-700">{o.dueDate}</td>
                    <td className="px-2 py-1.5">{o.vendorName}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">
                      ฿{formatMoneyDisplay(o.gross)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-amber-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-amber-900">
            ครบกำหนดภายใน 7 วัน ({dash.dueSoon.length})
          </h2>
          {dash.dueSoon.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">ไม่มีรายการครบกำหนดใน 7 วัน</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-amber-50 text-amber-900">
                <tr>
                  <th className="px-2 py-1.5 text-left">ครบกำหนด</th>
                  <th className="px-2 py-1.5 text-left">ผู้ขาย</th>
                  <th className="px-2 py-1.5 text-right">ยอดเงิน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.dueSoon.map((d) => (
                  <tr key={d.id}>
                    <td className="px-2 py-1.5 font-medium">{d.dueDate}</td>
                    <td className="px-2 py-1.5">{d.vendorName}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">
                      ฿{formatMoneyDisplay(d.gross)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">
            จ่ายเงินแล้ว แต่ยังไม่ได้รับของ ({dash.paidNotReceived.length})
          </h2>
          {dash.paidNotReceived.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">ไม่มีรายการค้างรับหลังจ่ายเงิน</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-1.5 text-left">PO</th>
                  <th className="px-2 py-1.5 text-left">ผู้ขาย</th>
                  <th className="px-2 py-1.5 text-right">มูลค่าค้างรับ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.paidNotReceived.map((p) => (
                  <tr key={p.poId}>
                    <td className="px-2 py-1.5 font-medium">
                      <Link
                        href={`/po/${p.poId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {p.number}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">{p.vendor}</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-amber-800">
                      ฿{formatMoneyDisplay(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">
            ยอดตั้งหนี้ค้างจ่ายแยกตามผู้ขาย
          </h2>
          {dash.outstandingByVendor.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">ไม่มีหนี้ค้างชำระ</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-1.5 text-left">ผู้ขาย</th>
                  <th className="px-2 py-1.5 text-right">ยอดค้างจ่ายรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.outstandingByVendor.map((v) => (
                  <tr key={v.vendorId}>
                    <td className="px-2 py-1.5">{v.name}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">
                      ฿{formatMoneyDisplay(v.gross)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">
          สรุปยอดสั่งซื้อที่อนุมัติแล้ว แยกตามโครงการ
        </h2>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">โครงการ</th>
              <th className="px-3 py-2 text-right">ยอดเดือนนี้</th>
              <th className="px-3 py-2 text-right">ยอดสะสมปีนี้ (YTD)</th>
              <th className="px-3 py-2 text-right">ยอดรวมทั้งหมด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dash.purchasesByProject.map((p) => (
              <tr key={p.projectId ?? '__OFFICE__'}>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-right">
                  ฿{formatMoneyDisplay(p.monthGross)}
                </td>
                <td className="px-3 py-2 text-right">
                  ฿{formatMoneyDisplay(p.ytdGross)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  ฿{formatMoneyDisplay(p.gross)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
