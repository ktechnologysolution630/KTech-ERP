'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { ArrowLeft, FileText, ImagePlus, Plus, Printer, Send, Trash2 } from 'lucide-react';
import type { DailyWeather, DailyWorkOutcome } from '@/db/schema';
import { projectDuration, totalWorkHours } from '@/domain/site-report';
import type { DailyReportInput } from '@/server/services/project-site';
import {
  deleteFileAction,
  loadDailyReportAction,
  loadDailyReportsAction,
  saveDailyReportAction,
  setPhotoCaptionAction,
  submitDailyReportAction,
} from '@/app/(app)/projects/[id]/site-actions';
import { A4Page, Band, Logo, PrintRoot } from './report-sheet';
import { uploadFile, useSiteLoader } from './use-site-loader';

const WEATHER: Record<DailyWeather, string> = { SUNNY: 'แดด', CLOUDY: 'เมฆครึ้ม', RAIN: 'ฝนตก', HEAVY_RAIN: 'ฝนตกหนัก', OTHER: 'อื่นๆ' };
const field = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-[#2453d4] focus:outline-none bg-white disabled:bg-slate-50';
const dateText = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
/** Rows offered by default, as on the paper form; rows left blank are not saved */
const DEFAULT_ROWS = 5;

const MIN_PHOTO_SLOTS = 6;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** A cell input framed by the table lines, as on the printed form; phones have no table lines, so an underline marks the field */
const plainInput = 'block w-full border-b border-slate-300 bg-transparent px-2 py-1.5 text-xs sm:border-b-0 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#2453d4] disabled:cursor-not-allowed';

const WORK_COLS = 'sm:grid-cols-[minmax(0,1.6fr)_90px_90px_minmax(0,1fr)]';
const RESOURCE_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]';
const PROGRESS_COLS = 'sm:grid-cols-[52px_minmax(0,0.8fr)_minmax(0,2fr)_100px_minmax(0,1fr)]';

export interface DailyProject {
  id: string;
  name: string;
  location: string;
  group: string;
  startDate: string | null;
  endDate: string | null;
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
type ProgressLine = { area: string; taskId: string | null; detail: string; todayPercent: number | null; note: string };
type LabourLine = { company: string; workers: number; hours: number };
type EquipmentLine = { type: string; hours: number };
type Form = Required<Omit<DailyReportInput, 'work' | 'progress' | 'labour' | 'equipment'>> & {
  work: WorkLine[];
  progress: ProgressLine[];
  labour: LabourLine[];
  equipment: EquipmentLine[];
};
type PhotoDraft =
  | { kind: 'saved'; id: string; url: string; caption: string; savedCaption: string }
  | { kind: 'new'; key: string; file: File; url: string; caption: string };

const blankWork = (): WorkLine => ({ taskId: null, description: '', progressPercent: null, outcome: null, note: '' });
const blankProgress = (): ProgressLine => ({ area: '', taskId: null, detail: '', todayPercent: null, note: '' });
const blankLabour = (): LabourLine => ({ company: '', workers: 0, hours: 0 });
const blankEquipment = (): EquipmentLine => ({ type: '', hours: 0 });
const padded = <T,>(lines: T[], blank: () => T, rows = DEFAULT_ROWS): T[] => [...lines, ...Array.from({ length: Math.max(0, rows - lines.length) }, blank)];

const blank = (today: string): Form => ({
  reportDate: today,
  startTime: '08:00',
  endTime: '17:00',
  weatherMorning: 'SUNNY',
  weatherAfternoon: 'SUNNY',
  scheduleImpact: false,
  scheduleNote: '',
  work: padded([], blankWork),
  progress: padded([], blankProgress),
  labour: padded([], blankLabour),
  equipment: padded([], blankEquipment),
  accident: false,
  safetyNote: '',
  visitors: '',
  issues: '',
  summary: '',
});

const durationText = (days: number | null) => (days === null ? '-' : days < 0 ? `เกิน ${-days}` : String(days));

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="h-4 w-4 accent-[#173a7a]" />
      {children}
    </label>
  );
}

function SheetHeader({ number, logoUrl }: { number: string; logoUrl: string | null }) {
  return (
    <header className="keep-together flex flex-wrap items-stretch border border-[#173a7a]">
      <div className="flex items-center justify-center px-5 py-1.5">
        <Logo name="K Tec" url={logoUrl} />
      </div>
      <h2 className="flex min-w-[200px] flex-1 items-center justify-center bg-[#173a7a] px-3 py-2.5 text-center text-base font-bold text-white">Daily Construction Report</h2>
      <div className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
        <span className="font-semibold text-slate-600">Report No.</span>
        <span className="font-mono font-bold text-slate-900">{number}</span>
      </div>
    </header>
  );
}

