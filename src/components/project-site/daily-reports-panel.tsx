'use client';

import React, { useRef, useState, useTransition } from 'react';
import { ArrowLeft, Camera, FileText, Plus, Printer, Send, Trash2 } from 'lucide-react';
import type { DailyWeather } from '@/db/schema';
import type { DailyReportInput } from '@/server/services/project-site';
import {
  deleteFileAction,
  loadDailyReportAction,
  loadDailyReportsAction,
  saveDailyReportAction,
  submitDailyReportAction,
} from '@/app/(app)/projects/[id]/site-actions';
import { uploadFile, useSiteLoader } from './use-site-loader';

const WEATHER: Record<DailyWeather, string> = { SUNNY: 'แดด', CLOUDY: 'เมฆครึ้ม', RAIN: 'ฝนตก', HEAVY_RAIN: 'ฝนตกหนัก', OTHER: 'อื่นๆ' };
const field = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-[#2453d4] focus:outline-none bg-white';
const dateText = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

type View = { kind: 'list' } | { kind: 'edit'; id: string | null } | { kind: 'view'; id: string };

export function DailyReportsPanel({
  projectId,
  projectName,
  tasks,
  today,
}: {
  projectId: string;
  projectName: string;
  tasks: { id: string; wbs: string; title: string; progress: number }[];
  today: string;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  if (view.kind === 'edit') {
    return <ReportEditor projectId={projectId} reportId={view.id} tasks={tasks} today={today} onDone={(id) => setView(id ? { kind: 'view', id } : { kind: 'list' })} />;
  }
  if (view.kind === 'view') {
    return (
      <ReportView
        projectId={projectId}
        projectName={projectName}
        reportId={view.id}
        tasks={tasks}
        onBack={() => setView({ kind: 'list' })}
        onEdit={() => setView({ kind: 'edit', id: view.id })}
      />
    );
  }
  return <ReportList projectId={projectId} onOpen={(id) => setView({ kind: 'view', id })} onNew={() => setView({ kind: 'edit', id: null })} />;
}

function ReportList({ projectId, onOpen, onNew }: { projectId: string; onOpen: (id: string) => void; onNew: () => void }) {
  const { data, error } = useSiteLoader(() => loadDailyReportsAction(projectId), [projectId]);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-slate-900">รายงานประจำวัน (Daily Report)</h3>
          <p className="text-[11px] text-slate-500">บันทึกสภาพอากาศ งานที่ทำ คนงาน เครื่องจักร ความปลอดภัย และรูปถ่ายหน้างาน</p>
        </div>
        <button type="button" onClick={onNew} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-[#2453d4] text-white text-xs font-semibold">
          <Plus className="w-3.5 h-3.5" /> เขียนรายงานประจำวัน
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
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
                <td colSpan={6} className="py-10 text-center text-slate-400">
                  ยังไม่มีรายงานสำหรับโครงการนี้
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

type Form = Required<Omit<DailyReportInput, 'work' | 'labour' | 'equipment'>> & {
  work: { taskId: string | null; description: string; progressPercent: number | null; note: string }[];
  labour: { company: string; workers: number; hours: number }[];
  equipment: { type: string; hours: number }[];
};

const blank = (today: string): Form => ({
  reportDate: today,
  startTime: '08:00',
  endTime: '17:00',
  weatherMorning: 'SUNNY',
  weatherAfternoon: 'SUNNY',
  scheduleImpact: false,
  work: [{ taskId: null, description: '', progressPercent: null, note: '' }],
  labour: [{ company: '', workers: 0, hours: 8 }],
  equipment: [{ type: '', hours: 0 }],
  accident: false,
  safetyNote: '',
  visitors: '',
  issues: '',
  summary: '',
});

function ReportEditor({
  projectId,
  reportId,
  tasks,
  today,
  onDone,
}: {
  projectId: string;
  reportId: string | null;
  tasks: { id: string; wbs: string; title: string; progress: number }[];
  today: string;
  onDone: (id: string | null) => void;
}) {
  const [form, setForm] = useState<Form | null>(reportId ? null : blank(today));
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
        setForm({
          reportDate: v.reportDate,
          startTime: v.startTime,
          endTime: v.endTime,
          weatherMorning: v.weatherMorning,
          weatherAfternoon: v.weatherAfternoon,
          scheduleImpact: v.scheduleImpact,
          work: v.work.length ? v.work : blank(today).work,
          labour: v.labour.length ? v.labour : blank(today).labour,
          equipment: v.equipment.length ? v.equipment : blank(today).equipment,
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

  if (loadError) return <p className="text-xs text-red-600">{loadError}</p>;
  if (!form) return <p className="p-8 text-center text-xs text-slate-400">กำลังโหลดรายงาน...</p>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setLine = <K extends 'work' | 'labour' | 'equipment'>(k: K, i: number, patch: Partial<Form[K][number]>) =>
    setForm((f) => (f ? { ...f, [k]: f[k].map((l, j) => (j === i ? { ...l, ...patch } : l)) } : f));
  const addLine = (k: 'work' | 'labour' | 'equipment') => setForm((f) => (f ? { ...f, [k]: [...f[k], blank(today)[k][0]] } : f));
  const removeLine = (k: 'work' | 'labour' | 'equipment', i: number) => setForm((f) => (f ? { ...f, [k]: f[k].filter((_, j) => j !== i) } : f));
  const totalWorkers = form.labour.reduce((s, l) => s + (l.workers || 0), 0);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveDailyReportAction(projectId, reportId, form);
      if (!r.ok) setError(r.error);
      else onDone(r.value.id);
    });
  };

  const section = (title: string, children: React.ReactNode, extra?: React.ReactNode) => (
    <section className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="bg-[#173a7a] text-white px-3 py-1.5 text-xs font-bold flex items-center justify-between">
        <span>{title}</span>
        {extra}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
  const addBtn = (k: 'work' | 'labour' | 'equipment') => (
    <button type="button" onClick={() => addLine(k)} className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-[11px] hover:bg-white/25">
      <Plus className="w-3 h-3" /> เพิ่มแถว
    </button>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4 text-xs"
    >
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onDone(reportId)} className="p-1 rounded hover:bg-slate-100 text-slate-500" title="ย้อนกลับ">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h3 className="font-bold text-sm text-slate-900">{reportId ? 'แก้ไขรายงานประจำวัน' : 'รายงานประจำวันใหม่'}</h3>
      </div>
      <fieldset disabled={isPending} className="space-y-4">
        {section(
          'รายละเอียดวันทำงาน',
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <label>
              <span className="block text-slate-600 mb-0.5">วันที่ *</span>
              <input type="date" required max={today} value={form.reportDate} onChange={(e) => set('reportDate', e.target.value)} className={field} />
            </label>
            <label>
              <span className="block text-slate-600 mb-0.5">เวลาเริ่มงาน</span>
              <input type="time" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value || null)} className={field} />
            </label>
            <label>
              <span className="block text-slate-600 mb-0.5">เวลาเลิกงาน</span>
              <input type="time" value={form.endTime ?? ''} onChange={(e) => set('endTime', e.target.value || null)} className={field} />
            </label>
            <label>
              <span className="block text-slate-600 mb-0.5">อากาศช่วงเช้า</span>
              <select value={form.weatherMorning} onChange={(e) => set('weatherMorning', e.target.value as DailyWeather)} className={field}>
                {Object.entries(WEATHER).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="block text-slate-600 mb-0.5">อากาศช่วงบ่าย</span>
              <select value={form.weatherAfternoon} onChange={(e) => set('weatherAfternoon', e.target.value as DailyWeather)} className={field}>
                {Object.entries(WEATHER).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 sm:col-span-5 inline-flex items-center gap-2">
              <input type="checkbox" checked={form.scheduleImpact} onChange={(e) => set('scheduleImpact', e.target.checked)} /> สภาพอากาศกระทบต่อแผนการทำงาน
            </label>
          </div>,
        )}

        {section(
          'งานที่ทำวันนี้ / ความคืบหน้า',
          <div className="space-y-2">
            {form.work.map((w, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <label className="col-span-12 sm:col-span-4">
                  <span className="block text-slate-600 mb-0.5">งานใน Gantt</span>
                  <select
                    value={w.taskId ?? ''}
                    onChange={(e) => {
                      const t = tasks.find((x) => x.id === e.target.value);
                      setLine('work', i, { taskId: e.target.value || null, ...(t && !w.description ? { description: t.title } : {}), ...(t && w.progressPercent === null ? { progressPercent: t.progress } : {}) });
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
                </label>
                <label className="col-span-12 sm:col-span-3">
                  <span className="block text-slate-600 mb-0.5">รายละเอียดงาน</span>
                  <input value={w.description} onChange={(e) => setLine('work', i, { description: e.target.value })} placeholder="รายละเอียดงานที่ทำ" className={field} />
                </label>
                <label className="col-span-5 sm:col-span-2">
                  <span className="block text-slate-600 mb-0.5">ปริมาณงานสะสม (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!w.taskId}
                    value={w.progressPercent ?? ''}
                    onChange={(e) => setLine('work', i, { progressPercent: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder={w.taskId ? '0-100' : 'เลือกงานก่อน'}
                    className={field}
                  />
                </label>
                <label className="col-span-6 sm:col-span-2">
                  <span className="block text-slate-600 mb-0.5">ปัญหา/หมายเหตุ</span>
                  <input value={w.note} onChange={(e) => setLine('work', i, { note: e.target.value })} className={field} />
                </label>
                <button type="button" onClick={() => removeLine('work', i)} className="col-span-1 p-1.5 pb-2.5 text-slate-400 hover:text-red-600" title="ลบแถว" aria-label="ลบแถว">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <p className="text-[11px] text-slate-500">ปริมาณงานสะสม (%) คือเปอร์เซ็นต์งานที่ทำเสร็จแล้วรวมถึงวันนี้ กรอกได้เมื่อเลือกงานใน Gantt และจะอัปเดตไปที่งานเมื่อกด &quot;ส่งรายงาน&quot;</p>
          </div>,
          addBtn('work'),
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {section(
            `คนงาน (รวม ${totalWorkers} คน)`,
            <div className="space-y-2">
              {form.labour.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <label className="col-span-5">
                    <span className="block text-slate-600 mb-0.5">บริษัท / ประเภทคนงาน</span>
                    <input value={l.company} onChange={(e) => setLine('labour', i, { company: e.target.value })} className={field} />
                  </label>
                  <label className="col-span-3">
                    <span className="block text-slate-600 mb-0.5">จำนวนคน</span>
                    <input type="number" min={0} value={l.workers} onChange={(e) => setLine('labour', i, { workers: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} className={field} />
                  </label>
                  <label className="col-span-3">
                    <span className="block text-slate-600 mb-0.5">ชั่วโมงทำงาน</span>
                    <input type="number" min={0} max={24} step={0.5} value={l.hours} onChange={(e) => setLine('labour', i, { hours: Number(e.target.value) || 0 })} className={field} />
                  </label>
                  <button type="button" onClick={() => removeLine('labour', i)} className="col-span-1 pb-2.5 text-slate-400 hover:text-red-600" title="ลบแถว" aria-label="ลบแถว">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>,
            addBtn('labour'),
          )}
          {section(
            'เครื่องมือ-เครื่องจักร',
            <div className="space-y-2">
              {form.equipment.map((q, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <label className="col-span-8">
                    <span className="block text-slate-600 mb-0.5">ประเภทเครื่องจักร</span>
                    <input value={q.type} onChange={(e) => setLine('equipment', i, { type: e.target.value })} placeholder="เช่น รถแบ็คโฮ, รถโม่ปูน" className={field} />
                  </label>
                  <label className="col-span-3">
                    <span className="block text-slate-600 mb-0.5">ชั่วโมงใช้งาน</span>
                    <input type="number" min={0} max={24} step={0.5} value={q.hours} onChange={(e) => setLine('equipment', i, { hours: Number(e.target.value) || 0 })} className={field} />
                  </label>
                  <button type="button" onClick={() => removeLine('equipment', i)} className="col-span-1 pb-2.5 text-slate-400 hover:text-red-600" title="ลบแถว" aria-label="ลบแถว">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>,
            addBtn('equipment'),
          )}
        </div>

        {section(
          'ความปลอดภัย / ผู้เยี่ยมชม / ปัญหา',
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="inline-flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" checked={form.accident} onChange={(e) => set('accident', e.target.checked)} /> มีอุบัติเหตุ
            </label>
            <label>
              <span className="block text-slate-600 mb-0.5">บันทึกความปลอดภัย</span>
              <textarea rows={2} value={form.safetyNote} onChange={(e) => set('safetyNote', e.target.value)} className={field} />
            </label>
            <label>
              <span className="block text-slate-600 mb-0.5">ผู้เยี่ยมชม</span>
              <textarea rows={2} value={form.visitors} onChange={(e) => set('visitors', e.target.value)} placeholder="ไม่มี / ชื่อและหน่วยงาน" className={field} />
            </label>
            <label>
              <span className="block text-slate-600 mb-0.5">ปัญหา / อุปสรรค</span>
              <textarea rows={2} value={form.issues} onChange={(e) => set('issues', e.target.value)} className={field} />
            </label>
            <label>
              <span className="block text-slate-600 mb-0.5">สรุปภาพรวมวันนี้</span>
              <textarea rows={2} value={form.summary} onChange={(e) => set('summary', e.target.value)} className={field} />
            </label>
          </div>,
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-red-600 font-medium">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={() => onDone(reportId)} className="px-4 py-2 rounded-lg border border-slate-200">
          ยกเลิก
        </button>
        <button type="submit" disabled={isPending} className="px-5 py-2 rounded-lg bg-[#2453d4] text-white font-semibold disabled:opacity-60">
          {isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
        </button>
      </div>
    </form>
  );
}

function ReportView({
  projectId,
  projectName,
  reportId,
  tasks,
  onBack,
  onEdit,
}: {
  projectId: string;
  projectName: string;
  reportId: string;
  tasks: { id: string; wbs: string; title: string }[];
  onBack: () => void;
  onEdit: () => void;
}) {
  const { data, error, reload } = useSiteLoader(() => loadDailyReportAction(reportId), [reportId]);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <p className="p-8 text-center text-xs text-slate-400">กำลังโหลดรายงาน...</p>;
  const taskName = (id: string | null) => {
    const t = tasks.find((x) => x.id === id);
    return t ? `${t.wbs} ${t.title}` : '';
  };

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" /> รายงานทั้งหมด
        </button>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
            <Printer className="w-3.5 h-3.5" /> พิมพ์ / PDF
          </button>
          {data.canEdit && (
            <>
              <button type="button" disabled={uploading} onClick={() => photoRef.current?.click()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-50">
                <Camera className="w-3.5 h-3.5" /> {uploading ? 'กำลังอัปโหลด...' : 'แนบรูป'}
              </button>
              <input ref={photoRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" aria-label="แนบรูปหน้างาน" onChange={(e) => { void uploadPhotos(e.target.files); e.target.value = ''; }} />
              <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
                <FileText className="w-3.5 h-3.5" /> แก้ไข
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  confirm('ส่งรายงาน? ส่งแล้วแก้ไขไม่ได้ และความคืบหน้างานจะอัปเดตไปที่ Gantt') &&
                  startTransition(async () => {
                    const r = await submitDailyReportAction(projectId, reportId);
                    if (!r.ok) setActionError(r.error);
                    await reload();
                  })
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2453d4] text-white font-semibold disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" /> ส่งรายงาน
              </button>
            </>
          )}
        </div>
      </div>
      {actionError && <p className="text-xs text-red-600">{actionError}</p>}

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs text-xs space-y-4">
        <div className="flex items-start justify-between border-b-2 border-[#173a7a] pb-3">
          <div>
            <div className="text-base font-bold text-[#173a7a]">Daily Construction Report</div>
            <div className="text-slate-600">รายงานประจำวัน · {projectName}</div>
          </div>
          <div className="text-right">
            <div className="font-mono font-bold">{data.number}</div>
            <div>{dateText(data.reportDate)}</div>
            <div className={data.status === 'SUBMITTED' ? 'text-emerald-700' : 'text-slate-500'}>{data.status === 'SUBMITTED' ? 'ส่งแล้ว' : 'ร่าง'}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>ผู้เขียนรายงาน: <b>{data.createdByName}</b></div>
          <div>เวลาทำงาน: <b>{data.startTime ?? '-'} – {data.endTime ?? '-'}</b></div>
          <div>อากาศ: <b>{WEATHER[data.weatherMorning]} / {WEATHER[data.weatherAfternoon]}</b></div>
          <div>กระทบแผนงาน: <b>{data.scheduleImpact ? 'กระทบ' : 'ไม่กระทบ'}</b></div>
        </div>
        <table className="w-full border border-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-2 py-1.5 text-left">งาน</th>
              <th className="px-2 py-1.5 text-left">รายละเอียด</th>
              <th className="px-2 py-1.5 text-right">ปริมาณงานสะสม (%)</th>
              <th className="px-2 py-1.5 text-left">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.work.length === 0 ? (
              <tr><td colSpan={4} className="px-2 py-2 text-slate-400">-</td></tr>
            ) : (
              data.work.map((w, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">{taskName(w.taskId) || '-'}</td>
                  <td className="px-2 py-1.5">{w.description}</td>
                  <td className="px-2 py-1.5 text-right">{w.progressPercent ?? '-'}</td>
                  <td className="px-2 py-1.5">{w.note}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="font-semibold mb-1">คนงาน ({data.labour.reduce((s, l) => s + l.workers, 0)} คน)</div>
            {data.labour.length === 0 ? '-' : data.labour.map((l, i) => <div key={i}>{l.company || '-'} · {l.workers} คน · {l.hours} ชม.</div>)}
          </div>
          <div>
            <div className="font-semibold mb-1">เครื่องจักร</div>
            {data.equipment.length === 0 ? '-' : data.equipment.map((q, i) => <div key={i}>{q.type} · {q.hours} ชม.</div>)}
          </div>
          <div>
            <div className="font-semibold mb-1">ความปลอดภัย</div>
            <div className={data.accident ? 'text-red-600 font-semibold' : ''}>{data.accident ? 'มีอุบัติเหตุ' : 'ไม่มีอุบัติเหตุ'}</div>
            {data.safetyNote && <div>{data.safetyNote}</div>}
          </div>
          <div>
            <div className="font-semibold mb-1">ผู้เยี่ยมชม</div>
            <div>{data.visitors || 'ไม่มี'}</div>
          </div>
          <div>
            <div className="font-semibold mb-1">ปัญหา / อุปสรรค</div>
            <div className="whitespace-pre-wrap">{data.issues || '-'}</div>
          </div>
          <div>
            <div className="font-semibold mb-1">สรุปภาพรวม</div>
            <div className="whitespace-pre-wrap">{data.summary || '-'}</div>
          </div>
        </div>
        {data.photos.length > 0 && (
          <div>
            <div className="font-semibold mb-2">รูปถ่ายหน้างาน</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {data.photos.map((p) => (
                <div key={p.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.name} className="w-full aspect-[4/3] object-cover rounded border border-slate-200" />
                  {data.canEdit && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('ลบรูปนี้?')) return;
                        const r = await deleteFileAction(p.id);
                        if (!r.ok) setActionError(r.error);
                        await reload();
                      }}
                      className="absolute top-1 right-1 p-1 rounded bg-white/90 text-slate-500 hover:text-red-600 opacity-0 group-hover:opacity-100 print:hidden"
                      title="ลบรูป"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
