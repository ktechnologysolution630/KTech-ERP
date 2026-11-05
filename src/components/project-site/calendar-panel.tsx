'use client';

import React, { useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { createEventAction, deleteEventAction, loadCalendarAction } from '@/app/(app)/projects/[id]/site-actions';
import { useSiteLoader } from './use-site-loader';
import { DateInput } from '@/components/date-input';

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const KIND_STYLE = {
  EVENT: 'bg-blue-600 text-white',
  TASK_START: 'bg-emerald-100 text-emerald-800',
  TASK_DUE: 'bg-amber-100 text-amber-800',
} as const;

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Month view of appointments plus task start/due dates. */
export function CalendarPanel({ projectId, today }: { projectId: string; today: string }) {
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const daysInMonth = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(ym.y, ym.m, 1)).getUTCDay();
  const from = iso(ym.y, ym.m, 1);
  const to = iso(ym.y, ym.m, daysInMonth);
  const { data, error, reload } = useSiteLoader(() => loadCalendarAction(projectId, from, to), [projectId, from, to]);
  const [newOn, setNewOn] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(today);

  const shift = (delta: number) =>
    setYm(({ y, m }) => {
      const d = new Date(Date.UTC(y, m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  const byDate = new Map<string, NonNullable<typeof data>>();
  for (const item of data ?? []) {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const selectedItems = byDate.get(selected) ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => shift(-1)} className="p-1.5 rounded hover:bg-slate-100" title="เดือนก่อนหน้า">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h3 className="font-bold text-sm text-slate-900 w-36 text-center">
              {TH_MONTHS[ym.m]} {ym.y + 543}
            </h3>
            <button type="button" onClick={() => shift(1)} className="p-1.5 rounded hover:bg-slate-100" title="เดือนถัดไป">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
                setSelected(today);
              }}
              className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs hover:bg-slate-50"
            >
              วันนี้
            </button>
          </div>
          <button type="button" onClick={() => setNewOn(selected)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-semibold">
            <Plus className="w-3.5 h-3.5" /> เพิ่มนัดหมาย
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500 mb-1">
          {WEEKDAYS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day === null) return <div key={`b${i}`} />;
            const date = iso(ym.y, ym.m, day);
            const items = byDate.get(date) ?? [];
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelected(date)}
                onDoubleClick={() => setNewOn(date)}
                className={`min-h-[84px] rounded-lg border p-1 text-left align-top transition ${
                  selected === date ? 'border-[#2453d4] ring-1 ring-[#2453d4]' : 'border-slate-100 hover:border-slate-300'
                } ${date === today ? 'bg-blue-50/50' : 'bg-white'}`}
              >
                <div className={`text-[11px] font-semibold ${date === today ? 'text-[#2453d4]' : 'text-slate-600'}`}>{day}</div>
                <div className="space-y-0.5 mt-0.5">
                  {items.slice(0, 3).map((it) => (
                    <div key={it.id} className={`truncate rounded px-1 text-[10px] ${KIND_STYLE[it.kind]}`}>
                      {it.startTime ? `${it.startTime} ` : ''}
                      {it.title}
                    </div>
                  ))}
                  {items.length > 3 && <div className="text-[10px] text-slate-400">+{items.length - 3} รายการ</div>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-600" /> นัดหมาย</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-200" /> เริ่มงาน</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-200" /> กำหนดส่งงาน</span>
          <span>· ดับเบิลคลิกวันที่เพื่อเพิ่มนัดหมาย</span>
        </div>
      </div>

      <DayList date={selected} items={selectedItems} onChanged={reload} />
      {newOn && <EventDialog projectId={projectId} date={newOn} onClose={() => setNewOn(null)} onSaved={reload} />}
    </div>
  );
}

function DayList({
  date,
  items,
  onChanged,
}: {
  date: string;
  items: { id: string; kind: keyof typeof KIND_STYLE; title: string; startTime: string | null; endTime: string | null; note: string; canDelete: boolean }[];
  onChanged: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
      <h3 className="font-bold text-sm text-slate-900">
        {new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">ไม่มีนัดหมายหรืองานในวันนี้</p>
      ) : (
        items.map((it) => (
          <div key={it.id} className="rounded-lg border border-slate-100 p-2.5 text-xs flex items-start justify-between gap-2">
            <div>
              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] mb-1 ${KIND_STYLE[it.kind]}`}>
                {it.kind === 'EVENT' ? (it.startTime ? `${it.startTime}${it.endTime ? `–${it.endTime}` : ''}` : 'ทั้งวัน') : it.kind === 'TASK_START' ? 'เริ่มงาน' : 'กำหนดส่ง'}
              </span>
              <div className="font-medium text-slate-900">{it.title}</div>
              {it.note && <div className="text-slate-500 mt-0.5">{it.note}</div>}
            </div>
            {it.canDelete && (
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  confirm('ลบนัดหมายนี้?') &&
                  startTransition(async () => {
                    const r = await deleteEventAction(it.id);
                    if (!r.ok) setError(r.error);
                    await onChanged();
                  })
                }
                className="p-1 rounded text-slate-400 hover:text-red-600"
                title="ลบนัดหมาย"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function EventDialog({ projectId, date, onClose, onSaved }: { projectId: string; date: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', eventDate: date, allDay: true, startTime: '09:00', endTime: '10:00', note: '' });
  const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#2453d4] focus:outline-none';
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-label="เพิ่มนัดหมาย" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = await createEventAction(projectId, {
              title: form.title,
              eventDate: form.eventDate,
              startTime: form.allDay ? null : form.startTime,
              endTime: form.allDay ? null : form.endTime,
              note: form.note,
            });
            if (!r.ok) {
              setError(r.error);
              return;
            }
            await onSaved();
            onClose();
          });
        }}
        className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-3 text-xs"
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <h3 className="font-bold text-sm">เพิ่มนัดหมาย</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>
        <fieldset disabled={isPending} className="space-y-3">
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">หัวข้อ *</span>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="เช่น ตรวจรับเหล็กเสริมชั้น 2" className={field} />
          </label>
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">วันที่ *</span>
            <DateInput required value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} className={field} />
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} /> ทั้งวัน
          </label>
          {!form.allDay && (
            <div className="grid grid-cols-2 gap-3">
              <input type="time" aria-label="เวลาเริ่ม" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={field} />
              <input type="time" aria-label="เวลาสิ้นสุด" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={field} />
            </div>
          )}
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">รายละเอียด</span>
            <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={field} />
          </label>
        </fieldset>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border border-slate-200 rounded-lg">
            ยกเลิก
          </button>
          <button type="submit" disabled={isPending} className="px-4 py-1.5 bg-[#2453d4] text-white rounded-lg font-semibold disabled:opacity-60">
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  );
}
