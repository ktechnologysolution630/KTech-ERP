'use client';

import React, { useRef, useState, useTransition } from 'react';
import { ArrowLeft, Camera, FileText, Plus, Printer, Send, Trash2 } from 'lucide-react';
import type { DailyWeather, DailyWorkOutcome } from '@/db/schema';
import type { DailyReportInput } from '@/server/services/project-site';
import {
  deleteFileAction,
  loadDailyReportAction,
  loadDailyReportsAction,
  saveDailyReportAction,
  submitDailyReportAction,
} from '@/app/(app)/projects/[id]/site-actions';
import { A4Page, Band, Logo, PrintRoot } from './report-sheet';
import { uploadFile, useSiteLoader } from './use-site-loader';

const WEATHER: Record<DailyWeather, string> = { SUNNY: 'แดด', CLOUDY: 'เมฆครึ้ม', RAIN: 'ฝนตก', HEAVY_RAIN: 'ฝนตกหนัก', OTHER: 'อื่นๆ' };
const field = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-[#2453d4] focus:outline-none bg-white disabled:bg-slate-50';
const dateText = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
/** Rows offered by default, as on the paper form; rows left blank are not saved */
const DEFAULT_ROWS = 5;

const WORK_COLS = 'sm:grid-cols-[minmax(0,1.4fr)_84px_64px_64px_minmax(0,1fr)_24px]';
const LABOUR_COLS = 'grid-cols-[minmax(0,1fr)_64px_64px_20px]';
const EQUIPMENT_COLS = 'grid-cols-[minmax(0,1fr)_64px_20px]';

export interface DailyProject {
  id: string;
  name: string;
  location: string;
  group: string;
}
export type DailyTaskOption = { id: string; wbs: string; title: string; progress: number };

type View = { kind: 'list' } | { kind: 'view'; id: string };
type Editing = { id: string | null } | null;

export function DailyReportsPanel({
  project,
  tasks,
  today,
  preparedBy,
  logoUrl,
  renderToolbar,
}: {
  project: DailyProject;
  tasks: DailyTaskOption[];
  today: string;
  preparedBy: string;
  logoUrl: string | null;
  renderToolbar: (onNew: () => void) => React.ReactNode;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [editing, setEditing] = useState<Editing>(null);
  // Remounts the list or open report after the editor saves, so it shows the new data
  const [revision, setRevision] = useState(0);

  return (
    <div className="space-y-4">
      {renderToolbar(() => setEditing({ id: null }))}
      {view.kind === 'view' ? (
        <ReportView key={`${view.id}-${revision}`} project={project} reportId={view.id} tasks={tasks} logoUrl={logoUrl} onBack={() => setView({ kind: 'list' })} onEdit={() => setEditing({ id: view.id })} />
      ) : (
        <ReportList key={revision} projectId={project.id} onOpen={(id) => setView({ kind: 'view', id })} />
      )}
      {editing && (
        <ReportEditor
          project={project}
          reportId={editing.id}
          tasks={tasks}
          today={today}
          preparedBy={preparedBy}
          logoUrl={logoUrl}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            setRevision((n) => n + 1);
            setView({ kind: 'view', id });
          }}
        />
      )}
    </div>
  );
}

