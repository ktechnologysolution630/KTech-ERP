import Link from 'next/link';
import { getDb } from '@/db/client';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listReceivablePos } from '@/server/services/receipt';
import { DocStatusBadge } from '@/components/doc-status-badge';

export default async function ReceiveListPage() {
  const actor = await requireUser();
  const db = await getDb();
  const list = await listReceivablePos(db, actor);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">รับของหน้างาน</h1>
        <p className="text-xs text-slate-500">
          แตะเลือกใบสั่งซื้อ (PO) เพื่อบันทึกจำนวนของที่มาส่งและถ่ายรูปใบส่งของ
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          ไม่มีรายการใบสั่งซื้อที่รอรับของในโครงการของคุณ
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((po) => (
            <Link
              key={po.id}
              href={`/receive/${po.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-blue-400 transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-blue-600">{po.number}</span>
                <DocStatusBadge status={po.status} />
              </div>
              <p className="text-sm font-medium text-slate-900 mt-1">{po.vendorName}</p>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                <span>
                  {po.projectCode} - {po.projectName}
                </span>
                <span className="font-medium text-emerald-700">
                  รอรับ {po.remainingLineCount} รายการ →
                </span>
              </div>
              {po.deliveryDate && (
                <p className="text-[11px] text-slate-400 mt-1">
                  กำหนดส่ง: {formatThaiDate(po.deliveryDate)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
