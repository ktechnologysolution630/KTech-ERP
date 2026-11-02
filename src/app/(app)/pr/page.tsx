import Link from 'next/link';
import { getDb } from '@/db/client';
import { type PrStatus } from '@/db/schema';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { listPrs } from '@/server/services/pr';
import { DocStatusBadge } from '@/components/doc-status-badge';

export default async function PrListPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; status?: PrStatus; q?: string }>;
}) {
  const actor = await requireUser();
  const db = await getDb();
  const params = await searchParams;
  const [prs, projects] = await Promise.all([
    listPrs(db, actor, params),
    listProjects(db, actor),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ใบขอซื้อ (PR)</h1>
          <p className="text-xs text-slate-500">รายการขอซื้อวัสดุและอุปกรณ์หน้างาน</p>
        </div>
        <Link
          href="/pr/new"
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
        >
          + เปิดใบขอซื้อ (PR)
        </Link>
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
          name="status"
          defaultValue={params.status ?? ''}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
        >
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">ร่าง</option>
          <option value="SUBMITTED">รออนุมัติ</option>
          <option value="APPROVED">อนุมัติแล้ว</option>
          <option value="REJECTED">ตีกลับ</option>
          <option value="CLOSED">ปิดแล้ว</option>
        </select>

        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="ค้นหาเลขที่ PR หรือหมายเหตุ..."
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
              <th className="px-4 py-3 text-left">เลขที่</th>
              <th className="px-4 py-3 text-left">โครงการ</th>
              <th className="px-4 py-3 text-left">ผู้ขอซื้อ</th>
              <th className="px-4 py-3 text-left">วันที่</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {prs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">
                  ไม่พบใบขอซื้อ
                </td>
              </tr>
            ) : (
              prs.map((pr) => (
                <tr key={pr.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/pr/${pr.id}`} className="text-blue-600 hover:underline">
                      {pr.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {pr.projectCode} - {pr.projectName}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{pr.requesterName}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatThaiDate(pr.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <DocStatusBadge status={pr.status} />
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
