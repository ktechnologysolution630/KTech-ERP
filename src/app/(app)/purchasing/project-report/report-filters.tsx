'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DateInput } from '@/components/date-input';

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#2453d4] focus:outline-none';

/** Filters of the project purchasing report; "สร้างรายงาน" puts them in the URL so the page renders the report. */
export function ReportFilters({
  projects,
  initial,
  hasReport,
}: {
  projects: { id: string; code: string; name: string }[];
  initial: { projectId: string; from: string; to: string; q: string };
  hasReport: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState(initial.projectId);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [q, setQ] = useState(initial.q);
  const badRange = from !== '' && to !== '' && from > to;

  const params = () => {
    const p = new URLSearchParams({ projectId });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  };
  // Print and PDF use what is on screen; changed filters need "สร้างรายงาน" first
  const unchanged = projectId === initial.projectId && from === initial.from && to === initial.to && q.trim() === initial.q;
  const canExport = hasReport && unchanged;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!projectId || badRange) return;
        startTransition(() => router.push(`/purchasing/project-report?${params()}`));
      }}
      className="space-y-3 border-b border-slate-200 bg-white px-5 py-4 text-xs"
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <label className="block lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-700">โครงการ *</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required className={inputClass}>
            <option value="">เลือกโครงการ</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} - {p.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1 block font-medium text-slate-700">ช่วงวันที่ (วันที่ออก PO)</span>
          <div className="grid grid-cols-2 gap-2">
            <DateInput value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} className={inputClass} aria-label="วันที่เริ่มต้น" />
            <DateInput value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} className={inputClass} aria-label="ถึงวันที่" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
        <label className="block flex-1">
          <span className="mb-1 block font-medium text-slate-700">ค้นหา PO / Supplier / รายการจัดซื้อ</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} placeholder="เลขที่ PO, ผู้ขาย หรือชื่อรายการ" className={inputClass} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!projectId || badRange || isPending} className="rounded-lg bg-[#2453d4] px-5 py-2 font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
            {isPending ? 'กำลังสร้าง...' : 'สร้างรายงาน'}
          </button>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => window.print()}
            title={canExport ? undefined : 'สร้างรายงานก่อน'}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            พิมพ์
          </button>
          {canExport ? (
            <a href={`/api/reports/project-purchase?${params()}`} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50">
              ดาวน์โหลด PDF
            </a>
          ) : (
            <button type="button" disabled title="สร้างรายงานก่อน" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-700 opacity-50">
              ดาวน์โหลด PDF
            </button>
          )}
        </div>
      </div>
      {badRange && (
        <p role="alert" className="font-medium text-red-600">
          วันที่เริ่มต้นต้องไม่หลังวันที่สิ้นสุด
        </p>
      )}
    </form>
  );
}
