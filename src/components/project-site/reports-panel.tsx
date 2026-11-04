'use client';

import React, { useState } from 'react';
import { BarChart3, CalendarRange, ClipboardList, Plus } from 'lucide-react';
import { DailyReportsPanel, type DailyProject, type DailyTaskOption } from './daily-reports-panel';
import { PeriodicReportView } from './periodic-report';

type ReportTab = 'DAILY' | 'WEEK' | 'MONTH';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'DAILY', label: 'Daily Report' },
  { key: 'WEEK', label: 'Weekly Report' },
  { key: 'MONTH', label: 'Monthly Report' },
];

function ToolLabel({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2.5 border-r border-slate-200 pr-5">
      <span className="text-[#173a7a]">{icon}</span>
      <div>
        <div className="text-xs font-bold text-slate-900">{title}</div>
        <div className="text-[11px] text-slate-500">{subtitle}</div>
      </div>
    </div>
  );
}

/** One place for project reports: staff fill in Daily only; Weekly and Monthly build themselves from it. */
export function ReportsPanel({
  project,
  tasks,
  today,
  preparedBy,
  logoUrl,
}: {
  project: DailyProject;
  tasks: DailyTaskOption[];
  today: string;
  preparedBy: string;
  logoUrl: string | null;
}) {
  const [tab, setTab] = useState<ReportTab>('DAILY');

  return (
    <div>
      <div className="rounded-t-xl border border-slate-200 bg-white shadow-xs">
        <h3 className="px-4 pt-3 pb-2 text-sm font-bold text-slate-900">รายงานโครงการ (Project Reports)</h3>
        <div role="tablist" aria-label="ประเภทรายงาน" className="flex items-end gap-1 overflow-x-auto border-t border-slate-200 bg-slate-50 px-2 pt-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-t-lg px-4 py-2 text-xs font-semibold transition ${
                tab === t.key ? 'border border-b-0 border-slate-200 bg-white text-[#173a7a]' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'DAILY' && (
        <DailyReportsPanel
          project={project}
          tasks={tasks}
          today={today}
          preparedBy={preparedBy}
          logoUrl={logoUrl}
          renderToolbar={(onNew) => (
            <div className="flex flex-wrap items-center gap-5 rounded-b-xl border border-t-0 border-slate-200 bg-white px-4 py-3 shadow-xs">
              <ToolLabel icon={<ClipboardList className="h-6 w-6" />} title="Daily Report" subtitle="รายงานประจำวัน · กรอกเฉพาะรายงานนี้" />
              <button type="button" onClick={onNew} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                <Plus className="h-4 w-4" /> สร้างรายงาน
              </button>
            </div>
          )}
        />
      )}
      {tab === 'WEEK' && (
        <PeriodicReportView
          projectId={project.id}
          kind="WEEK"
          today={today}
          toolbarLead={<ToolLabel icon={<CalendarRange className="h-6 w-6" />} title="Weekly Report" subtitle="รายงานประจำสัปดาห์ · สร้างอัตโนมัติ" />}
        />
      )}
      {tab === 'MONTH' && (
        <PeriodicReportView
          projectId={project.id}
          kind="MONTH"
          today={today}
          toolbarLead={<ToolLabel icon={<BarChart3 className="h-6 w-6" />} title="Monthly Report" subtitle="รายงานประจำเดือน · สร้างอัตโนมัติ" />}
        />
      )}
    </div>
  );
}