function ReportList({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const { data, error } = useSiteLoader(() => loadDailyReportsAction(projectId), [projectId]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
      {error && <p className="p-3 text-xs text-red-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-[#102d72] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-medium">เลขที่ / วันที่</th>
              <th className="px-3 py-2 text-left font-medium">สภาพอากาศ</th>
              <th className="px-3 py-2 text-right font-medium">คนงาน</th>
              <th className="px-3 py-2 text-left font-medium">สรุปงาน</th>
              <th className="px-3 py-2 text-left font-medium">ผู้เขียน</th>
              <th className="px-3 py-2 text-left font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!data ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400">
                  กำลังโหลด...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  ยังไม่มีรายงานสำหรับโครงการนี้ — กด &quot;สร้างรายงาน&quot; เพื่อเริ่ม
                </td>
              </tr>
            ) : (
              data.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.id)} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2">
                    <div className="font-mono font-semibold text-[#2453d4]">{r.number}</div>
                    <div className="text-slate-500">{dateText(r.reportDate)}</div>
                  </td>
                  <td className="px-3 py-2">
                    {WEATHER[r.weatherMorning]} / {WEATHER[r.weatherAfternoon]}
                  </td>
                  <td className="px-3 py-2 text-right">{r.workers} คน</td>
                  <td className="px-3 py-2 text-slate-600 max-w-xs truncate">
                    {r.accident && <span className="mr-1 rounded bg-red-100 px-1 text-[10px] text-red-700">อุบัติเหตุ</span>}
                    {r.summary || '-'}
                    {r.photoCount > 0 && <span className="ml-1 text-slate-400">· {r.photoCount} รูป</span>}
                  </td>
                  <td className="px-3 py-2">{r.createdByName}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.status === 'SUBMITTED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {r.status === 'SUBMITTED' ? 'ส่งแล้ว' : 'ร่าง'}
                    </span>
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

type WorkLine = { taskId: string | null; description: string; progressPercent: number | null; outcome: DailyWorkOutcome | null; note: string };
type LabourLine = { company: string; workers: number; hours: number };
type EquipmentLine = { type: string; hours: number };
type Form = Required<Omit<DailyReportInput, 'work' | 'labour' | 'equipment'>> & {
  work: WorkLine[];
  labour: LabourLine[];
  equipment: EquipmentLine[];
};

const blankWork = (): WorkLine => ({ taskId: null, description: '', progressPercent: null, outcome: null, note: '' });
const blankLabour = (): LabourLine => ({ company: '', workers: 0, hours: 0 });
const blankEquipment = (): EquipmentLine => ({ type: '', hours: 0 });
const padded = <T,>(lines: T[], blank: () => T): T[] => [...lines, ...Array.from({ length: Math.max(0, DEFAULT_ROWS - lines.length) }, blank)];

const blank = (today: string): Form => ({
  reportDate: today,
  startTime: '08:00',
  endTime: '17:00',
  weatherMorning: 'SUNNY',
  weatherAfternoon: 'SUNNY',
  scheduleImpact: false,
  scheduleNote: '',
  work: padded([], blankWork),
  labour: padded([], blankLabour),
  equipment: padded([], blankEquipment),
  accident: false,
  safetyNote: '',
  visitors: '',
  issues: '',
  summary: '',
});

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="h-4 w-4 accent-[#2453d4]" />
      {children}
    </label>
  );
}

function SheetHeader({ number, logoUrl, companyName = 'K Tec' }: { number: string; logoUrl: string | null; companyName?: string }) {
  return (
    <header className="flex flex-wrap items-stretch border border-[#173a7a]">
      <div className="flex items-center justify-center px-4 py-1.5">
        <Logo name={companyName} url={logoUrl} />
      </div>
      <h2 className="flex min-w-[200px] flex-1 items-center justify-center bg-[#173a7a] px-3 py-2.5 text-center text-base font-bold text-white">Daily Construction Report</h2>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
        <span className="font-semibold text-slate-600">Report No.</span>
        <span className="font-mono font-bold text-slate-900">{number}</span>
      </div>
    </header>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] border-b border-slate-200 last:border-b-0">
      <div className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-700">{label}</div>
      <div className="min-w-0 px-2 py-1 text-slate-900">{children}</div>
    </div>
  );
}

