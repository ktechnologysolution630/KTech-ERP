'use client';

import React, { useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download, FileText, Info } from 'lucide-react';
import { loadPeriodicReportAction } from '@/app/(app)/projects/[id]/site-actions';
import { formatMoneyDisplay } from '@/domain/money';
import { addDays, formatPeriod, monthOf, weekOf } from '@/domain/site-report';
import type { PeriodicReport as Report, ReportKind } from '@/server/services/site-reports';
import { A4Page, DataTable, InfoGrid, Logo, pct, points, PrintRoot, ProgressCurve, Sheet, thaiShortDate } from './report-sheet';
import { useSiteLoader } from './use-site-loader';

const OUTCOME = { COMPLETED: 'เสร็จ', DELAYED: 'ล่าช้า' } as const;
const money = (n: number) => formatMoneyDisplay(n);

function PageHead({ report, title, subtitle }: { report: Report; title: string; subtitle: string }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b-2 border-[#173a7a] pb-2">
      <div className="flex items-center gap-3">
        <Logo name={report.company.name} url={report.company.logoUrl} />
        <div>
          <div className="text-[10px] text-slate-600">{report.company.name}</div>
          <h2 className="text-base font-bold text-[#173a7a]">
            {title} <span className="font-medium text-slate-700">/ {subtitle}</span>
          </h2>
        </div>
      </div>
      <div className="text-right text-[10px] text-slate-600">
        <div className="font-mono font-bold text-slate-900">{report.number}</div>
        <div>{formatPeriod(report.period)}</div>
      </div>
    </header>
  );
}

const projectRows = (r: Report): [string, React.ReactNode][] => [
  ['โครงการ', r.project.name],
  ['รหัสโครงการ', r.project.code],
  ['ลูกค้า', r.project.client],
  ['ผู้จัดการโครงการ', r.project.pmName],
  ['สถานที่', r.project.location],
  ['ระยะเวลาโครงการ', r.project.startDate || r.project.endDate ? `${thaiShortDate(r.project.startDate)} - ${thaiShortDate(r.project.endDate)}` : '-'],
  ['ข้อมูลถึงวันที่', thaiShortDate(r.cutoff)],
  ['Daily Report ที่ส่งแล้ว', `${r.sources.submitted} ฉบับ`],
];

function WorkSheet({ report, title }: { report: Report; title: string }) {
  return (
    <Sheet title={title}>
      <DataTable
        head={['วันที่', 'WBS', 'รายละเอียดงาน', 'สะสม (%)', 'ผล', 'หมายเหตุ']}
        align={['left', 'left', 'left', 'right', 'center', 'left']}
        empty="ไม่มีงานจาก Daily Report ในช่วงนี้"
        rows={report.work.map((w) => [
          thaiShortDate(w.date),
          w.wbs ?? '-',
          w.description || '-',
          w.progressPercent ?? '-',
          w.outcome ? OUTCOME[w.outcome] : '-',
          w.note || '-',
        ])}
      />
    </Sheet>
  );
}

function CategorySheet({ report }: { report: Report }) {
  return (
    <Sheet title="ความก้าวหน้าตามหมวดงาน (Progress by Work Category)">
      <DataTable
        head={['หมวดงาน', 'แผน (%)', 'จริงก่อนหน้า (%)', 'จริง (%)', 'เพิ่มขึ้น', 'ผลต่าง']}
        align={['left', 'right', 'right', 'right', 'right', 'right']}
        empty="ยังไม่มีงานในโครงการ"
        rows={report.categories.map((c) => [
          c.name,
          c.planned,
          c.previousActual,
          c.actual,
          points(Math.round((c.actual - c.previousActual) * 10) / 10),
          points(Math.round((c.actual - c.planned) * 10) / 10),
        ])}
      />
    </Sheet>
  );
}

function ResourceSheets({ report }: { report: Report }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Sheet title="คนงาน (Labour)">
        <DataTable
          head={['บริษัท / ประเภท', 'แรงงาน (คน-วัน)', 'ชั่วโมงรวม']}
          align={['left', 'right', 'right']}
          empty="ไม่มีข้อมูล"
          rows={report.rollup.labour.map((l) => [l.company, l.manDays, l.manHours])}
        />
      </Sheet>
      <Sheet title="เครื่องมือ-เครื่องจักร / วัสดุที่เบิกใช้">
        <DataTable
          head={['รายการ', 'ปริมาณ']}
          align={['left', 'right']}
          empty="ไม่มีข้อมูล"
          rows={[...report.rollup.equipment.map((e) => [e.type, `${e.hours} ชม.`]), ...report.materials.map((m) => [m.name, `${m.quantity} ${m.unit}`])]}
        />
      </Sheet>
    </div>
  );
}