/** Label and value cells of the project detail table. */
function DetailCells({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="border-b border-r border-slate-300 px-2 py-1.5 font-semibold text-slate-900">{label}</div>
      <div className="min-w-0 border-b border-slate-300 px-2 py-1.5 text-slate-900 sm:border-r">{children}</div>
    </>
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
  // A failed upload or submit leaves the report saved: later saves must update it, not create another
  const [savedId, setSavedId] = useState(reportId);
  const [number, setNumber] = useState<string | null>(null);
  const [author, setAuthor] = useState(preparedBy);
  const [hasVisitor, setHasVisitor] = useState(false);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const photoKey = useRef(0);

  // Previews of picked files are released when the form closes
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // Existing draft: load once
  useSiteLoader(
    async () => {
      if (!reportId) return { ok: true as const, value: null };
      const r = await loadDailyReportAction(reportId);
      if (r.ok) {
        const v = r.value;
        const sharedRows = Math.max(DEFAULT_ROWS, v.labour.length, v.equipment.length);
        setNumber(v.number);
        setAuthor(v.createdByName);
        setHasVisitor(!!v.visitors);
        setPhotos(v.photos.filter((p) => p.contentType.startsWith('image/')).map((p) => ({ kind: 'saved', id: p.id, url: p.url, caption: p.caption, savedCaption: p.caption })));
        setForm({
          reportDate: v.reportDate,
          startTime: v.startTime,
          endTime: v.endTime,
          weatherMorning: v.weatherMorning,
          weatherAfternoon: v.weatherAfternoon,
          scheduleImpact: v.scheduleImpact,
          scheduleNote: v.scheduleNote,
          work: padded(v.work.map((w) => ({ ...w, progressPercent: w.progressPercent ?? null, outcome: w.outcome ?? null })), blankWork),
          progress: padded(v.progress.map(({ area, taskId, detail, todayPercent, note }) => ({ area, taskId, detail, todayPercent, note })), blankProgress),
          labour: padded(v.labour, blankLabour, sharedRows),
          equipment: padded(v.equipment, blankEquipment, sharedRows),
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
  const setLine = <K extends 'work' | 'progress' | 'labour' | 'equipment'>(k: K, i: number, patch: Partial<Form[K][number]>) =>
    setForm((f) => (f ? { ...f, [k]: f[k].map((l, j) => (j === i ? { ...l, ...patch } : l)) } : f));

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const picked: PhotoDraft[] = [];
    for (const file of [...files]) {
      if (!file.type.startsWith('image/')) {
        setError(`${file.name}: รูปภาพต้องเป็นไฟล์ JPG, PNG, WebP หรือ GIF`);
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setError(`${file.name}: ขนาดไฟล์ต้องไม่เกิน 10 MB`);
        continue;
      }
      const url = URL.createObjectURL(file);
      previews.current.push(url);
      picked.push({ kind: 'new', key: `new-${photoKey.current++}`, file, url, caption: '' });
    }
    setPhotos((p) => [...p, ...picked]);
  };
  const photoId = (p: PhotoDraft) => (p.kind === 'saved' ? p.id : p.key);
  const setCaption = (p: PhotoDraft, caption: string) => setPhotos((all) => all.map((x) => (photoId(x) === photoId(p) ? { ...x, caption } : x)));
  const removePhoto = (p: PhotoDraft) => {
    if (p.kind === 'new') {
      setPhotos((all) => all.filter((x) => photoId(x) !== photoId(p)));
      return;
    }
    if (!confirm('ลบรูปนี้?')) return;
    startTransition(async () => {
      const r = await deleteFileAction(p.id);
      if (!r.ok) setError(r.error);
      else setPhotos((all) => all.filter((x) => photoId(x) !== photoId(p)));
    });
  };

  /** Uploads new photos and saves edited captions; returns the first failure, keeping what still needs sending. */
  const syncPhotos = async (id: string): Promise<string | null> => {
    let failure: string | null = null;
    for (const p of photos) {
      if (p.kind === 'new') {
        const err = await uploadFile({ entityType: 'DAILY_REPORT', entityId: id, file: p.file, kind: 'PHOTO', caption: p.caption });
        if (err) failure ??= `${p.file.name}: ${err}`;
        else setPhotos((all) => all.filter((x) => photoId(x) !== p.key));
      } else if (p.caption !== p.savedCaption) {
        const r = await setPhotoCaptionAction(p.id, p.caption);
        if (!r.ok) failure ??= r.error;
      }
    }
    return failure;
  };

  const persist = (submit: boolean) => {
    if (!form) return;
    if (submit && !confirm('ส่งรายงาน? ส่งแล้วแก้ไขไม่ได้ และผลงานวันนี้จะบวกเพิ่มไปที่งานใน Gantt')) return;
    setError(null);
    startTransition(async () => {
      const saved = await saveDailyReportAction(project.id, savedId, { ...form, visitors: hasVisitor ? form.visitors : '' });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setSavedId(saved.value.id);
      setNumber(saved.value.number);
      const photoFailure = await syncPhotos(saved.value.id);
      if (photoFailure) {
        setError(`บันทึกร่างแล้ว แต่ส่งรูปไม่สำเร็จ: ${photoFailure}`);
        return;
      }
      if (submit) {
        const sent = await submitDailyReportAction(project.id, saved.value.id);
        if (!sent.ok) {
          setError(`บันทึกร่างแล้ว แต่ส่งรายงานไม่สำเร็จ: ${sent.error}`);
          return;
        }
      }
      onSaved(saved.value.id);
    });
  };

  const caption = (text: string) => <span className="block px-2 pb-1 text-[11px] text-slate-500 sm:hidden">{text}</span>;
  const addRowButton = (onClick: () => void) => (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-[11px] font-medium hover:bg-white/25">
      <Plus className="h-3 w-3" /> เพิ่มแถว
    </button>
  );

  const duration = form ? projectDuration(project.startDate, project.endDate, form.reportDate) : null;
  const workHours = form ? totalWorkHours(form.labour) : 0;
  const slotCount = Math.max(MIN_PHOTO_SLOTS, Math.ceil((photos.length + 1) / 2) * 2);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/60" role="dialog" aria-modal="true" aria-label="รายงานประจำวัน">
      <div className="flex-1 overflow-y-auto p-2 sm:p-4">
        {loadError && <p className="mx-auto max-w-5xl rounded-xl bg-white p-6 text-center text-xs text-red-600">{loadError}</p>}
        {!form && !loadError && <p className="mx-auto max-w-5xl rounded-xl bg-white p-10 text-center text-xs text-slate-500">กำลังโหลดรายงาน...</p>}
        {form && (
          <form onSubmit={(e) => e.preventDefault()} className="mx-auto max-w-5xl bg-white p-3 text-xs text-slate-800 shadow-2xl sm:p-6">
            <fieldset disabled={isPending} className="min-w-0 space-y-3">
              <SheetHeader number={number ?? 'ออกเลขเมื่อบันทึก'} logoUrl={logoUrl} />

              <section className="grid grid-cols-[110px_minmax(0,1fr)] border border-b-0 border-[#173a7a] sm:grid-cols-[140px_minmax(0,1fr)_140px_minmax(0,190px)]">
                <div className="col-span-2 flex items-center justify-center bg-[#173a7a] px-2 py-2 font-bold text-white">รายละเอียดโครงการ (Project Detail)</div>
                <DetailCells label="วันที่ (Date)">
                  <input type="date" required max={today} aria-label="วันที่รายงาน" value={form.reportDate} onChange={(e) => set('reportDate', e.target.value)} className={plainInput} />
                </DetailCells>
                <DetailCells label="ชื่อโครงการ (Project Name)">{project.name}</DetailCells>
                <DetailCells label="ผู้เขียนรายงาน (Prepared by)">{author}</DetailCells>
                <DetailCells label="สถานที่ก่อสร้าง (Location)">{project.location || '-'}</DetailCells>
                <DetailCells label="เวลาเริ่มงาน (Start Time)">
                  <input type="time" aria-label="เวลาเริ่มงาน" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value || null)} className={plainInput} />
                </DetailCells>
                <DetailCells label="ลักษณะโครงการ (Job Type)">{project.group || '-'}</DetailCells>
                <DetailCells label="เวลาเลิกงาน (End Time)">
                  <input type="time" aria-label="เวลาเลิกงาน" value={form.endTime ?? ''} onChange={(e) => set('endTime', e.target.value || null)} className={plainInput} />
                </DetailCells>
              </section>

              <section className="grid grid-cols-1 border border-[#173a7a] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                <div className="flex flex-col sm:border-r sm:border-[#173a7a]">
                  <div className="bg-[#173a7a] px-2 py-2 text-center font-bold text-white">สภาพอากาศ (Weather Condition)</div>
                  <div className="grid flex-1 grid-cols-2 gap-3 p-3">
                    {(
                      [
                        ['weatherMorning', 'ช่วงเช้า'],
                        ['weatherAfternoon', 'ช่วงบ่าย'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="block">
                        <select value={form[key]} onChange={(e) => set(key, e.target.value as DailyWeather)} className={field}>
                          {Object.entries(WEATHER).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                        <span className="mt-0.5 block text-[11px] text-slate-500">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="border-t border-[#173a7a] sm:border-r sm:border-t-0">
                  <div className="border-b border-[#173a7a] px-2 py-2 font-semibold text-slate-900">Schedule Impact</div>
                  <div className="flex flex-col gap-3 p-3">
                    <Choice name="schedule-impact" checked={form.scheduleImpact} onChange={() => set('scheduleImpact', true)}>
                      กระทบต่อแผนการทำงาน
                    </Choice>
                    <Choice name="schedule-impact" checked={!form.scheduleImpact} onChange={() => set('scheduleImpact', false)}>
                      ไม่กระทบต่อแผนการทำงาน
                    </Choice>
                  </div>
                </div>
                <div className="flex flex-col border-t border-[#173a7a] sm:border-t-0">
                  <div className="border-b border-[#173a7a] px-2 py-2 font-semibold text-slate-900">Note</div>
                  <textarea aria-label="หมายเหตุผลต่อแผนงาน" rows={3} maxLength={1000} value={form.scheduleNote} onChange={(e) => set('scheduleNote', e.target.value)} placeholder="หมายเหตุ" className={`${plainInput} flex-1 resize-y`} />
                </div>
              </section>

              <section className="border border-[#173a7a]">
                <Band right={addRowButton(() => set('work', [...form.work, blankWork()]))}>
                  <span className="block text-center">สรุปงานประจำวัน (Work Summary)</span>
                </Band>
                <div className={`hidden divide-x divide-[#173a7a] border-b border-[#173a7a] text-center font-semibold text-slate-900 sm:grid ${WORK_COLS}`}>
                  <span className="py-1.5">รายละเอียดการทำงาน (Task)</span>
                  <span className="py-1.5">Completed</span>
                  <span className="py-1.5">Delayed</span>
                  <span className="py-1.5">Note ปัญหาการทำงาน</span>
                </div>
                <div className="divide-y divide-[#173a7a]">
                  {form.work.map((w, i) => (
                    <div key={i} className={`grid grid-cols-2 sm:divide-x sm:divide-[#173a7a] ${WORK_COLS}`}>
                      <label className="col-span-2 block sm:col-span-1">
                        <textarea aria-label={`รายละเอียดการทำงาน แถว ${i + 1}`} rows={2} maxLength={500} value={w.description} onChange={(e) => setLine('work', i, { description: e.target.value })} placeholder="รายละเอียดการทำงาน" className={`${plainInput} resize-y`} />
                      </label>
                      {(['COMPLETED', 'DELAYED'] as const).map((o) => (
                        <label key={o} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 sm:justify-center">
                          {/* A radio that can be cleared again: most rows have no outcome yet */}
                          <input
                            type="radio"
                            name={`work-outcome-${i}`}
                            checked={w.outcome === o}
                            readOnly
                            onClick={() => setLine('work', i, { outcome: w.outcome === o ? null : o })}
                            aria-label={`${o === 'COMPLETED' ? 'Completed' : 'Delayed'} แถว ${i + 1}`}
                            className="h-4 w-4 accent-[#173a7a]"
                          />
                          <span className="sm:hidden">{o === 'COMPLETED' ? 'Completed' : 'Delayed'}</span>
                        </label>
                      ))}
                      <label className="col-span-2 block sm:col-span-1">
                        <textarea aria-label={`Note แถว ${i + 1}`} rows={2} maxLength={500} value={w.note} onChange={(e) => setLine('work', i, { note: e.target.value })} placeholder="Note" className={`${plainInput} resize-y`} />
                      </label>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border border-[#173a7a]">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[#173a7a] px-2.5 py-1.5 font-bold text-white">
                  <span>สรุปจำนวนคนงาน (Labour Summary) · รวม {form.labour.reduce((s, l) => s + (l.workers || 0), 0)} คน</span>
                  <span className="flex items-center gap-3">
                    สรุปการใช้เครื่องมือ-เครื่องจักร (Equipment Summary)
                    {addRowButton(() => setForm((f) => (f ? { ...f, labour: [...f.labour, blankLabour()], equipment: [...f.equipment, blankEquipment()] } : f)))}
                  </span>
                </div>
                <div className={`hidden divide-x divide-[#173a7a] border-b border-[#173a7a] text-center font-semibold text-slate-900 sm:grid ${RESOURCE_COLS}`}>
                  <span className="py-1.5">บริษัท (Company)</span>
                  <span className="py-1.5">Work Hour</span>
                  <span className="py-1.5">จำนวนคน</span>
                  <span className="py-1.5">ประเภทของเครื่องจักร</span>
                  <span className="py-1.5">จำนวนชั่วโมงที่ใช้งาน</span>
                </div>
                <div className="divide-y divide-[#173a7a]">
                  {form.labour.map((l, i) => {
                    const q = form.equipment[i] ?? blankEquipment();
                    return (
                      <div key={i} className={`grid grid-cols-2 sm:divide-x sm:divide-[#173a7a] ${RESOURCE_COLS}`}>
                        <label className="col-span-2 block sm:col-span-1">
                          <input aria-label={`บริษัท แถว ${i + 1}`} maxLength={200} value={l.company} onChange={(e) => setLine('labour', i, { company: e.target.value })} placeholder="บริษัท/ประเภทคนงาน" className={plainInput} />
                        </label>
                        <label className="block">
                          <input aria-label={`Work Hour แถว ${i + 1}`} type="number" min={0} max={24} step={0.5} value={l.hours || ''} onChange={(e) => setLine('labour', i, { hours: Number(e.target.value) || 0 })} placeholder="ชั่วโมง" className={plainInput} />
                          {caption('Work Hour')}
                        </label>
                        <label className="block">
                          <input aria-label={`จำนวนคน แถว ${i + 1}`} type="number" min={0} value={l.workers || ''} onChange={(e) => setLine('labour', i, { workers: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} placeholder="จำนวน" className={plainInput} />
                          {caption('จำนวนคน')}
                        </label>
                        <label className="block border-t border-slate-200 sm:border-t-0">
                          <input aria-label={`ประเภทเครื่องจักร แถว ${i + 1}`} maxLength={200} value={q.type} onChange={(e) => setLine('equipment', i, { type: e.target.value })} placeholder="ประเภทเครื่องจักร" className={plainInput} />
                        </label>
                        <label className="block border-t border-slate-200 sm:border-t-0">
                          <input aria-label={`ชั่วโมงใช้งาน แถว ${i + 1}`} type="number" min={0} max={24} step={0.5} value={q.hours || ''} onChange={(e) => setLine('equipment', i, { hours: Number(e.target.value) || 0 })} placeholder="ชั่วโมง" className={plainInput} />
                          {caption('ชั่วโมงที่ใช้งาน')}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="border border-[#173a7a]">
                <div className="grid grid-cols-2 sm:grid-cols-[38%_1fr_1fr]">
                  <div className="col-span-2 flex items-center justify-center bg-[#173a7a] p-2.5 font-bold text-white sm:col-span-1">Safety Report</div>
                  <div className="p-2.5 sm:text-center">
                    <Choice name="accident" checked={!form.accident} onChange={() => set('accident', false)}>
                      No accident
                    </Choice>
                  </div>
                  <div className="border-l border-[#173a7a] p-2.5 sm:text-center">
                    <Choice name="accident" checked={form.accident} onChange={() => set('accident', true)}>
                      Accident
                    </Choice>
                  </div>
                </div>
                <textarea aria-label="บันทึกความปลอดภัย" rows={3} maxLength={2000} value={form.safetyNote} onChange={(e) => set('safetyNote', e.target.value)} placeholder="Safety note" className={`${plainInput} resize-y border-t border-[#173a7a]`} />
              </section>

              <section className="border border-[#173a7a]">
                <div className="grid grid-cols-2 sm:grid-cols-[38%_1fr_1fr]">
                  <div className="col-span-2 flex items-center justify-center bg-[#173a7a] p-2.5 font-bold text-white sm:col-span-1">Visitor</div>
                  <div className="p-2.5 sm:text-center">
                    <Choice name="visitor" checked={!hasVisitor} onChange={() => setHasVisitor(false)}>
                      None
                    </Choice>
                  </div>
                  <div className="border-l border-[#173a7a] p-2.5 sm:text-center">
                    <Choice name="visitor" checked={hasVisitor} onChange={() => setHasVisitor(true)}>
                      Has visitor
                    </Choice>
                  </div>
                </div>
                <textarea aria-label="รายละเอียดผู้เยี่ยมชม" rows={3} maxLength={1000} disabled={!hasVisitor} value={hasVisitor ? form.visitors : ''} onChange={(e) => set('visitors', e.target.value)} placeholder={hasVisitor ? 'Visitor detail' : 'เลือก "Has visitor" ก่อนจึงจะกรอกได้'} className={`${plainInput} resize-y border-t border-[#173a7a]`} />
              </section>

              <section className="border border-[#173a7a]">
                <div className="bg-[#173a7a] px-2 py-2 text-center font-bold text-white">Project Duration</div>
                <div className="grid grid-cols-[minmax(0,1fr)_80px] sm:grid-cols-[minmax(0,1fr)_80px_minmax(0,1fr)_80px_minmax(0,1fr)_80px]">
                  <div className="border-b border-r border-slate-300 p-2 sm:border-b-0">Total work hours today</div>
                  <div className="border-b border-slate-300 p-2 sm:border-b-0 sm:border-r" title="คนงาน × ชั่วโมง รวมทุกแถว">{workHours > 0 ? workHours : <span className="text-slate-500">Auto</span>}</div>
                  <div className="border-b border-r border-slate-300 p-2 sm:border-b-0">Elapsed project days</div>
                  <div className="border-b border-slate-300 p-2 sm:border-b-0 sm:border-r">{durationText(duration?.elapsed ?? null)}</div>
                  <div className="border-r border-slate-300 p-2">Remaining project days</div>
                  <div className="p-2">{durationText(duration?.remaining ?? null)}</div>
                </div>
              </section>

              <section className="border border-[#173a7a]">
                <Band right={addRowButton(() => set('progress', [...form.progress, blankProgress()]))}>
                  <span className="block text-center">{"Today's Overall Progress"}</span>
                </Band>
                <div className={`hidden divide-x divide-[#173a7a] border-b border-[#173a7a] font-semibold text-slate-900 sm:grid ${PROGRESS_COLS}`}>
                  <span className="px-2 py-1.5">ลำดับ</span>
                  <span className="px-2 py-1.5">พื้นที่/ยูนิต</span>
                  <span className="px-2 py-1.5">รายการงาน</span>
                  <span className="px-2 py-1.5">ผลงานวันนี้ (%)</span>
                  <span className="px-2 py-1.5">หมายเหตุ</span>
                </div>
                <div className="divide-y divide-[#173a7a]">
                  {form.progress.map((p, i) => (
                    <div key={i} className={`grid grid-cols-2 sm:divide-x sm:divide-[#173a7a] ${PROGRESS_COLS}`}>
                      <div className="col-span-2 px-2 py-1.5 font-semibold sm:col-span-1 sm:flex sm:items-center sm:justify-center sm:font-normal">
                        <span className="sm:hidden">ลำดับ </span>
                        {i + 1}
                      </div>
                      <label className="col-span-2 block sm:col-span-1">
                        <textarea aria-label={`พื้นที่/ยูนิต แถว ${i + 1}`} rows={2} maxLength={200} value={p.area} onChange={(e) => setLine('progress', i, { area: e.target.value })} placeholder="พื้นที่/ยูนิต" className={`${plainInput} resize-y`} />
                      </label>
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <select aria-label={`รายการงานจาก Gantt แถว ${i + 1}`} value={p.taskId ?? ''} onChange={(e) => setLine('progress', i, { taskId: e.target.value || null })} className={plainInput}>
                          <option value="">เลือก Task จาก Gantt</option>
                          {tasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.wbs} {t.title} (ปัจจุบัน {t.progress}%)
                            </option>
                          ))}
                        </select>
                        <input aria-label={`พิมพ์เพิ่มเติม แถว ${i + 1}`} maxLength={500} value={p.detail} onChange={(e) => setLine('progress', i, { detail: e.target.value })} placeholder="พิมพ์เพิ่มเติม" className={plainInput} />
                      </div>
                      <label className="block">
                        <input
                          aria-label={`ผลงานวันนี้ (%) แถว ${i + 1}`}
                          type="number"
                          min={0}
                          max={100}
                          step="any"
                          value={p.todayPercent ?? ''}
                          onChange={(e) => setLine('progress', i, { todayPercent: e.target.value === '' ? null : Number(e.target.value) })}
                          placeholder="%"
                          className={`${plainInput} sm:text-center`}
                        />
                        {caption('ผลงานวันนี้ (%)')}
                      </label>
                      <label className="block">
                        <textarea aria-label={`หมายเหตุ แถว ${i + 1}`} rows={2} maxLength={500} value={p.note} onChange={(e) => setLine('progress', i, { note: e.target.value })} placeholder="หมายเหตุ" className={`${plainInput} resize-y`} />
                      </label>
                    </div>
                  ))}
                </div>
                <p className="border-t border-[#173a7a] bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
                  ผลงานวันนี้ (%) คือเปอร์เซ็นต์ที่ทำเพิ่มในวันนี้ เมื่อกด &quot;ส่งรายงาน&quot; ระบบจะบวกเพิ่มไปที่งานใน Gantt (สูงสุด 100%)
                </p>
              </section>

              <SheetHeader number={number ?? 'ออกเลขเมื่อบันทึก'} logoUrl={logoUrl} />
              <section className="border border-[#173a7a]">
                <div className="bg-[#173a7a] px-2 py-2.5 text-center font-bold text-white">{project.name}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  {Array.from({ length: slotCount }, (_, i) => {
                    const photo = photos[i];
                    const isNext = i === photos.length;
                    return (
                      <div key={photo ? photoId(photo) : `empty-${i}`} className="border-t border-[#173a7a] p-3 first:border-t-0 sm:[&:nth-child(2)]:border-t-0 sm:[&:nth-child(even)]:border-l">
                        {photo ? (
                          <div className="group relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.url} alt={photo.caption || `รูปที่ ${i + 1}`} className="aspect-[2/1] w-full rounded border border-slate-200 object-cover" />
                            <button type="button" onClick={() => removePhoto(photo)} className="absolute right-1.5 top-1.5 rounded bg-white/90 p-1.5 text-slate-600 shadow-sm hover:text-red-600" title="ลบรูป" aria-label={`ลบรูปที่ ${i + 1}`}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <label className={`flex aspect-[2/1] w-full flex-col items-center justify-center gap-1 rounded border border-dashed border-blue-300 bg-blue-50/60 text-slate-600 ${isNext ? 'cursor-pointer hover:bg-blue-50' : 'cursor-pointer'}`}>
                            <ImagePlus className="h-6 w-6 text-[#2453d4]" />
                            <span>รูปที่ {i + 1}</span>
                            <input
                              type="file"
                              multiple
                              accept="image/jpeg,image/png,image/webp,image/gif"
                              className="sr-only"
                              aria-label={`เลือกรูปที่ ${i + 1}`}
                              onChange={(e) => {
                                addPhotos(e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                        <input
                          aria-label={`รายละเอียดรูปที่ ${i + 1}`}
                          maxLength={500}
                          disabled={!photo}
                          value={photo?.caption ?? ''}
                          onChange={(e) => photo && setCaption(photo, e.target.value)}
                          placeholder="รายละเอียดรูปภาพ"
                          className={`${plainInput} mt-1.5 disabled:bg-transparent`}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
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

/** The report as printable A4 sheets; used on screen and in the print copy. */
function DailySheet({ data, project, tasks, logoUrl }: { data: LoadedReport; project: DailyProject; tasks: { id: string; wbs: string; title: string }[]; logoUrl: string | null }) {
  const taskName = (id: string | null | undefined) => {
    const t = tasks.find((x) => x.id === id);
    return t ? `${t.wbs} ${t.title}` : '';
  };
  const mark = (on: boolean) => (on ? '●' : '○');
  const duration = projectDuration(project.startDate, project.endDate, data.reportDate);
  const photos = data.photos.filter((p) => p.contentType.startsWith('image/'));
  // Reports from before the progress table kept a cumulative figure on the work line
  const legacyProgress = data.work.some((w) => w.progressPercent != null);
  const rows = Math.max(data.labour.length, data.equipment.length);
  return (
    <>
      <A4Page>
        <SheetHeader number={data.number} logoUrl={logoUrl} />
        <section className="keep-together grid grid-cols-[120px_minmax(0,1fr)_120px_minmax(0,150px)] border border-b-0 border-[#173a7a]">
          <div className="col-span-2 flex items-center justify-center bg-[#173a7a] px-2 py-1.5 font-bold text-white">รายละเอียดโครงการ (Project Detail)</div>
          <DetailCells label="วันที่ (Date)">{dateText(data.reportDate)}</DetailCells>
          <DetailCells label="ชื่อโครงการ">{project.name}</DetailCells>
          <DetailCells label="ผู้เขียนรายงาน">{data.createdByName}</DetailCells>
          <DetailCells label="สถานที่ก่อสร้าง">{project.location || '-'}</DetailCells>
          <DetailCells label="เวลาเริ่มงาน">{data.startTime ?? '-'}</DetailCells>
          <DetailCells label="ลักษณะโครงการ">{project.group || '-'}</DetailCells>
          <DetailCells label="เวลาเลิกงาน">{data.endTime ?? '-'}</DetailCells>
        </section>
        <section className="keep-together grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] border border-[#173a7a]">
          <div className="border-r border-[#173a7a]">
            <div className="bg-[#173a7a] px-2 py-1.5 text-center font-bold text-white">สภาพอากาศ (Weather)</div>
            <div className="space-y-0.5 p-2">
              <div>ช่วงเช้า: <b>{WEATHER[data.weatherMorning]}</b></div>
              <div>ช่วงบ่าย: <b>{WEATHER[data.weatherAfternoon]}</b></div>
            </div>
          </div>
          <div className="border-r border-[#173a7a]">
            <div className="border-b border-[#173a7a] px-2 py-1.5 font-semibold">Schedule Impact</div>
            <div className="space-y-0.5 p-2">
              <div>{mark(data.scheduleImpact)} กระทบต่อแผนการทำงาน</div>
              <div>{mark(!data.scheduleImpact)} ไม่กระทบต่อแผนการทำงาน</div>
            </div>
          </div>
          <div>
            <div className="border-b border-[#173a7a] px-2 py-1.5 font-semibold">Note</div>
            <div className="whitespace-pre-wrap p-2">{data.scheduleNote || '-'}</div>
          </div>
        </section>
        <section className="border border-[#173a7a]">
          <Band><span className="block text-center">สรุปงานประจำวัน (Work Summary)</span></Band>
          <table className="w-full text-[10.5px]">
            <thead className="border-b border-[#173a7a]">
              <tr>
                <th className="px-2 py-1 text-center">รายละเอียดการทำงาน (Task)</th>
                {legacyProgress && <th className="px-2 py-1 text-center">สะสม (%)</th>}
                <th className="w-16 px-2 py-1 text-center">Completed</th>
                <th className="w-16 px-2 py-1 text-center">Delayed</th>
                <th className="px-2 py-1 text-center">Note ปัญหาการทำงาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.work.length === 0 ? (
                <tr><td colSpan={legacyProgress ? 5 : 4} className="px-2 py-2 text-center text-slate-500">ไม่มีรายการ</td></tr>
              ) : (
                data.work.map((w, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">
                      {w.description || '-'}
                      {w.taskId && <div className="text-[10px] text-slate-500">{taskName(w.taskId)}</div>}
                    </td>
                    {legacyProgress && <td className="px-2 py-1 text-center">{w.progressPercent ?? '-'}</td>}
                    <td className="px-2 py-1 text-center">{mark(w.outcome === 'COMPLETED')}</td>
                    <td className="px-2 py-1 text-center">{mark(w.outcome === 'DELAYED')}</td>
                    <td className="px-2 py-1">{w.note || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
        <section className="keep-together border border-[#173a7a]">
          <div className="flex justify-between bg-[#173a7a] px-2.5 py-1.5 font-bold text-white">
            <span>สรุปจำนวนคนงาน (Labour Summary) · รวม {data.labour.reduce((s, l) => s + l.workers, 0)} คน</span>
            <span>เครื่องมือ-เครื่องจักร (Equipment Summary)</span>
          </div>
          <table className="w-full text-[10.5px]">
            <thead className="border-b border-[#173a7a]">
              <tr>
                <th className="px-2 py-1 text-left">บริษัท (Company)</th>
                <th className="px-2 py-1 text-right">Work Hour</th>
                <th className="px-2 py-1 text-right">จำนวนคน</th>
                <th className="border-l border-[#173a7a] px-2 py-1 text-left">ประเภทของเครื่องจักร</th>
                <th className="px-2 py-1 text-right">ชั่วโมงที่ใช้งาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows === 0 ? (
                <tr><td colSpan={5} className="px-2 py-2 text-center text-slate-500">ไม่มีรายการ</td></tr>
              ) : (
                Array.from({ length: rows }, (_, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">{data.labour[i]?.company || (data.labour[i] ? '-' : '')}</td>
                    <td className="px-2 py-1 text-right">{data.labour[i]?.hours ?? ''}</td>
                    <td className="px-2 py-1 text-right">{data.labour[i]?.workers ?? ''}</td>
                    <td className="border-l border-[#173a7a] px-2 py-1">{data.equipment[i]?.type ?? ''}</td>
                    <td className="px-2 py-1 text-right">{data.equipment[i]?.hours ?? ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
        <section className="keep-together border border-[#173a7a]">
          <div className="grid grid-cols-[38%_1fr_1fr]">
            <div className="bg-[#173a7a] p-1.5 text-center font-bold text-white">Safety Report</div>
            <div className="p-1.5 text-center">{mark(!data.accident)} No accident</div>
            <div className="border-l border-[#173a7a] p-1.5 text-center">{mark(data.accident)} Accident</div>
          </div>
          {data.safetyNote && <div className="whitespace-pre-wrap border-t border-[#173a7a] p-2">{data.safetyNote}</div>}
        </section>
        <section className="keep-together border border-[#173a7a]">
          <div className="grid grid-cols-[38%_1fr_1fr]">
            <div className="bg-[#173a7a] p-1.5 text-center font-bold text-white">Visitor</div>
            <div className="p-1.5 text-center">{mark(!data.visitors)} None</div>
            <div className="border-l border-[#173a7a] p-1.5 text-center">{mark(!!data.visitors)} Has visitor</div>
          </div>
          {data.visitors && <div className="whitespace-pre-wrap border-t border-[#173a7a] p-2">{data.visitors}</div>}
        </section>
        <section className="keep-together border border-[#173a7a]">
          <div className="bg-[#173a7a] px-2 py-1.5 text-center font-bold text-white">Project Duration</div>
          <div className="grid grid-cols-[1fr_56px_1fr_56px_1fr_56px] divide-x divide-slate-300">
            <div className="p-1.5">Total work hours today</div>
            <div className="p-1.5 text-center">{totalWorkHours(data.labour)}</div>
            <div className="p-1.5">Elapsed project days</div>
            <div className="p-1.5 text-center">{durationText(duration.elapsed)}</div>
            <div className="p-1.5">Remaining project days</div>
            <div className="p-1.5 text-center">{durationText(duration.remaining)}</div>
          </div>
        </section>
        <section className="border border-[#173a7a]">
          <Band><span className="block text-center">{"Today's Overall Progress"}</span></Band>
          <table className="w-full text-[10.5px]">
            <thead className="border-b border-[#173a7a]">
              <tr>
                <th className="w-10 px-2 py-1 text-center">ลำดับ</th>
                <th className="px-2 py-1 text-left">พื้นที่/ยูนิต</th>
                <th className="px-2 py-1 text-left">รายการงาน</th>
                <th className="px-2 py-1 text-center">ผลงานวันนี้ (%)</th>
                <th className="px-2 py-1 text-center">สะสม (%)</th>
                <th className="px-2 py-1 text-left">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.progress.length === 0 ? (
                <tr><td colSpan={6} className="px-2 py-2 text-center text-slate-500">ไม่มีรายการ</td></tr>
              ) : (
                data.progress.map((p, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 text-center">{i + 1}</td>
                    <td className="px-2 py-1">{p.area || '-'}</td>
                    <td className="px-2 py-1">
                      {taskName(p.taskId) || p.detail || '-'}
                      {p.taskId && p.detail && <div className="text-[10px] text-slate-500">{p.detail}</div>}
                    </td>
                    <td className="px-2 py-1 text-center">{p.todayPercent ?? '-'}</td>
                    <td className="px-2 py-1 text-center">{p.cumulativePercent ?? '-'}</td>
                    <td className="px-2 py-1">{p.note || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
        {(data.issues || data.summary) && (
          <div className="keep-together grid grid-cols-2 gap-3">
            <section className="border border-[#173a7a]">
              <Band>ปัญหา / อุปสรรค</Band>
              <div className="whitespace-pre-wrap p-2">{data.issues || '-'}</div>
            </section>
            <section className="border border-[#173a7a]">
              <Band>สรุปภาพรวม</Band>
              <div className="whitespace-pre-wrap p-2">{data.summary || '-'}</div>
            </section>
          </div>
        )}
      </A4Page>
      {photos.length > 0 && (
        <A4Page>
          <SheetHeader number={data.number} logoUrl={logoUrl} />
          <section className="border border-[#173a7a]">
            <div className="bg-[#173a7a] px-2 py-2 text-center font-bold text-white">{project.name}</div>
            <div className="grid grid-cols-2">
              {photos.map((p, i) => (
                <figure key={p.id} className={`keep-together border-[#173a7a] p-2 ${i > 1 ? 'border-t' : ''} ${i % 2 === 1 ? 'border-l' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption || p.name} className="aspect-[4/3] w-full border border-slate-200 object-cover" />
                  <figcaption className="mt-1 min-h-[1.25rem] text-[10.5px] text-slate-700">{p.caption}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        </A4Page>
      )}
    </>
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

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <p className="rounded-xl bg-white p-8 text-center text-xs text-slate-500">กำลังโหลดรายงาน...</p>;

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
              <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                <FileText className="h-3.5 w-3.5" /> แก้ไข
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  confirm('ส่งรายงาน? ส่งแล้วแก้ไขไม่ได้ และผลงานวันนี้จะบวกเพิ่มไปที่งานใน Gantt') &&
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

      <div className="space-y-4 overflow-x-auto rounded-xl bg-slate-100 p-4">
        <DailySheet data={data} project={project} tasks={tasks} logoUrl={logoUrl} />
      </div>
      <PrintRoot>
        <DailySheet data={data} project={project} tasks={tasks} logoUrl={logoUrl} />
      </PrintRoot>
    </div>
  );
}
