'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Folder, ChevronDown, ChevronRight, FileText, Trash2, X } from 'lucide-react';
import { deletePrsAction } from './actions';
import type { PrDeleteResult } from '@/server/services/pr-delete';
import { DocStatusBadge } from '@/components/doc-status-badge';
import type { PrStatus } from '@/db/schema';

interface PrItem {
  id: string;
  number: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  requestedBy: string;
  requesterName: string;
  status: PrStatus;
  note: string;
  createdAt: Date;
}

interface ProjectStat {
  projectId: string;
  projectCode: string;
  projectName: string;
  prCount: number;
  poCount: number;
  totalDocs: number;
  totalValue: number;
  prs: PrItem[];
}

export function PrListClient({
  projectStats,
  allPrs,
  canDelete = false,
}: {
  projectStats: ProjectStat[];
  allPrs: PrItem[];
  /** Owner / admin: tick and permanently delete, e.g. test data */
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<PrDeleteResult | null>(null);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleMany = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const selectedPrs = allPrs.filter((p) => selected.has(p.id));
  const tick = (id: string, label: string) =>
    canDelete ? (
      <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} onClick={(e) => e.stopPropagation()} aria-label={`เลือก ${label}`} className="shrink-0" />
    ) : null;
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'project' | 'all'>('project');

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-4 font-sans text-slate-800">
      {/* Header (Image 1) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">ใบขอซื้อ PR</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ติดตามคำขอซื้อจากโครงการ, ทีมงาน, หรือรายการวัสดุที่ต้องใช้ในไซด์งาน
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canDelete && (
            <button
              type="button"
              disabled={selectedPrs.length === 0}
              onClick={() => {
                setResult(null);
                setConfirming(true);
              }}
              title={selectedPrs.length === 0 ? 'ติ๊กเลือกใบขอซื้อที่จะลบก่อน' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> ลบ{selectedPrs.length > 0 && ` (${selectedPrs.length})`}
            </button>
          )}
          {projectStats.length > 0 && (
            <button
              type="button"
              onClick={() => setViewMode(viewMode === 'project' ? 'all' : 'project')}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              {viewMode === 'project' ? 'มุมมองรายการทั้งหมด' : 'มุมมองแยกตามโครงการ'}
            </button>
          )}

          <Link
            href="/pr/new"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1c43ab] text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>สร้างใบขอซื้อ PR</span>
          </Link>
        </div>
      </div>

      {result && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
          <div>
            <p className="font-semibold">ลบแล้ว {result.deleted.length} ใบ{result.deleted.length > 0 && `: ${result.deleted.map((d) => d.number).join(', ')}`}</p>
            {result.kept.length > 0 && (
              <p className="mt-1 text-amber-800">
                ไม่ได้ลบ {result.kept.length} ใบ เพราะมีใบสั่งซื้ออ้างถึงอยู่ (ใช้ &quot;ยกเลิก&quot; แทน):{' '}
                {result.kept.map((k) => `${k.number} → ${k.poNumbers.join(', ')}`).join(' · ')}
              </p>
            )}
          </div>
          <button type="button" onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Table Area (Image 1) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {viewMode === 'project' ? (
          /* Grouped by Project (Image 1) */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="bg-[#102d72] text-xs text-white">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">โครงการ</th>
                  <th className="px-4 py-3 text-center font-medium w-24">PR</th>
                  <th className="px-4 py-3 text-center font-medium w-24">PO</th>
                  <th className="px-4 py-3 text-center font-medium w-32">เอกสารทั้งหมด</th>
                  <th className="px-4 py-3 text-right font-medium w-36">มูลค่า</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projectStats.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-14 text-center text-slate-400 text-xs">
                      ยังไม่มีโครงการที่มีใบขอซื้อ PR
                    </td>
                  </tr>
                ) : (
                  projectStats.map((p) => {
                    const isExpanded = !!expandedProjects[p.projectId];
                    return (
                      <React.Fragment key={p.projectId}>
                        <tr
                          onClick={() => toggleProject(p.projectId)}
                          className="hover:bg-slate-50 cursor-pointer transition"
                        >
                          <td className="px-4 py-3 font-semibold text-slate-900 flex items-center gap-2.5">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-[#2453d4]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                            <Folder className="w-4 h-4 text-[#2453d4]" />
                            <div>
                              <span>{p.projectName}</span>
                              <span className="ml-2 font-mono text-[10px] text-slate-400 font-normal">
                                ({p.projectCode})
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-[#2453d4]">{p.prCount}</td>
                          <td className="px-4 py-3 text-center font-semibold text-slate-700">{p.poCount}</td>
                          <td className="px-4 py-3 text-center font-bold text-slate-900">{p.totalDocs}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900">
                            ฿{p.totalValue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>

                        {/* Expanded PR items in this project */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="bg-slate-50/70 p-3 pl-10 border-t border-slate-100">
                              <div className="space-y-1.5">
                                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                                  {canDelete && (
                                    <input
                                      type="checkbox"
                                      checked={p.prs.every((x) => selected.has(x.id))}
                                      onChange={() => toggleMany(p.prs.map((x) => x.id))}
                                      aria-label={`เลือกทุกใบในโครงการ ${p.projectName}`}
                                    />
                                  )}
                                  รายการใบขอซื้อในโครงการ ({p.prs.length} ฉบับ):
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  {p.prs.map((pr) => (
                                    <div key={pr.id} className="flex items-center gap-2">
                                    {tick(pr.id, pr.number)}
                                    <Link
                                      href={`/pr/${pr.id}`}
                                      className={`flex flex-1 items-center justify-between p-2.5 rounded-lg border hover:border-[#2453d4] hover:shadow-xs transition ${selected.has(pr.id) ? 'border-red-200 bg-red-50/50' : 'bg-white border-slate-200'}`}
                                    >
                                      <div className="flex items-center gap-3">
                                        <FileText className="w-4 h-4 text-slate-400" />
                                        <span className="font-mono font-bold text-[#2453d4]">{pr.number}</span>
                                        <span className="text-slate-600 truncate max-w-sm">
                                          {pr.note || 'ไม่มีหมายเหตุ'}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="text-slate-400 text-[11px]">
                                          ผู้ขอ: {pr.requesterName}
                                        </span>
                                        <DocStatusBadge status={pr.status} />
                                      </div>
                                    </Link>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Flat All PRs Table */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="bg-[#102d72] text-xs text-white">
                <tr>
                  {canDelete && (
                    <th className="w-10 px-4 py-3">
                      <input type="checkbox" checked={allPrs.length > 0 && allPrs.every((x) => selected.has(x.id))} onChange={() => toggleMany(allPrs.map((x) => x.id))} aria-label="เลือกทั้งหมด" />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left font-medium">เลขที่ PR</th>
                  <th className="px-4 py-3 text-left font-medium">โครงการ</th>
                  <th className="px-4 py-3 text-left font-medium">ผู้ขอซื้อ</th>
                  <th className="px-4 py-3 text-left font-medium">วันที่</th>
                  <th className="px-4 py-3 text-center font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allPrs.length === 0 ? (
                  <tr>
                    <td colSpan={canDelete ? 6 : 5} className="py-12 text-center text-slate-400 text-xs">
                      ยังไม่มีรายการใบขอซื้อ PR
                    </td>
                  </tr>
                ) : (
                  allPrs.map((pr) => (
                    <tr key={pr.id} className={`hover:bg-slate-50 transition ${selected.has(pr.id) ? 'bg-red-50/50' : ''}`}>
                      {canDelete && <td className="px-4 py-3">{tick(pr.id, pr.number)}</td>}
                      <td className="px-4 py-3 font-mono font-bold text-[#2453d4]">
                        <Link href={`/pr/${pr.id}`} className="hover:underline">
                          {pr.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{pr.projectName}</td>
                      <td className="px-4 py-3 text-slate-600">{pr.requesterName}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(pr.createdAt).toLocaleDateString('th-TH', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <DocStatusBadge status={pr.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirming && selectedPrs.length > 0 && (
        <ConfirmDeletePrs
          prs={selectedPrs}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            setSelected(new Set());
            setResult(r);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ConfirmDeletePrs({ prs, onClose, onDone }: { prs: PrItem[]; onClose: () => void; onDone: (r: PrDeleteResult) => void }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const r = await deletePrsAction(prs.map((p) => p.id));
      if (r.ok) onDone(r.result);
      else setError(r.error);
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={`ลบใบขอซื้อ ${prs.length} ใบ`}>
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">ลบใบขอซื้อ {prs.length} ใบ</h3>
          <button type="button" onClick={onClose} disabled={pending} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {prs.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 px-3 py-1.5">
                <span className="font-mono text-slate-800">{p.number}</span>
                <span className="truncate text-slate-500">{p.projectName}</span>
              </li>
            ))}
          </ul>
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <p className="font-bold">ลบถาวร กู้คืนไม่ได้</p>
            <p className="mt-1">รายการ ความเห็น และไฟล์แนบของใบขอซื้อจะถูกลบด้วย ใบที่มีใบสั่งซื้ออ้างถึงแล้วจะไม่ถูกลบ เลขที่ PR ที่ลบไปจะไม่ถูกนำกลับมาใช้ซ้ำ</p>
          </div>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">พิมพ์คำว่า &quot;ลบ&quot; เพื่อยืนยัน</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-red-500 focus:outline-none" />
          </label>
          {error && (
            <p role="alert" className="font-medium text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" onClick={confirm} disabled={pending || typed.trim() !== 'ลบ'} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {pending ? 'กำลังลบ...' : `ลบ ${prs.length} ใบ`}
          </button>
        </div>
      </div>
    </div>
  );
}