function FinanceSheet({ report }: { report: Report }) {
  if (!report.finance) return null;
  const f = report.finance;
  return (
    <Sheet title="สรุปการเงิน (Financial Summary) · บาท">
      <DataTable
        head={['มูลค่าสัญญา/งบ', 'VO อนุมัติแล้ว', 'ต้นทุนถึงปัจจุบัน', 'วางบิลแล้ว', 'รับเงินแล้ว']}
        align={['right', 'right', 'right', 'right', 'right']}
        empty="-"
        rows={[[money(f.contractValue), money(f.approvedVo), money(f.costToDate), money(f.billed), money(f.received)]]}
      />
    </Sheet>
  );
}

function CriticalSheet({ report }: { report: Report }) {
  return (
    <Sheet title="กิจกรรมวิกฤต / ล่าช้า (Critical Activities / Delay)">
      <DataTable
        head={['WBS', 'กิจกรรม', 'กำหนดเสร็จ', 'จริง (%)', 'สาเหตุ']}
        align={['left', 'left', 'left', 'right', 'left']}
        empty="ไม่มีกิจกรรมที่ล่าช้า"
        rows={report.critical.map((c) => [c.wbs, c.title, thaiShortDate(c.dueDate), c.progress, c.cause])}
      />
    </Sheet>
  );
}

function NextPlanSheet({ report, title }: { report: Report; title: string }) {
  return (
    <Sheet title={`${title} (${formatPeriod(report.next)})`}>
      <DataTable
        head={['WBS', 'งาน', 'เริ่ม', 'กำหนดเสร็จ', 'จริง (%)']}
        align={['left', 'left', 'left', 'left', 'right']}
        empty="ไม่มีงานตามแผนในช่วงถัดไป (จาก Gantt)"
        rows={report.nextPlan.map((t) => [t.wbs, t.title, thaiShortDate(t.startDate), thaiShortDate(t.dueDate), t.progress])}
      />
    </Sheet>
  );
}

function IssueSafetySheet({ report }: { report: Report }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Sheet title="ปัญหา / อุปสรรค (Issues)">
        <DataTable head={['วันที่', 'รายละเอียด']} empty="ไม่มีปัญหาที่รายงาน" rows={report.issues.map((i) => [thaiShortDate(i.date), i.text])} />
      </Sheet>
      <Sheet title="ความปลอดภัย / ผู้เยี่ยมชม (Safety / Visitors)">
        <DataTable
          head={['วันที่', 'รายละเอียด']}
          empty="ไม่มีอุบัติเหตุหรือบันทึกในช่วงนี้"
          rows={[
            ...report.safety.map((s) => [thaiShortDate(s.date), `${s.accident ? 'อุบัติเหตุ' : 'บันทึก'}${s.note ? `: ${s.note}` : ''}`]),
            ...report.visitors.map((v) => [thaiShortDate(v.date), `ผู้เยี่ยมชม: ${v.text}`]),
          ]}
        />
      </Sheet>
    </div>
  );
}

function PhotoSheet({ report }: { report: Report }) {
  if (report.photos.length === 0) return null;
  return (
    <Sheet title={`รูปถ่ายหน้างาน (${report.sources.photos} รูป${report.sources.photos > report.photos.length ? ` · แสดง ${report.photos.length} รูปแรก` : ''})`}>
      <div className="grid grid-cols-4 gap-2 p-2">
        {report.photos.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={p.id} src={p.url} alt={p.name} className="aspect-[4/3] w-full rounded border border-slate-200 object-cover" />
        ))}
      </div>
    </Sheet>
  );
}

