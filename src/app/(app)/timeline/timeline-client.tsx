'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, ChevronRight, Search } from 'lucide-react';
import { PROJECT_STATUS_LABELS, isProjectClosed } from '@/domain/project';
import type { TimelineRow } from '@/server/services/timeline';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const thaiDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
};

type StatusFilter = 'OPEN' | 'COMPLETED' | 'ALL';

const control =
  'rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white text-slate-700 text-xs focus:outline-hidden focus:border-[#2453d4]';

export function TimelineClient({ today, rows }: { today: string; rows: TimelineRow[] }) {
  const thisYear = Number(today.slice(0, 4));
  const years = useMemo(() => {
    const set = new Set<number>([thisYear]);
    for (const r of rows) {
      if (!r.startDate || !r.endDate) continue;
      for (let y = Number(r.startDate.slice(0, 4)); y <= Number(r.endDate.slice(0, 4)); y++) set.add(y);
    }
    return [...set].sort();
  }, [rows, thisYear]);

  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [pm, setPm] = useState('');
  const [year, setYear] = useState(thisYear);
  const [query, setQuery] = useState('');

  const pms = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.pmId && r.pmName) map.set(r.pmId, r.pmName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'th'));
  }, [rows]);

  const yearStart = dayNumber(`${year}-01-01`);
  const yearDays = dayNumber(`${year + 1}-01-01`) - yearStart;
  const todayInYear = Number(today.slice(0, 4)) === year ? ((dayNumber(today) - yearStart + 0.5) / yearDays) * 100 : null;

  const filtered = rows.filter((r) => {
    if (status === 'OPEN' && isProjectClosed(r.status)) return false;
    if (status === 'COMPLETED' && r.status !== 'COMPLETED') return false;
    if (pm && r.pmId !== pm) return false;
    const q = query.trim().toLowerCase();
    if (q && !`${r.code} ${r.name} ${r.location}`.toLowerCase().includes(q)) return false;
    // Hide projects that are entirely outside the chosen year (undated projects stay visible)
    if (r.startDate && r.endDate && (Number(r.endDate.slice(0, 4)) < year || Number(r.startDate.slice(0, 4)) > year)) return false;
    return true;
  });

  const bar = (r: TimelineRow) => {
    if (!r.startDate || !r.endDate) return null;
    const s = Math.max(0, dayNumber(r.startDate) - yearStart);
    const e = Math.min(yearDays, dayNumber(r.endDate) - yearStart + 1);
    if (e <= s) return null;
    return { left: (s / yearDays) * 100, width: ((e - s) / yearDays) * 100 };
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Timeline โครงการ</h1>
        <p className="text-xs text-slate-500 mt-0.5">ระยะเวลาและความคืบหน้าจริงเทียบแผนของทุกโครงการ</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-wrap items-end gap-2.5 text-xs">
        <label className="flex flex-col">
          <span className="text-[10px] text-slate-400 font-medium mb-0.5">สถานะ</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={control}>
            <option value="OPEN">วางแผน/ดำเนินการ/พักงาน</option>
            <option value="COMPLETED">เสร็จสิ้น</option>
            <option value="ALL">ทั้งหมด</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-slate-400 font-medium mb-0.5">Project Manager</span>
          <select value={pm} onChange={(e) => setPm(e.target.value)} className={control}>
            <option value="">ทุก Project Manager</option>
            {pms.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-slate-400 font-medium mb-0.5">ปี (พ.ศ.)</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={control}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y + 543}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col flex-1 min-w-[180px]">
          <span className="text-[10px] text-slate-400 font-medium mb-0.5">ค้นหา</span>
          <span className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="รหัส ชื่อ หรือสถานที่" className={`${control} w-full pl-8`} />
          </span>
        </label>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <h2 className="font-bold text-slate-800 text-sm">แผนงานตามช่วงเวลา (ปี {year + 543})</h2>
          <div className="flex flex-wrap items-center gap-4 text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> เสร็จสิ้นแล้ว
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600" /> ระยะเวลาโครงการ
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> ทำได้จริง
            </span>
            <span className="font-semibold text-slate-700 pl-2 border-l border-slate-200">{filtered.length} โครงการ</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600">
              {MONTHS.map((m, i) => {
                const current = year === thisYear && i + 1 === Number(today.slice(5, 7));
                return (
                  <div key={m} className={`py-2 text-center border-r border-slate-200/80 last:border-r-0 ${current ? 'bg-blue-100/60 text-blue-700 font-bold' : ''}`}>
                    {m}
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && <div className="py-12 text-center text-sm text-slate-400">ไม่มีโครงการตามเงื่อนไขที่เลือก</div>}

            <div className="divide-y divide-slate-100">
              {filtered.map((r) => {
                const b = bar(r);
                const behind = r.plannedProgress - r.progress;
                return (
                  <div key={r.id} className="p-4 hover:bg-slate-50/60 group">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{r.code}</span>
                        {r.status === 'COMPLETED' && <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />}
                        <Link href={`/projects/${r.id}`} prefetch={false} className="font-bold text-sm text-slate-900 group-hover:text-blue-600 hover:underline flex items-center gap-1 truncate">
                          <span className="truncate">{r.name}</span>
                          <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="text-slate-400">PM: {r.pmName ?? '-'}</span>
                        <span className="text-slate-500">{PROJECT_STATUS_LABELS[r.status]}</span>
                        <span className="font-mono text-slate-600" title={r.datesFromTasks ? 'คำนวณจากวันที่ของงานใน Gantt' : undefined}>
                          {r.startDate && r.endDate ? `${thaiDate(r.startDate)} - ${thaiDate(r.endDate)}${r.datesFromTasks ? ' *' : ''}` : 'ยังไม่กำหนดระยะเวลา'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            behind > 5 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}
                        >
                          ทำได้ {r.progress}% / แผน {r.plannedProgress}%
                        </span>
                      </div>
                    </div>

                    <div className="h-6 bg-slate-100/70 rounded-md relative overflow-hidden">
                      <div className="absolute inset-0 grid grid-cols-12 pointer-events-none">
                        {MONTHS.map((m) => (
                          <div key={m} className="h-full border-r border-slate-200/60 last:border-r-0" />
                        ))}
                      </div>
                      {b && (
                        <div
                          className={`absolute top-1 bottom-1 rounded overflow-hidden ${r.status === 'COMPLETED' ? 'bg-emerald-600' : 'bg-[#2453d4]'}`}
                          style={{ left: `${b.left}%`, width: `${b.width}%` }}
                          title={`${r.code} · ทำได้ ${r.progress}%`}
                        >
                          <div className="absolute inset-y-0 left-0 bg-emerald-400/70" style={{ width: `${Math.min(100, r.progress)}%` }} />
                          <span className="relative px-2 text-[10px] font-semibold text-white leading-4 truncate block">{r.name}</span>
                        </div>
                      )}
                      {!b && (
                        <span className="absolute inset-0 flex items-center px-2 text-[10px] text-slate-400">
                          {r.startDate && r.endDate ? 'ไม่อยู่ในปีที่เลือก' : `ยังไม่กำหนดวันเริ่ม-สิ้นสุด · ${r.taskCount} งาน`}
                        </span>
                      )}
                      {todayInYear !== null && <div className="absolute top-0 bottom-0 w-px bg-rose-500" style={{ left: `${todayInYear}%` }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-400">
          เส้นแดง = วันนี้ · * = ใช้วันที่จากงานใน Gantt เพราะยังไม่ได้กำหนดวันในสัญญาโครงการ
        </div>
      </div>
    </div>
  );
}