function ReportEditor({
  project,
  reportId,
  tasks,
  today,
  preparedBy,
  logoUrl,
  onClose,
  onSaved,
}: {
  project: DailyProject;
  reportId: string | null;
  tasks: DailyTaskOption[];
  today: string;
  preparedBy: string;
  logoUrl: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [form, setForm] = useState<Form | null>(reportId ? null : blank(today));
  const [number, setNumber] = useState<string | null>(null);
  const [author, setAuthor] = useState(preparedBy);
  const [hasVisitor, setHasVisitor] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Existing draft: load once
  useSiteLoader(
    async () => {
      if (!reportId) return { ok: true as const, value: null };
      const r = await loadDailyReportAction(reportId);
      if (r.ok) {
        const v = r.value;
        setNumber(v.number);
        setAuthor(v.createdByName);
        setHasVisitor(!!v.visitors);
        setForm({
          reportDate: v.reportDate,
          startTime: v.startTime,
          endTime: v.endTime,
          weatherMorning: v.weatherMorning,
          weatherAfternoon: v.weatherAfternoon,
          scheduleImpact: v.scheduleImpact,
          scheduleNote: v.scheduleNote,
          work: padded(v.work.map((w) => ({ ...w, outcome: w.outcome ?? null })), blankWork),
          labour: padded(v.labour, blankLabour),
          equipment: padded(v.equipment, blankEquipment),
          accident: v.accident,
          safetyNote: v.safetyNote,
          visitors: v.visitors,
          issues: v.issues,
          summary: v.summary,
        });
      } else setLoadError(r.error);
      return { ok: true as const, value: null };
    },
    [reportId],
  );

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setLine = <K extends 'work' | 'labour' | 'equipment'>(k: K, i: number, patch: Partial<Form[K][number]>) =>
    setForm((f) => (f ? { ...f, [k]: f[k].map((l, j) => (j === i ? { ...l, ...patch } : l)) } : f));
  const addLine = (k: 'work' | 'labour' | 'equipment') =>
    setForm((f) => (f ? { ...f, [k]: [...f[k], k === 'work' ? blankWork() : k === 'labour' ? blankLabour() : blankEquipment()] } : f));
  const removeLine = (k: 'work' | 'labour' | 'equipment', i: number) => setForm((f) => (f ? { ...f, [k]: f[k].filter((_, j) => j !== i) } : f));

  const persist = (submit: boolean) => {
    if (!form) return;
    if (submit && !confirm('ส่งรายงาน? ส่งแล้วแก้ไขไม่ได้ และความคืบหน้างานจะอัปเดตไปที่ Gantt')) return;
    setError(null);
    startTransition(async () => {
      const saved = await saveDailyReportAction(project.id, reportId, { ...form, visitors: hasVisitor ? form.visitors : '' });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      if (submit) {
        const sent = await submitDailyReportAction(project.id, saved.value.id);
        if (!sent.ok) {
          // The draft is saved; reopen it as an edit next time rather than losing the entry
          setError(`บันทึกร่างแล้ว แต่ส่งไม่สำเร็จ: ${sent.error}`);
          return;
        }
      }
      onSaved(saved.value.id);
    });
  };

  const addRow = (k: 'work' | 'labour' | 'equipment') => (
    <button type="button" onClick={() => addLine(k)} className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-[11px] font-medium hover:bg-white/25">
      <Plus className="h-3 w-3" /> เพิ่มแถว
    </button>
  );
  const removeRow = (k: 'work' | 'labour' | 'equipment', i: number) => (
    <button type="button" onClick={() => removeLine(k, i)} className="justify-self-end p-1 text-slate-400 hover:text-red-600" title="ลบแถว" aria-label="ลบแถว">
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
  const caption = (text: string) => <span className="mt-0.5 block text-[11px] text-slate-500 sm:hidden">{text}</span>;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/60" role="dialog" aria-modal="true" aria-label="รายงานประจำวัน">
      <div className="flex-1 overflow-y-auto p-2 sm:p-4">
        {loadError && <p className="mx-auto max-w-4xl rounded-xl bg-white p-6 text-center text-xs text-red-600">{loadError}</p>}
        {!form && !loadError && <p className="mx-auto max-w-4xl rounded-xl bg-white p-10 text-center text-xs text-slate-500">กำลังโหลดรายงาน...</p>}
        {form && (
          <form id="daily-report-form" onSubmit={(e) => e.preventDefault()} className="mx-auto max-w-4xl rounded-xl bg-white p-3 text-xs text-slate-800 shadow-2xl sm:p-5">
            <fieldset disabled={isPending} className="min-w-0 space-y-3">
              <SheetHeader number={number ?? 'ออกเลขเมื่อบันทึก'} logoUrl={logoUrl} />

              <section className="border border-[#173a7a]">
                <Band>รายละเอียดโครงการ (Project Detail)</Band>
                <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-slate-200">
                  <div>
                    <Row label="ชื่อโครงการ">{project.name}</Row>
                    <Row label="สถานที่ก่อสร้าง">{project.location || '-'}</Row>
                    <Row label="ลักษณะโครงการ">{project.group || '-'}</Row>
                  </div>
                  <div className="border-t border-slate-200 sm:border-t-0">
                    <Row label="วันที่ (Date) *">
                      <input type="date" required max={today} aria-label="วันที่รายงาน" value={form.reportDate} onChange={(e) => set('reportDate', e.target.value)} className={field} />
                    </Row>
                    <Row label="ผู้เขียนรายงาน">{author}</Row>
                    <Row label="เวลาเริ่ม - เลิกงาน">
                      <div className="grid grid-cols-2 gap-1.5">
                        <input type="time" aria-label="เวลาเริ่มงาน" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value || null)} className={field} />
                        <input type="time" aria-label="เวลาเลิกงาน" value={form.endTime ?? ''} onChange={(e) => set('endTime', e.target.value || null)} className={field} />
                      </div>
                    </Row>
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <section className="border border-[#173a7a]">
                  <Band>สภาพอากาศ (Weather)</Band>
                  <div className="space-y-2 p-2.5">
                    <label className="block">
                      <select value={form.weatherMorning} onChange={(e) => set('weatherMorning', e.target.value as DailyWeather)} className={field}>
                        {Object.entries(WEATHER).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <span className="mt-0.5 block text-[11px] text-slate-500">ช่วงเช้า</span>
                    </label>
                    <label className="block">
                      <select value={form.weatherAfternoon} onChange={(e) => set('weatherAfternoon', e.target.value as DailyWeather)} className={field}>
                        {Object.entries(WEATHER).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <span className="mt-0.5 block text-[11px] text-slate-500">ช่วงบ่าย</span>
                    </label>
                  </div>
                </section>
                <section className="border border-[#173a7a]">
                  <Band>ผลต่อแผนงาน (Schedule Impact)</Band>
                  <div className="flex flex-col gap-2.5 p-2.5">
                    <Choice name="schedule-impact" checked={form.scheduleImpact} onChange={() => set('scheduleImpact', true)}>
                      กระทบต่อแผนการทำงาน
                    </Choice>
                    <Choice name="schedule-impact" checked={!form.scheduleImpact} onChange={() => set('scheduleImpact', false)}>
                      ไม่กระทบต่อแผนการทำงาน
                    </Choice>
                  </div>
                </section>
                <section className="flex flex-col border border-[#173a7a]">
                  <Band>หมายเหตุ (Note)</Band>
                  <textarea aria-label="หมายเหตุผลต่อแผนงาน" rows={3} maxLength={1000} value={form.scheduleNote} onChange={(e) => set('scheduleNote', e.target.value)} placeholder="เช่น ฝนตกช่วงบ่าย หยุดเทคอนกรีต" className="w-full flex-1 resize-y p-2.5 text-xs focus:outline-none" />
                </section>
              </div>

              <section className="border border-[#173a7a]">
                <Band right={addRow('work')}>สรุปงานประจำวัน (Work Summary)</Band>
                <div className={`hidden gap-2 bg-slate-100 px-2.5 py-1.5 text-center font-semibold text-slate-700 sm:grid ${WORK_COLS}`}>
                  <span className="text-left">รายละเอียดการทำงาน (Task)</span>
                  <span>ปริมาณงานสะสม (%)</span>
                  <span>Completed</span>
                  <span>Delayed</span>
                  <span className="text-left">Note ปัญหาการทำงาน</span>
                  <span />
                </div>
                <div className="divide-y divide-slate-200">
                  {form.work.map((w, i) => (
                    <div key={i} className={`grid grid-cols-1 items-start gap-2 p-2.5 ${WORK_COLS}`}>
                      <div className="min-w-0 space-y-1">
                        <select
                          aria-label={`งานใน Gantt แถว ${i + 1}`}
                          value={w.taskId ?? ''}
                          onChange={(e) => {
                            const t = tasks.find((x) => x.id === e.target.value);
                            setLine('work', i, {
                              taskId: e.target.value || null,
                              ...(t && !w.description ? { description: t.title } : {}),
                              progressPercent: t ? (w.progressPercent ?? t.progress) : null,
                            });
                          }}
                          className={field}
                        >
                          <option value="">— ไม่ผูกกับงานใน Gantt —</option>
                          {tasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.wbs} {t.title} ({t.progress}%)
                            </option>
                          ))}
                        </select>
                        <input aria-label={`รายละเอียดการทำงาน แถว ${i + 1}`} maxLength={500} value={w.description} onChange={(e) => setLine('work', i, { description: e.target.value })} placeholder="รายละเอียดการทำงาน" className={field} />
                      </div>
                      <label className="block">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          disabled={!w.taskId}
                          value={w.progressPercent ?? ''}
                          onChange={(e) => setLine('work', i, { progressPercent: e.target.value === '' ? null : Number(e.target.value) })}
                          placeholder={w.taskId ? '0-100' : 'เลือกงาน'}
                          aria-label={`ปริมาณงานสะสม (%) แถว ${i + 1}`}
                          className={`${field} sm:text-center`}
                        />
                        {caption('ปริมาณงานสะสม (%) รวมถึงวันนี้')}
                      </label>
                      {(['COMPLETED', 'DELAYED'] as const).map((o) => (
                        <label key={o} className="flex items-center gap-2 sm:justify-center sm:pt-1.5">
                          {/* A radio that can be cleared again: most rows have no outcome yet */}
                          <input
                            type="radio"
                            name={`work-outcome-${i}`}
                            checked={w.outcome === o}
                            readOnly
                            onClick={() => setLine('work', i, { outcome: w.outcome === o ? null : o })}
                            aria-label={`${o === 'COMPLETED' ? 'Completed' : 'Delayed'} แถว ${i + 1}`}
                            className="h-4 w-4 accent-[#2453d4]"
                          />
                          <span className="sm:hidden">{o === 'COMPLETED' ? 'Completed (เสร็จ)' : 'Delayed (ล่าช้า)'}</span>
                        </label>
                      ))}
                      <label className="block">
                        <input maxLength={500} value={w.note} onChange={(e) => setLine('work', i, { note: e.target.value })} placeholder="Note" aria-label={`Note แถว ${i + 1}`} className={field} />
                        {caption('Note ปัญหาการทำงาน')}
                      </label>
                      {removeRow('work', i)}
                    </div>
                  ))}
                </div>
                <p className="border-t border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">ปริมาณงานสะสม (%) กรอกเมื่อเลือกงานใน Gantt และจะอัปเดตไปที่งานเมื่อกด &quot;ส่งรายงาน&quot;</p>
              </section>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <section className="border border-[#173a7a]">
                  <Band right={addRow('labour')}>สรุปจำนวนคนงาน (Labour Summary) · รวม {form.labour.reduce((s, l) => s + (l.workers || 0), 0)} คน</Band>
                  <div className={`grid gap-1.5 bg-slate-100 px-2.5 py-1.5 text-center font-semibold text-slate-700 ${LABOUR_COLS}`}>
                    <span className="text-left">บริษัท (Company)</span>
                    <span>จำนวนคน</span>
                    <span>Work Hour</span>
                    <span />
                  </div>
                  <div className="space-y-1.5 p-2.5">
                    {form.labour.map((l, i) => (
                      <div key={i} className={`grid items-center gap-1.5 ${LABOUR_COLS}`}>
                        <input aria-label={`บริษัท แถว ${i + 1}`} maxLength={200} value={l.company} onChange={(e) => setLine('labour', i, { company: e.target.value })} placeholder="บริษัท/ประเภทคนงาน" className={field} />
                        <input aria-label={`จำนวนคน แถว ${i + 1}`} type="number" min={0} value={l.workers || ''} onChange={(e) => setLine('labour', i, { workers: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} placeholder="คน" className={field} />
                        <input aria-label={`ชั่วโมงทำงาน แถว ${i + 1}`} type="number" min={0} max={24} step={0.5} value={l.hours || ''} onChange={(e) => setLine('labour', i, { hours: Number(e.target.value) || 0 })} placeholder="ชม." className={field} />
                        {removeRow('labour', i)}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="border border-[#173a7a]">
                  <Band right={addRow('equipment')}>เครื่องมือ-เครื่องจักร (Equipment Summary)</Band>
                  <div className={`grid gap-1.5 bg-slate-100 px-2.5 py-1.5 text-center font-semibold text-slate-700 ${EQUIPMENT_COLS}`}>
                    <span className="text-left">ประเภทเครื่องจักร</span>
                    <span>ชั่วโมงใช้งาน</span>
                    <span />
                  </div>
                  <div className="space-y-1.5 p-2.5">
                    {form.equipment.map((q, i) => (
                      <div key={i} className={`grid items-center gap-1.5 ${EQUIPMENT_COLS}`}>
                        <input aria-label={`ประเภทเครื่องจักร แถว ${i + 1}`} maxLength={200} value={q.type} onChange={(e) => setLine('equipment', i, { type: e.target.value })} placeholder="เช่น รถแบ็คโฮ, รถโม่ปูน" className={field} />
                        <input aria-label={`ชั่วโมงใช้งาน แถว ${i + 1}`} type="number" min={0} max={24} step={0.5} value={q.hours || ''} onChange={(e) => setLine('equipment', i, { hours: Number(e.target.value) || 0 })} placeholder="ชม." className={field} />
                        {removeRow('equipment', i)}
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="border border-[#173a7a]">
                <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr_1fr]">
                  <Band>ความปลอดภัย (Safety Report)</Band>
                  <div className="p-2 sm:text-center">
                    <Choice name="accident" checked={!form.accident} onChange={() => set('accident', false)}>
                      ไม่มีอุบัติเหตุ
                    </Choice>
                  </div>
                  <div className="border-t border-slate-200 p-2 sm:border-t-0 sm:border-l sm:text-center">
                    <Choice name="accident" checked={form.accident} onChange={() => set('accident', true)}>
                      มีอุบัติเหตุ
                    </Choice>
                  </div>
                </div>
                <textarea aria-label="บันทึกความปลอดภัย" rows={2} maxLength={2000} value={form.safetyNote} onChange={(e) => set('safetyNote', e.target.value)} placeholder="บันทึกความปลอดภัย" className="w-full border-t border-slate-200 p-2.5 text-xs focus:outline-none" />
              </section>

              <section className="border border-[#173a7a]">
                <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr_1fr]">
                  <Band>ผู้เยี่ยมชม (Visitor)</Band>
                  <div className="p-2 sm:text-center">
                    <Choice name="visitor" checked={!hasVisitor} onChange={() => setHasVisitor(false)}>
                      ไม่มี
                    </Choice>
                  </div>
                  <div className="border-t border-slate-200 p-2 sm:border-t-0 sm:border-l sm:text-center">
                    <Choice name="visitor" checked={hasVisitor} onChange={() => setHasVisitor(true)}>
                      มีผู้เยี่ยมชม
                    </Choice>
                  </div>
                </div>
                {hasVisitor && <textarea aria-label="รายละเอียดผู้เยี่ยมชม" rows={2} maxLength={1000} value={form.visitors} onChange={(e) => set('visitors', e.target.value)} placeholder="ชื่อและหน่วยงาน" className="w-full border-t border-slate-200 p-2.5 text-xs focus:outline-none" />}
              </section>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <section className="border border-[#173a7a]">
                  <Band>ปัญหา / อุปสรรค (Issues)</Band>
                  <textarea aria-label="ปัญหาและอุปสรรค" rows={3} maxLength={3000} value={form.issues} onChange={(e) => set('issues', e.target.value)} className="w-full p-2.5 text-xs focus:outline-none" />
                </section>
                <section className="border border-[#173a7a]">
                  <Band>สรุปภาพรวมวันนี้ (Summary)</Band>
                  <textarea aria-label="สรุปภาพรวมวันนี้" rows={3} maxLength={3000} value={form.summary} onChange={(e) => set('summary', e.target.value)} className="w-full p-2.5 text-xs focus:outline-none" />
                </section>
              </div>
              <p className="text-[11px] text-slate-600">แนบรูปถ่ายหน้างานได้หลังบันทึก Draft (ก่อนกดส่งรายงาน)</p>
            </fieldset>
          </form>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2.5 text-xs">
        {error && (
          <p role="alert" className="mr-auto font-medium text-red-600">
            {error}
          </p>
        )}
        <button type="button" disabled={isPending} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 font-medium hover:bg-slate-50">
          ยกเลิก
        </button>
        <button type="button" disabled={isPending || !form} onClick={() => persist(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-50 disabled:opacity-60">
          {isPending ? 'กำลังบันทึก...' : 'บันทึก Draft'}
        </button>
        <button type="button" disabled={isPending || !form} onClick={() => persist(true)} className="rounded-lg bg-[#2453d4] px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          ส่งรายงาน
        </button>
      </div>
    </div>
  );
}

type LoadedReport = Extract<Awaited<ReturnType<typeof loadDailyReportAction>>, { ok: true }>['value'];

/** The report as a printable sheet; used on screen and in the print copy. */
function DailySheet({
  data,
  project,
  tasks,
  logoUrl,
  onDeletePhoto,
}: {
  data: LoadedReport;
  project: DailyProject;
  tasks: { id: string; wbs: string; title: string }[];
  logoUrl: string | null;
  onDeletePhoto?: (id: string) => void;
}) {
  const taskName = (id: string | null) => {
    const t = tasks.find((x) => x.id === id);
    return t ? `${t.wbs} ${t.title}` : '';
  };
  const mark = (on: boolean) => (on ? '●' : '○');
  return (
    <A4Page>
      <SheetHeader number={data.number} logoUrl={logoUrl} />
      <section className="keep-together border border-[#173a7a]">
        <Band right={<span className="font-medium">{data.status === 'SUBMITTED' ? 'ส่งแล้ว' : 'ร่าง'}</span>}>รายละเอียดโครงการ (Project Detail)</Band>
        <div className="grid grid-cols-2 divide-x divide-slate-200">
          <div>
            <Row label="ชื่อโครงการ">{project.name}</Row>
            <Row label="สถานที่ก่อสร้าง">{project.location || '-'}</Row>
            <Row label="ลักษณะโครงการ">{project.group || '-'}</Row>
          </div>
          <div>
            <Row label="วันที่ (Date)">{dateText(data.reportDate)}</Row>
            <Row label="ผู้เขียนรายงาน">{data.createdByName}</Row>
            <Row label="เวลาเริ่ม - เลิกงาน">
              {data.startTime ?? '-'} – {data.endTime ?? '-'}
            </Row>
          </div>
        </div>
      </section>
      <div className="keep-together grid grid-cols-3 gap-3">
        <section className="border border-[#173a7a]">
          <Band>สภาพอากาศ (Weather)</Band>
          <div className="space-y-1 p-2">
            <div>ช่วงเช้า: <b>{WEATHER[data.weatherMorning]}</b></div>
            <div>ช่วงบ่าย: <b>{WEATHER[data.weatherAfternoon]}</b></div>
          </div>
        </section>
        <section className="border border-[#173a7a]">
          <Band>ผลต่อแผนงาน (Schedule Impact)</Band>
          <div className="p-2 font-semibold">{data.scheduleImpact ? 'กระทบต่อแผนการทำงาน' : 'ไม่กระทบต่อแผนการทำงาน'}</div>
        </section>
        <section className="border border-[#173a7a]">
          <Band>หมายเหตุ (Note)</Band>
          <div className="whitespace-pre-wrap p-2">{data.scheduleNote || '-'}</div>
        </section>
      </div>
      <section className="border border-[#173a7a]">
        <Band>สรุปงานประจำวัน (Work Summary)</Band>
        <table className="w-full text-[10.5px]">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-2 py-1 text-left">รายละเอียดการทำงาน (Task)</th>
              <th className="px-2 py-1 text-center">ปริมาณงานสะสม (%)</th>
              <th className="px-2 py-1 text-center">Completed</th>
              <th className="px-2 py-1 text-center">Delayed</th>
              <th className="px-2 py-1 text-left">Note ปัญหาการทำงาน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.work.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-2 text-center text-slate-500">ไม่มีรายการ</td>
              </tr>
            ) : (
              data.work.map((w, i) => (
                <tr key={i}>
                  <td className="px-2 py-1">
                    {w.description || '-'}
                    {w.taskId && <div className="text-[10px] text-slate-500">{taskName(w.taskId)}</div>}
                  </td>
                  <td className="px-2 py-1 text-center">{w.progressPercent ?? '-'}</td>
                  <td className="px-2 py-1 text-center">{mark(w.outcome === 'COMPLETED')}</td>
                  <td className="px-2 py-1 text-center">{mark(w.outcome === 'DELAYED')}</td>
                  <td className="px-2 py-1">{w.note || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      <div className="keep-together grid grid-cols-2 gap-3">
        <section className="border border-[#173a7a]">
          <Band>สรุปจำนวนคนงาน (Labour) · รวม {data.labour.reduce((s, l) => s + l.workers, 0)} คน</Band>
          <table className="w-full text-[10.5px]">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-2 py-1 text-left">บริษัท (Company)</th>
                <th className="px-2 py-1 text-right">จำนวนคน</th>
                <th className="px-2 py-1 text-right">Work Hour</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.labour.length === 0 ? (
                <tr><td colSpan={3} className="px-2 py-2 text-center text-slate-500">ไม่มีรายการ</td></tr>
              ) : (
                data.labour.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">{l.company || '-'}</td>
                    <td className="px-2 py-1 text-right">{l.workers}</td>
                    <td className="px-2 py-1 text-right">{l.hours}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
        <section className="border border-[#173a7a]">
          <Band>เครื่องมือ-เครื่องจักร (Equipment)</Band>
          <table className="w-full text-[10.5px]">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-2 py-1 text-left">ประเภทเครื่องจักร</th>
                <th className="px-2 py-1 text-right">ชั่วโมงใช้งาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.equipment.length === 0 ? (
                <tr><td colSpan={2} className="px-2 py-2 text-center text-slate-500">ไม่มีรายการ</td></tr>
              ) : (
                data.equipment.map((q, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">{q.type}</td>
                    <td className="px-2 py-1 text-right">{q.hours}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
      <div className="keep-together grid grid-cols-2 gap-3">
        <section className="border border-[#173a7a]">
          <Band>ความปลอดภัย (Safety Report)</Band>
          <div className="p-2">
            <div className="flex items-center gap-1 font-semibold">{data.accident ? 'มีอุบัติเหตุ' : 'ไม่มีอุบัติเหตุ'}</div>
            {data.safetyNote && <div className="mt-1 whitespace-pre-wrap">{data.safetyNote}</div>}
          </div>
        </section>
        <section className="border border-[#173a7a]">
          <Band>ผู้เยี่ยมชม (Visitor)</Band>
          <div className="whitespace-pre-wrap p-2">{data.visitors || 'ไม่มี'}</div>
        </section>
        <section className="border border-[#173a7a]">
          <Band>ปัญหา / อุปสรรค (Issues)</Band>
          <div className="whitespace-pre-wrap p-2">{data.issues || '-'}</div>
        </section>
        <section className="border border-[#173a7a]">
          <Band>สรุปภาพรวมวันนี้ (Summary)</Band>
          <div className="whitespace-pre-wrap p-2">{data.summary || '-'}</div>
        </section>
      </div>
      {data.photos.length > 0 && (
        <section className="keep-together border border-[#173a7a]">
          <Band>รูปถ่ายหน้างาน</Band>
          <div className="grid grid-cols-3 gap-2 p-2">
            {data.photos.map((p) => (
              <div key={p.id} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.name} className="aspect-[4/3] w-full rounded border border-slate-200 object-cover" />
                {onDeletePhoto && (
                  <button type="button" onClick={() => onDeletePhoto(p.id)} className="absolute right-1 top-1 rounded bg-white/90 p-1 text-slate-500 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100" title="ลบรูป" aria-label={`ลบรูป ${p.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </A4Page>
  );
}

function ReportView({
  project,
  reportId,
  tasks,
  logoUrl,
  onBack,
  onEdit,
}: {
  project: DailyProject;
  reportId: string;
  tasks: { id: string; wbs: string; title: string }[];
  logoUrl: string | null;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { data, error, reload } = useSiteLoader(() => loadDailyReportAction(reportId), [reportId]);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <p className="rounded-xl bg-white p-8 text-center text-xs text-slate-500">กำลังโหลดรายงาน...</p>;

  const uploadPhotos = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    setActionError(null);
    for (const file of [...files]) {
      const err = await uploadFile({ entityType: 'DAILY_REPORT', entityId: reportId, file });
      if (err) setActionError(`${file.name}: ${err}`);
    }
    setUploading(false);
    await reload();
  };

  const deletePhoto = async (id: string) => {
    if (!confirm('ลบรูปนี้?')) return;
    const r = await deleteFileAction(id);
    if (!r.ok) setActionError(r.error);
    await reload();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> รายงานทั้งหมด
        </button>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
            <Printer className="h-3.5 w-3.5" /> Export PDF
          </button>
          {data.canEdit && (
            <>
              <button type="button" disabled={uploading} onClick={() => photoRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-50">
                <Camera className="h-3.5 w-3.5" /> {uploading ? 'กำลังอัปโหลด...' : 'แนบรูป'}
              </button>
              <input
                ref={photoRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                aria-label="แนบรูปหน้างาน"
                onChange={(e) => {
                  void uploadPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
              <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                <FileText className="h-3.5 w-3.5" /> แก้ไข
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  confirm('ส่งรายงาน? ส่งแล้วแก้ไขไม่ได้ และความคืบหน้างานจะอัปเดตไปที่ Gantt') &&
                  startTransition(async () => {
                    const r = await submitDailyReportAction(project.id, reportId);
                    if (!r.ok) setActionError(r.error);
                    await reload();
                  })
                }
                className="inline-flex items-center gap-1 rounded-lg bg-[#2453d4] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> ส่งรายงาน
              </button>
            </>
          )}
        </div>
      </div>
      {actionError && <p className="text-xs text-red-600">{actionError}</p>}

      <div className="overflow-x-auto rounded-xl bg-slate-100 p-4">
        <DailySheet data={data} project={project} tasks={tasks} logoUrl={logoUrl} onDeletePhoto={data.canEdit ? (id) => void deletePhoto(id) : undefined} />
      </div>
      <PrintRoot>
        <DailySheet data={data} project={project} tasks={tasks} logoUrl={logoUrl} />
      </PrintRoot>
    </div>
  );
}