function WeeklyPages({ report: r }: { report: Report }) {
  const p = r.progress;
  return (
    <>
      <A4Page>
        <PageHead report={r} title="Weekly Executive Summary" subtitle="สรุปผู้บริหาร" />
        <Sheet title="ข้อมูลโครงการ (Project Detail)">
          <InfoGrid rows={projectRows(r)} />
        </Sheet>
        <Sheet title="เปรียบเทียบความคืบหน้า (Weekly Progress Comparison)">
          <InfoGrid
            rows={[
              ['แผนสะสมสัปดาห์ก่อน', pct(p.previousPlanned)],
              ['จริงสะสมสัปดาห์ก่อน', pct(p.previousActual)],
              ['แผนสะสมสัปดาห์นี้', pct(p.planned)],
              ['จริงสะสมสัปดาห์นี้', pct(p.actual)],
              ['แผนเพิ่มในสัปดาห์', points(p.plannedIncrease)],
              ['จริงเพิ่มในสัปดาห์', points(p.actualIncrease)],
              ['ผลต่างในสัปดาห์', points(p.periodVariance)],
              ['ผลต่างสะสม', points(p.variance)],
            ]}
          />
        </Sheet>
        <Sheet title="บทสรุป (Executive Summary)">
          <p className="p-2.5">{r.summary}</p>
        </Sheet>
        <Sheet title="กำลังคนและความปลอดภัย">
          <InfoGrid
            rows={[
              ['วันที่มี Daily Report', `${r.rollup.reportDays} วัน`],
              ['คนงานเฉลี่ย / สูงสุด', `${r.rollup.avgManpower} / ${r.rollup.peakManpower} คน`],
              ['แรงงานรวม', `${r.rollup.manDays} คน-วัน`],
              ['อุบัติเหตุ', `${r.rollup.accidents} ครั้ง`],
            ]}
          />
        </Sheet>
        <CategorySheet report={r} />
        <FinanceSheet report={r} />
      </A4Page>
      <A4Page>
        <PageHead report={r} title="Weekly Progress Trend" subtitle="แนวโน้มความก้าวหน้า" />
        <Sheet title="S-Curve: แผนเทียบผลงานจริง">
          <div className="p-2">
            <ProgressCurve curve={r.curve} cutoff={r.cutoff} height={300} />
          </div>
        </Sheet>
        <p className="text-[10px] text-slate-600">
          แผนคำนวณจากวันเริ่ม-วันเสร็จของงานใน Gantt · ผลงานจริงในอดีตมาจากตัวเลขสะสมใน Daily Report ที่ส่งแล้ว จึงอาจต่ำกว่าจริงหากมีการอัปเดตที่งานโดยตรง · เส้นแนวตั้งคือวันที่ข้อมูลล่าสุด
        </p>
        <CriticalSheet report={r} />
        <NextPlanSheet report={r} title="แผนงานสัปดาห์ถัดไป" />
      </A4Page>
      <A4Page>
        <PageHead report={r} title="Weekly Work Detail" subtitle="รายละเอียดงานในสัปดาห์" />
        <WorkSheet report={r} title="งานที่ทำในสัปดาห์ (จาก Daily Report)" />
        <ResourceSheets report={r} />
        <IssueSafetySheet report={r} />
        <PhotoSheet report={r} />
      </A4Page>
    </>
  );
}

function MonthlyPages({ report: r }: { report: Report }) {
  const p = r.progress;
  const month = new Date(`${r.period.start}T00:00:00Z`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <A4Page>
      <header className="flex items-center gap-3 border border-[#173a7a]">
        <div className="p-1.5">
          <Logo name={r.company.name} url={r.company.logoUrl} />
        </div>
        <h2 className="flex-1 self-stretch bg-[#173a7a] py-3 text-center text-base font-bold text-white">Monthly Construction Report</h2>
        <div className="px-3 text-[10px]">
          <div className="font-semibold text-slate-600">Report No.</div>
          <div className="font-mono font-bold text-slate-900">{r.number}</div>
        </div>
      </header>
      <Sheet title="รายละเอียดโครงการ (Project Detail)" right={<span className="font-medium">ประจำเดือน {month}</span>}>
        <InfoGrid rows={projectRows(r)} />
      </Sheet>
      <Sheet title="บทสรุป (Executive Summary)">
        <p className="p-2.5">{r.summary}</p>
      </Sheet>
      <Sheet title="ความคืบหน้าโครงการ (Project Progress)">
        <DataTable
          head={['แผน %', 'จริง %', 'ผลต่าง', 'เพิ่มขึ้น', 'Daily Report', 'คนงานเฉลี่ย', 'อุบัติเหตุ']}
          align={['center', 'center', 'center', 'center', 'center', 'center', 'center']}
          empty="-"
          rows={[[pct(p.planned), pct(p.actual), points(p.variance), points(p.actualIncrease), `${r.rollup.reportDays} วัน`, `${r.rollup.avgManpower} คน/วัน`, `${r.rollup.accidents} ครั้ง`]]}
        />
      </Sheet>
      <CategorySheet report={r} />
      <Sheet title="S-Curve: แผนเทียบผลงานจริง (Plan vs Actual)">
        <div className="p-2">
          <ProgressCurve curve={r.curve} cutoff={r.cutoff} height={200} />
        </div>
      </Sheet>
      <div className="grid grid-cols-2 gap-3">
        <WorkSheet report={r} title="งานหลักในเดือนนี้ (Major Works)" />
        <Sheet title="สถานะงวดงาน (Milestone Status)">
          <DataTable
            head={['งวดงาน', 'กำหนด', 'สถานะ']}
            empty="ไม่มีงวดงานในช่วงนี้"
            rows={r.milestones.map((m) => [`${m.kind === 'PAY' ? 'จ่าย' : 'รับ'}: ${m.title}`, thaiShortDate(m.plannedDate), m.status])}
          />
        </Sheet>
      </div>
      <CriticalSheet report={r} />
      <ResourceSheets report={r} />
      <FinanceSheet report={r} />
      <IssueSafetySheet report={r} />
      <NextPlanSheet report={r} title="แผนงานเดือนถัดไป (Next Month Plan)" />
      <PhotoSheet report={r} />
    </A4Page>
  );
}

