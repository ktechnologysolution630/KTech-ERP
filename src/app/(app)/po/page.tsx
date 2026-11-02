import Link from 'next/link';
import { getDb } from '@/db/client';
import { type PoStatus } from '@/db/schema';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listProjects, listVendors } from '@/server/services/master';
import { listPos } from '@/server/services/po';
import { getPoSummary } from '@/server/services/invoice';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { formatMoneyDisplay } from '@/components/money-input';

export default async function PoListPage({
  searchParams,
}: {
  searchParams: Promise<{
    projectId?: string;
    vendorId?: string;
    status?: PoStatus;
    q?: string;
  }>;
}) {
  const actor = await requireUser();
  const db = await getDb();
  const params = await searchParams;
  const [pos, projects, vendors] = await Promise.all([
    listPos(db, actor, params),
    listProjects(db, actor),
    listVendors(db),
  ]);
  const summaries = await Promise.all(
    pos.map(async (po) => [po.id, await getPoSummary(db, po.id)] as const),
  );
  const summaryMap = new Map(summaries);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ใบสั่งซื้อ (PO)</h1>
          <p className="text-xs text-slate-500">ติดตามใบสั่งซื้อ สถานะการรับของ และการจ่ายเงิน</p>
        </div>
        {can(actor, 'po.manage') && (
          <Link
            href="/po/new"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
          >
            + เปิดใบสั่งซื้อ (PO)
          </Link>
        )}
      </div>

      <form className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap gap-2">
        <select
          name="projectId"
          defaultValue={params.projectId ?? ''}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
        >
          <option value="">ทุกโครงการ</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} - {p.name}
            </option>
          ))}
        </select>

        <select
          name="vendorId"
          defaultValue={params.vendorId ?? ''}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
        >
          <option value="">ทุกผู้ขาย</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.code} - {v.name}
            </option>
          ))}
        </select>

        <select
          name="status"
          defaultValue={params.status ?? ''}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
        >
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">ร่าง</option>
          <option value="PENDING_APPROVAL">รออนุมัติ</option>
          <option value="APPROVED">อนุมัติแล้ว</option>
          <option value="ORDERED">สั่งของแล้ว</option>
          <option value="COMPLETED">เสร็จสมบูรณ์</option>
          <option value="REJECTED">ตีกลับ</option>
        </select>

        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="ค้นหาเลขที่ PO หรือชื่อร้าน..."
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs flex-1 min-w-[180px]"
        />

        <button
          type="submit"
          className="rounded-lg bg-slate-800 text-white px-4 py-1.5 text-xs font-medium"
        >
          ค้นหา
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">เลขที่ PO</th>
              <th className="px-4 py-3 text-left">โครงการ</th>
              <th className="px-4 py-3 text-left">ผู้ขาย</th>
              <th className="px-4 py-3 text-left">เงื่อนไข</th>
              <th className="px-4 py-3 text-right">ยอดรวม VAT</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
              <th className="px-4 py-3 text-left">วันที่</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pos.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">
                  ไม่พบใบสั่งซื้อ
                </td>
              </tr>
            ) : (
              pos.map((po) => (
                <tr key={po.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/po/${po.id}`} className="text-blue-600 hover:underline">
                      {po.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {po.projectCode} - {po.projectName}
                  </td>
                  <td className="px-4 py-3">{po.vendorName}</td>
                  <td className="px-4 py-3 text-xs">
                    {po.paymentType === 'CREDIT'
                      ? 'เครดิต'
                      : po.paymentType === 'PREPAID'
                      ? 'จ่ายก่อนรับของ'
                      : 'แบ่งจ่ายงวด'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    ฿{formatMoneyDisplay(po.gross)}
                  </td>
                  <td className="px-4 py-3 space-x-1">
                    <DocStatusBadge status={po.status} />
                    {Boolean(po.pendingRevision) && (
                      <DocStatusBadge status="PENDING_APPROVAL" customLabel="รออนุมัติแก้ไข" />
                    )}
                    {(summaryMap.get(po.id)?.labels ?? []).map((lbl) => (
                      <span
                        key={lbl}
                        className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                      >
                        {lbl}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatThaiDate(po.createdAt)}
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
