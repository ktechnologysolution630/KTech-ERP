'use client';

import React, { useState } from 'react';
import { BarChart3, CalendarRange, ClipboardList, Plus } from 'lucide-react';
import { DailyReportsPanel, type DailyProject, type DailyTaskOption } from './daily-reports-panel';
import { PeriodicReportView } from './periodic-report';
import { RibbonGroup, RibbonTool } from './report-sheet';

type ReportTab = 'DAILY' | 'WEEK' | 'MONTH';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'DAILY', label: 'Daily Report' },
  { key: 'WEEK', label: 'Weekly Report' },
  { key: 'MONTH', label: 'Monthly Report' },
];

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
      <div className="rounded-t-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <h3 className="text-sm font-semibold text-slate-900">Project Reports</h3>
          <span className="truncate text-[11px] text-slate-500">{project.name}</span>
        </div>
        <div role="tablist" aria-label="ประเภทรายงาน" className="flex items-stretch overflow-x-auto border-t border-slate-200">
          <span className="flex items-center bg-[#173a7a] px-4 py-2 text-[11px] font-bold tracking-wide text-white">REPORTS</span>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap border-r border-slate-200 px-4 py-2 text-xs font-medium transition ${
                tab === t.key ? 'bg-white font-bold text-[#173a7a] shadow-[inset_0_-2px_0_#173a7a]' : 'bg-slate-50 text-slate-600 hover:text-slate-900'
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
            <div className="flex flex-wrap items-stretch rounded-b-xl border border-t-0 border-slate-200 bg-white shadow-xs">
              <RibbonGroup caption="ประเภทรายงาน">
                <RibbonTool icon={<ClipboardList className="h-6 w-6" />} title="Daily Report" subtitle="รายงานประจำวัน" />
              </RibbonGroup>
              <RibbonGroup caption="จัดการรายงาน">
                <RibbonTool icon={<Plus className="h-6 w-6" />} title="สร้างรายงาน" onClick={onNew} />
              </RibbonGroup>
            </div>
          )}
        />
      )}
      {tab === 'WEEK' && (
        <PeriodicReportView
          projectId={project.id}
          kind="WEEK"
          today={today}
          typeTool={<RibbonTool icon={<CalendarRange className="h-6 w-6" />} title="Weekly Report" subtitle="รายงานประจำสัปดาห์" />}
        />
      )}
      {tab === 'MONTH' && (
        <PeriodicReportView
          projectId={project.id}
          kind="MONTH"
          today={today}
          typeTool={<RibbonTool icon={<BarChart3 className="h-6 w-6" />} title="Monthly Report" subtitle="รายงานประจำเดือน" />}
        />
      )}
    </div>
  );
}