function SourcePanel({ report: r }: { report: Report }) {
  const items: [string, number][] = [
    ['Daily Report', r.sources.submitted],
    ['รายการงาน', r.sources.workItems],
    ['ปัญหา / อุปสรรค', r.sources.issues],
    ['รูปถ่าย', r.sources.photos],
  ];
  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-xs">
      <div className="font-semibold text-slate-900">ที่มาของข้อมูล (อัตโนมัติ)</div>
      <p className="mt-0.5 text-[11px] text-slate-500">ดึงจาก Daily Report ที่ส่งแล้ว, Gantt, สต็อก, งวดงาน และบัญชี ไม่ต้องกรอกเพิ่ม</p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {items.map(([label, n]) => (
          <div key={label} className="rounded-lg border border-slate-200 p-2.5">
            <dt className="text-[11px] text-slate-500">{label}</dt>
            <dd className="mt-0.5 font-mono text-base font-bold text-slate-900">{n}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/** Weekly or monthly report for the chosen date; everything on it is generated. */
export function PeriodicReportView({ projectId, kind, today, toolbarLead }: { projectId: string; kind: ReportKind; today: string; toolbarLead: React.ReactNode }) {
  const [anchor, setAnchor] = useState(today);
  const { data, error } = useSiteLoader(() => loadPeriodicReportAction(projectId, kind, anchor), [projectId, kind, anchor]);
  const period = kind === 'WEEK' ? weekOf(anchor) : monthOf(anchor);
  const atLatest = period.end >= today;
  // Data for an earlier selection stays visible until the new period has loaded
  const report = data && data.kind === kind ? data : null;
  const stale = report && report.period.start !== period.start;
  const step = (dir: -1 | 1) => setAnchor(dir < 0 ? addDays(period.start, -1) : addDays(period.end, 1));
  const label = kind === 'WEEK' ? 'สัปดาห์' : 'เดือน';
  const pages = report ? kind === 'WEEK' ? <WeeklyPages report={report} /> : <MonthlyPages report={report} /> : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-b-xl border border-t-0 border-slate-200 bg-white px-4 py-3 shadow-xs">
        {toolbarLead}
        <div className="flex items-center gap-1.5 text-xs">
          <button type="button" onClick={() => step(-1)} aria-label={`${label}ก่อนหน้า`} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
            <CalendarDays className="h-4 w-4 text-slate-500" />
            <span className="sr-only">เลือก{label}</span>
            {kind === 'WEEK' ? (
              <input type="date" value={anchor} max={today} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="bg-transparent focus:outline-none" />
            ) : (
              <input type="month" value={anchor.slice(0, 7)} max={today.slice(0, 7)} onChange={(e) => e.target.value && setAnchor(`${e.target.value}-01`)} className="bg-transparent focus:outline-none" />
            )}
          </label>
          <button type="button" onClick={() => step(1)} disabled={atLatest} aria-label={`${label}ถัดไป`} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-1 font-medium text-slate-700">{formatPeriod(period)}</span>
        </div>
        <button
          type="button"
          disabled={!report || !!stale}
          onClick={() => window.print()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Export PDF
        </button>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      {!report && !error && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">กำลังสร้างรายงาน...</div>}

      {report && (
        <>
          {report.sources.submitted === 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> ยังไม่มี Daily Report ที่ส่งแล้วใน{label}นี้ รายงานจึงมีเฉพาะข้อมูลแผนงานและบัญชี
            </p>
          )}
          {report.sources.drafts > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0" /> มี Daily Report ฉบับร่าง {report.sources.drafts} ฉบับที่ยังไม่ถูกนับ กด &quot;ส่งรายงาน&quot; ก่อนจึงจะเข้ามาในรายงานนี้
            </p>
          )}
          <div className={`grid gap-4 xl:grid-cols-[1fr_260px] ${stale ? 'opacity-50' : ''}`}>
            <div className="min-w-0 space-y-4 overflow-x-auto rounded-xl bg-slate-100 p-4">{pages}</div>
            <div className="space-y-3">
              <SourcePanel report={report} />
              <p className="flex items-start gap-1.5 px-1 text-[11px] text-slate-500">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Export PDF จะเปิดหน้าต่างพิมพ์ ให้เลือกปลายทางเป็น &quot;Save as PDF&quot;
              </p>
            </div>
          </div>
          <PrintRoot>{pages}</PrintRoot>
        </>
      )}
    </div>
  );
}
