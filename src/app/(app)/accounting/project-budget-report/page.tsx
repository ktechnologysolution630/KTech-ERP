import Link from 'next/link';
import { ArrowLeft, Folder } from 'lucide-react';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { getProjectCostPerformance } from '@/server/services/project-finance';
import { PrintRoot } from '@/components/project-site/report-sheet';
import { PrintButton } from '../print-button';
import { money } from '../shared';

export default async function ProjectBudgetReportPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const projects = await listProjects(db, actor);
  const project = sp.projectId ? projects.find((p) => p.id === sp.projectId) : undefined;

  if (!project) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">รายงานงบประมาณโครงการ</h1>
          <p className="text-xs text-slate-500">รายงานงบตั้งต้นจาก BOQ เทียบกับยอดใช้ไปจากใบสั่งซื้อและบิลจ่ายออก</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีโครงการ</p>}
          {projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <Folder className="h-5 w-5 text-[#2453d4]" />
                <div>
                  <p className="font-semibold text-slate-900">{p.name}</p>
                  <p className="font-mono text-[11px] text-slate-500">{p.code}</p>
                </div>
              </div>
              <Link href={`?projectId=${p.id}`} className="rounded-lg bg-[#2453d4] px-3 py-1.5 text-xs font-semibold text-white">
                เลือก
              </Link>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const cp = await getProjectCostPerformance(db, actor, project.id);
  const totals = cp.categories.reduce((a, c) => ({ budget: a.budget + c.budget, used: a.used + c.committed }), { budget: 0, used: 0 });
  const report = (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="text-base font-bold">รายงานงบประมาณโครงการ</p>
          <p>
            {project.code} {project.name}
          </p>
        </div>
        <p className="text-right text-slate-600">
          ข้อมูล ณ {cp.asOf} · งบจาก {cp.budgetSource === 'BOQ' ? 'BOQ หลัก' : cp.budgetSource === 'PROJECT' ? 'มูลค่าโครงการ' : 'ยังไม่มีงบ'}
        </p>
      </div>
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="bg-[#102d72] text-white">
          <tr>
            {['หมวดงาน', 'งบตั้งต้น', 'ใช้ไปแล้ว', 'คงเหลือ', '% ที่ใช้'].map((h) => (
              <th key={h} className={`border border-[#102d72] px-2 py-2 font-medium ${h === 'หมวดงาน' ? 'text-left' : 'text-right'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cp.categories.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-8 text-center text-slate-400">
                โครงการนี้ยังไม่มี BOQ หรืองบประมาณ
              </td>
            </tr>
          ) : (
            cp.categories.map((c) => (
              <tr key={c.key} className="border-b border-slate-100">
                <td className="px-2 py-1.5">{c.name}</td>
                <td className="px-2 py-1.5 text-right">{money(c.budget)}</td>
                <td className="px-2 py-1.5 text-right">{money(c.committed)}</td>
                <td className={`px-2 py-1.5 text-right ${c.remaining < 0 ? 'font-semibold text-red-600' : ''}`}>{money(c.remaining)}</td>
                <td className="px-2 py-1.5 text-right">
                  <span className={c.usedPercent > 100 ? 'font-semibold text-red-600' : c.usedPercent >= 80 ? 'text-amber-700' : ''}>{c.usedPercent.toFixed(1)}%</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot className="bg-slate-50 font-semibold">
          <tr>
            <td className="px-2 py-2">รวม</td>
            <td className="px-2 py-2 text-right">{money(totals.budget)}</td>
            <td className="px-2 py-2 text-right">{money(totals.used)}</td>
            <td className="px-2 py-2 text-right">{money(totals.budget - totals.used)}</td>
            <td className="px-2 py-2 text-right">{totals.budget > 0 ? ((totals.used / totals.budget) * 100).toFixed(1) : '0.0'}%</td>
          </tr>
        </tfoot>
      </table>
      {cp.unlinkedCommitted > 0 && <p className="text-amber-700">ยอดสั่งซื้อที่ยังไม่ได้ผูกกับหมวด BOQ {money(cp.unlinkedCommitted)} บาท (ไม่รวมในตารางด้านบน)</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/accounting/project-budget-report" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> เลือกโครงการอื่น
        </Link>
        <PrintButton />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">{report}</div>
      <PrintRoot>
        <div className="a4-page p-6">{report}</div>
      </PrintRoot>
    </div>
  );
}
