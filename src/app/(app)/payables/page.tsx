import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listOpenPayables } from '@/server/services/payable';
import { formatMoneyDisplay } from '@/domain/money';

export default async function PayablesPage() {
  const actor = await requireUser();
  const db = await getDb();
  const payables = await listOpenPayables(db, actor, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            รายการตั้งหนี้รอทำจ่าย (Open Payables)
          </h1>
          <p className="text-xs text-slate-600">
            เรียงตามวันครบกำหนดชำระ สำหรับฝ่ายการเงินนำไปรวมทำใบสำคัญจ่าย (PV)
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
              <th className="px-4 py-3 text-left">ครบกำหนด</th>
              <th className="px-4 py-3 text-left">ผู้ขาย</th>
              <th className="px-4 py-3 text-left">ประเภท</th>
              <th className="px-4 py-3 text-left">PO / อ้างอิง</th>
              <th className="px-4 py-3 text-right">ก่อน VAT</th>
              <th className="px-4 py-3 text-right">VAT</th>
              <th className="px-4 py-3 text-right">ยอดรวม</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payables.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  ไม่มีรายการตั้งหนี้ค้างทำจ่าย
                </td>
              </tr>
            ) : (
              payables.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs font-medium">{p.dueDate}</td>
                  <td className="px-4 py-3">{p.vendorName}</td>
                  <td className="px-4 py-3 text-xs">{p.sourceType}</td>
                  <td className="px-4 py-3 text-xs">
                    {p.poId ? (
                      <Link
                        href={`/po/${p.poId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {p.poNumber}
                      </Link>
                    ) : (
                      '-'
                    )}{' '}
                    · {p.note}
                  </td>
                  <td className="px-4 py-3 text-right">
                    ฿{formatMoneyDisplay(p.beforeVat)}
                  </td>
                  <td className="px-4 py-3 text-right">฿{formatMoneyDisplay(p.vat)}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    ฿{formatMoneyDisplay(p.gross)}
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
