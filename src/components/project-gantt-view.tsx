'use client';

import React from 'react';
import {
  computeProjectProgress,
  plannedCurve,
  plannedProgressAt,
  TASK_STATUS_LABELS,
} from '@/domain/schedule';
import type { TaskDto } from '@/server/services/tasks';

interface ProjectGanttViewProps {
  tasks: TaskDto[];
  today: string;
}

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function ProjectGanttView({ tasks, today }: ProjectGanttViewProps) {
  const dated = tasks.filter((t) => t.startDate && t.dueDate);
  if (dated.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-xs text-slate-400 shadow-xs">
        ยังไม่มีงานที่ระบุวันเริ่มและวันกำหนดเสร็จ · เพิ่มวันที่ในแท็บ &quot;งาน&quot; เพื่อสร้างแผนงานและ S-Curve
      </div>
    );
  }

  const rangeStart = dayNumber(dated.map((t) => t.startDate as string).sort()[0]);
  const rangeEnd = dayNumber(dated.map((t) => t.dueDate as string).sort().at(-1) as string);
  const span = Math.max(1, rangeEnd - rangeStart + 1);
  const pct = (iso: string) => ((dayNumber(iso) - rangeStart) / span) * 100;
  const todayPct = Math.min(100, Math.max(0, pct(today)));
  const todayInRange = dayNumber(today) >= rangeStart && dayNumber(today) <= rangeEnd;

  const curve = plannedCurve(tasks);
  const actual = computeProjectProgress(tasks);
  const plannedToday = plannedProgressAt(tasks, today);
  const variance = Math.round((actual - plannedToday) * 10) / 10;

  // S-curve chart geometry (viewBox units)
  const W = 600;
  const H = 200;
  const x = (iso: string) => ((dayNumber(iso) - rangeStart) / span) * W;
  const y = (p: number) => H - (p / 100) * H;
  const plannedPath = curve.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${x(pt.date).toFixed(1)} ${y(pt.planned).toFixed(1)}`).join(' ');

  return (
    <div className="space-y-4 animate-glass-card">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">แผนงาน (Gantt)</h3>
          <p className="text-xs text-slate-500">แถบสีอ่อนคือช่วงแผนงาน แถบสีเข้มคือความคืบหน้า เส้นแดงคือวันนี้</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left w-12">No.</th>
                <th className="px-3 py-2 text-left w-56">รายการงาน</th>
                <th className="px-3 py-2 text-left w-24">เริ่ม</th>
                <th className="px-3 py-2 text-left w-24">สิ้นสุด</th>
                <th className="px-3 py-2 text-right w-16">%</th>
                <th className="px-3 py-2 text-left">
                  <div className="flex justify-between font-normal text-[10px] text-slate-400">
                    <span>{monthLabel(dated.map((t) => t.startDate as string).sort()[0])}</span>
                    <span>{monthLabel(dated.map((t) => t.dueDate as string).sort().at(-1) as string)}</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => (
                <tr key={t.id} className={t.parentId === null ? 'font-semibold' : ''}>
                  <td className="px-3 py-2 font-mono text-slate-500">{t.wbs}</td>
                  <td className={`px-3 py-2 text-slate-800 ${t.parentId ? 'pl-6' : ''}`} title={TASK_STATUS_LABELS[t.status]}>
                    {t.title}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">{t.startDate ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{t.dueDate ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-right">{t.progress}%</td>
                  <td className="px-3 py-2">
                    <div className="relative h-4 bg-slate-50 rounded">
                      {t.startDate && t.dueDate && (
                        <div
                          className="absolute top-0.5 bottom-0.5 rounded bg-blue-200 overflow-hidden"
                          style={{
                            left: `${pct(t.startDate)}%`,
                            width: `${Math.max(0.8, ((dayNumber(t.dueDate) - dayNumber(t.startDate) + 1) / span) * 100)}%`,
                          }}
                        >
                          <div className="h-full bg-[#2453d4]" style={{ width: `${t.progress}%` }} />
                        </div>
                      )}
                      {todayInRange && (
                        <div className="absolute top-0 bottom-0 w-px bg-red-500" style={{ left: `${todayPct}%` }} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">S-Curve ความคืบหน้าสะสม</h3>
            <p className="text-xs text-slate-500">แผนงานถ่วงน้ำหนักตามมูลค่างาน (หรือระยะเวลา เมื่อยังไม่ระบุมูลค่า)</p>
          </div>
          <div className="flex gap-4 text-xs">
            <div>
              <div className="text-slate-400">แผน ณ วันนี้</div>
              <div className="font-mono font-bold text-slate-800">{plannedToday}%</div>
            </div>
            <div>
              <div className="text-slate-400">ทำได้จริง</div>
              <div className="font-mono font-bold text-emerald-700">{actual}%</div>
            </div>
            <div>
              <div className="text-slate-400">ผลต่าง</div>
              <div className={`font-mono font-bold ${variance < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {variance > 0 ? '+' : ''}
                {variance}%
              </div>
            </div>
          </div>
        </div>

        <svg viewBox={`-30 -10 ${W + 40} ${H + 30}`} className="w-full h-56" role="img" aria-label="S-Curve แผนงานเทียบความคืบหน้าจริง">
          {[0, 25, 50, 75, 100].map((p) => (
            <g key={p}>
              <line x1={0} x2={W} y1={y(p)} y2={y(p)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={-6} y={y(p) + 3} fontSize={9} textAnchor="end" fill="#94a3b8">
                {p}%
              </text>
            </g>
          ))}
          <path d={plannedPath} fill="none" stroke="#2453d4" strokeWidth={2} strokeDasharray="5 4" />
          {todayInRange && (
            <>
              <line x1={x(today)} x2={x(today)} y1={0} y2={H} stroke="#ef4444" strokeWidth={1} />
              <line x1={0} y1={H} x2={x(today)} y2={y(actual)} stroke="#10b981" strokeWidth={2.5} />
              <circle cx={x(today)} cy={y(actual)} r={4} fill="#10b981" />
            </>
          )}
          {curve
            .filter((_, i) => i === 0 || i === curve.length - 1 || i % Math.ceil(curve.length / 6) === 0)
            // One label per month: the start date and its month end share a month
            .filter((pt, i, arr) => i === 0 || monthLabel(pt.date) !== monthLabel(arr[i - 1].date))
            .map((pt) => (
              <text key={pt.date} x={x(pt.date)} y={H + 16} fontSize={9} textAnchor="middle" fill="#94a3b8">
                {monthLabel(pt.date)}
              </text>
            ))}
        </svg>
        <div className="flex gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-[#2453d4]" /> แผนงาน (Planned)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-emerald-500" /> ความคืบหน้าจริง ณ วันนี้
          </span>
        </div>
        <p className="text-[11px] text-slate-400">
          เส้นจริงแสดงเป็นเส้นตรงถึงค่าปัจจุบัน เพราะระบบยังไม่ได้เก็บประวัติความคืบหน้ารายวัน
        </p>
      </div>
    </div>
  );
}
