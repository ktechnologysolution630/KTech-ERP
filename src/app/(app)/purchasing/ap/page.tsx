import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listBoqOverrunRequests } from '@/server/services/boq-overrun';
import { ApDecisionButtons } from '@/components/boq-overrun-panel';

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABEL = { PENDING: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก' } as const;

export default async function PurchasingApPage() {
  const actor = await requireUser();
  const db = await getDb();
  const requests = await listBoqOverrunRequests(db, actor);
  const canDecide = can(actor, 'boqOverrun.approve');

  // Per-project roll-up: counts by status and the total approved over-BOQ value
  const byProject = new Map<
    string,
    { code: string; name: string; pending: number; approved: number; rejected: number; total: number; approvedOver: number }
  >();
  for (const r of requests) {
    const row = byProject.get(r.projectId) ?? {
      code: r.projectCode,
      name: r.projectName,
      pending: 0,
      approved: 0,
      rejected: 0,
      total: 0,
      approvedOver: 0,
    };
    row.total += 1;
    if (r.status === 'PENDING') row.pending += 1;
    if (r.status === 'APPROVED') {
      row.approved += 1;
      row.approvedOver += r.overAmount;
    }
    if (r.status === 'REJECTED') row.rejected += 1;
    byProject.set(r.projectId, row);
  }

  return (
    <div className="space-y-4 font-sans text-slate-800">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">ใบ AP</h1>
        <p className="text-xs text-slate-500 mt-0.5">ติดตามใบขออนุมัติสั่งซื้อเพิ่มเติมจาก BOQ</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] text-xs">
            <thead className="bg-[#102d72] text-xs text-white">
              <tr>
                <th className="px-4 py-3 text-left font-medium">โครงการ</th>
                <th className="px-4 py-3 text-center font-medium w-24">รออนุมัติ</th>
                <th className="px-4 py-3 text-center font-medium w-24">อนุมัติแล้ว</th>
                <th className="px-4 py-3 text-center font-medium w-24">ไม่อนุมัติ</th>
                <th className="px-4 py-3 text-center font-medium w-28">เอกสารทั้งหมด</th>
                <th className="px-4 py-3 text-right font-medium w-40">มูลค่าเกิน BOQ (อนุมัติ)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byProject.size === 0 ? (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-slate-400 text-xs">
                    ยังไม่มีโครงการที่มีใบ AP
                  </td>
                </tr>
              ) : (
                [...byProject.entries()].map(([projectId, p]) => (
                  <tr key={projectId}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-slate-400 mr-2">{p.code}</span>
                      <span className="font-medium">{p.name}</span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono">{p.pending}</td>
                    <td className="px-4 py-3 text-center font-mono">{p.approved}</td>
                    <td className="px-4 py-3 text-center font-mono">{p.rejected}</td>
                    <td className="px-4 py-3 text-center font-mono">{p.total}</td>
                    <td className="px-4 py-3 text-right font-mono">{baht(p.approvedOver)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {requests.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left">เลขที่ / วันที่</th>
                  <th className="px-4 py-2 text-left">โครงการ</th>
                  <th className="px-4 py-2 text-left">PO</th>
                  <th className="px-4 py-2 text-left">ผู้ขอ</th>
                  <th className="px-4 py-2 text-right">มูลค่าเกิน BOQ</th>
                  <th className="px-4 py-2 text-left">เหตุผล</th>
                  <th className="px-4 py-2 text-left">สถานะ / จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <div className="font-mono font-semibold">{r.number}</div>
                      <div className="text-slate-400">{new Date(r.createdAt).toLocaleDateString('th-TH')}</div>
                    </td>
                    <td className="px-4 py-2">{r.projectName}</td>
                    <td className="px-4 py-2">
                      <Link href={`/po/${r.poId}`} className="text-[#2453d4] hover:underline font-mono">
                        {r.poNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{r.requestedByName}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">{baht(r.overAmount)}</td>
                    <td className="px-4 py-2 text-slate-600 max-w-xs">{r.reason}</td>
                    <td className="px-4 py-2">
                      {canDecide && r.status === 'PENDING' ? (
                        <ApDecisionButtons request={r} />
                      ) : (
                        <span className="font-medium">{STATUS_LABEL[r.status]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
