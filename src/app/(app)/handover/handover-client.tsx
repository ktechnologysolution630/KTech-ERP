'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ClipboardCheck, Search, X } from 'lucide-react';
import { HANDOVER_STATUSES, HANDOVER_STATUS_LABELS, type HandoverStatus } from '@/domain/handover';
import { PROJECT_STATUS_LABELS } from '@/domain/project';
import type { HandoverRow } from '@/server/services/handover';
import { saveHandoverAction } from './actions';

const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-blue-600 focus:outline-none';
const thaiDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
};
const BADGE: Record<HandoverStatus | 'NONE', string> = {
  NONE: 'bg-slate-100 text-slate-600',
  SCHEDULED: 'bg-blue-50 text-blue-700',
  HANDED_OVER: 'bg-amber-50 text-amber-700',
  ACCEPTED: 'bg-emerald-50 text-emerald-700',
};

function HandoverDialog({ row, today, onClose }: { row: HandoverRow; today: string; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const h = row.handover;
  const locked = h?.status === 'ACCEPTED';
  const [status, setStatus] = useState<HandoverStatus>(h?.status ?? 'SCHEDULED');
  const [handoverDate, setHandoverDate] = useState(h?.handoverDate ?? today);
  const [receivedBy, setReceivedBy] = useState(h?.receivedBy ?? '');
  const [note, setNote] = useState(h?.note ?? '');
  const [warrantyMonths, setWarrantyMonths] = useState(h?.warrantyMonths ?? 12);
  const [structuralMonths, setStructuralMonths] = useState(h?.structuralWarrantyMonths ?? 60);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'ACCEPTED' && !locked && !confirm('ยืนยันว่าลูกค้าตรวจรับแล้ว? ระบบจะออกเลขใบรับประกันและปิดโครงการ (แก้วันที่/ผู้ตรวจรับภายหลังไม่ได้)')) return;
    setError(null);
    startTransition(async () => {
      const r = await saveHandoverAction(row.projectId, {
        status,
        handoverDate,
        receivedBy,
        note,
        warrantyMonths: Number(warrantyMonths),
        structuralWarrantyMonths: Number(structuralMonths),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-900">บันทึกการส่งมอบ</h2>
            <p className="text-xs text-slate-500">
              {row.code} · {row.name}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="ปิด">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4 text-sm">
          {locked && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-3">
              ลูกค้าตรวจรับแล้ว (ใบรับประกัน {h?.warrantyNumber}) — แก้ไขได้เฉพาะหมายเหตุและระยะประกัน
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">สถานะ</span>
            <select value={status} disabled={locked} onChange={(e) => setStatus(e.target.value as HandoverStatus)} className={field}>
              {HANDOVER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {HANDOVER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">{status === 'SCHEDULED' ? 'วันนัดส่งมอบ' : 'วันที่ส่งมอบ'}</span>
              <input type="date" required disabled={locked} value={handoverDate} onChange={(e) => setHandoverDate(e.target.value)} className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">ผู้ตรวจรับ (ลูกค้า){status === 'ACCEPTED' ? ' *' : ''}</span>
              <input
                value={receivedBy}
                disabled={locked}
                required={status === 'ACCEPTED'}
                onChange={(e) => setReceivedBy(e.target.value)}
                placeholder="ชื่อ-ตำแหน่ง"
                className={field}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">ประกันผลงานทั่วไป (เดือน)</span>
              <input type="number" min={0} max={120} required value={warrantyMonths} onChange={(e) => setWarrantyMonths(Number(e.target.value))} className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">ประกันโครงสร้าง (เดือน)</span>
              <input type="number" min={0} max={240} required value={structuralMonths} onChange={(e) => setStructuralMonths(Number(e.target.value))} className={field} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">หมายเหตุ / รายการเอกสารส่งมอบ</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={field} placeholder="เช่น แบบ As-built, คู่มือการใช้งาน, กุญแจ 12 ดอก" />
          </label>
          <p className="text-[11px] text-slate-400">
            แนบไฟล์เอกสารส่งมอบได้ที่แท็บ &quot;เอกสารโครงการ&quot; หมวด &quot;เอกสารส่งมอบและปิดโครงการ&quot; ของโครงการ
          </p>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="submit" disabled={isPending} className="px-5 py-2 rounded-lg bg-[#2453d4] text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {isPending ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function HandoverClient({ rows, today }: { rows: HandoverRow[]; today: string }) {
  const [editing, setEditing] = useState<HandoverRow | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'ACCEPTED'>('ALL');

  const shown = rows.filter((r) => {
    if (filter === 'PENDING' && r.handover?.status === 'ACCEPTED') return false;
    if (filter === 'ACCEPTED' && r.handover?.status !== 'ACCEPTED') return false;
    const q = query.trim().toLowerCase();
    return !q || `${r.code} ${r.name} ${r.customer}`.toLowerCase().includes(q);
  });

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">AFTER SERVICE & HANDOVER</div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">ส่งมอบโครงการ</h1>
        <p className="text-xs text-slate-500 mt-0.5">นัดส่งมอบ บันทึกการตรวจรับของลูกค้า และเริ่มระยะรับประกันผลงาน</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาโครงการหรือลูกค้า" className={`${field} pl-9`} />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={`${field} w-auto`}>
          <option value="ALL">ทุกโครงการ</option>
          <option value="PENDING">ยังไม่ตรวจรับ</option>
          <option value="ACCEPTED">ตรวจรับแล้ว</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#102d72] text-white">
                <th className="py-3 px-4 font-medium">โครงการ</th>
                <th className="py-3 px-4 font-medium">ผู้ว่าจ้าง / ลูกค้า</th>
                <th className="py-3 px-4 font-medium">วันที่ส่งมอบ</th>
                <th className="py-3 px-4 font-medium">สถานะการตรวจรับ</th>
                <th className="py-3 px-4 font-medium">ผู้ตรวจรับ</th>
                <th className="py-3 px-4 font-medium text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-400 text-sm">
                    ไม่มีโครงการตามเงื่อนไข
                  </td>
                </tr>
              )}
              {shown.map((r) => {
                const s = r.handover?.status ?? 'NONE';
                return (
                  <tr key={r.projectId} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <Link href={`/projects/${r.projectId}`} className="font-semibold text-slate-800 hover:text-[#2453d4] hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {r.code} · {PROJECT_STATUS_LABELS[r.projectStatus]}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{r.customer}</td>
                    <td className="py-3 px-4 text-slate-600 font-mono">{r.handover ? thaiDate(r.handover.handoverDate) : '-'}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${BADGE[s]}`}>
                        {s === 'ACCEPTED' && <CheckCircle2 className="w-3 h-3" />}
                        {s === 'NONE' ? 'ยังไม่นัดส่งมอบ' : HANDOVER_STATUS_LABELS[s]}
                      </span>
                      {r.handover?.warrantyNumber && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{r.handover.warrantyNumber}</div>}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{r.handover?.receivedBy || '-'}</td>
                    <td className="py-3 px-4 text-right">
                      {r.canManage ? (
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className="inline-flex items-center gap-1 text-[#2453d4] hover:underline font-medium"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" />
                          {r.handover ? 'แก้ไข' : 'บันทึกการส่งมอบ'}
                        </button>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <HandoverDialog row={editing} today={today} onClose={() => setEditing(null)} />}
    </div>
  );
}
