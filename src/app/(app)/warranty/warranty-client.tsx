'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, ShieldCheck, Wrench } from 'lucide-react';
import {
  DEFECT_STATUSES,
  DEFECT_STATUS_LABELS,
  WARRANTY_STATE_LABELS,
  type DefectStatus,
  type WarrantyState,
} from '@/domain/handover';
import type { DefectRow, WarrantyRow } from '@/server/services/handover';
import { createDefectAction, loadDefectsAction, updateDefectAction } from '../handover/actions';

const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-blue-600 focus:outline-none';
const thaiDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
};
const monthsText = (n: number) => (n % 12 === 0 && n > 0 ? `${n / 12} ปี` : `${n} เดือน`);
const STATE_BADGE: Record<WarrantyState, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  STRUCTURAL_ONLY: 'bg-amber-50 text-amber-700',
  EXPIRED: 'bg-slate-100 text-slate-500',
};
const DEFECT_BADGE: Record<DefectStatus, string> = {
  OPEN: 'bg-rose-50 text-rose-700',
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  FIXED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-slate-100 text-slate-500',
};

function DefectsPanel({ warranty, today }: { warranty: WarrantyRow; today: string }) {
  const router = useRouter();
  const [defects, setDefects] = useState<DefectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ title: '', location: '', reportedBy: '', reportedDate: today });

  const reload = useCallback(async () => {
    const r = await loadDefectsAction(warranty.projectId);
    if (r.ok) setDefects(r.value);
    else setError(r.error);
  }, [warranty.projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createDefectAction(warranty.projectId, form);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setForm({ title: '', location: '', reportedBy: '', reportedDate: today });
      await reload();
      router.refresh();
    });
  };

  const setStatus = (d: DefectRow, status: DefectStatus) => {
    let resolution = d.resolution;
    if (status === 'FIXED' || status === 'REJECTED') {
      const answer = prompt(status === 'FIXED' ? 'วิธีแก้ไข / รายละเอียดการซ่อม' : 'เหตุผลที่ไม่อยู่ในเงื่อนไขประกัน', resolution);
      if (answer === null) return;
      resolution = answer;
    }
    setError(null);
    startTransition(async () => {
      const r = await updateDefectAction(d.id, { status, resolution, fixedDate: status === 'FIXED' ? today : null });
      if (!r.ok) setError(r.error);
      await reload();
      router.refresh();
    });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <Wrench className="w-4 h-4 text-slate-500" />
        <h2 className="font-semibold text-sm text-slate-800">
          รายการแจ้งซ่อม · {warranty.code} {warranty.name}
        </h2>
      </div>

      {warranty.canRecordDefects && warranty.state !== 'EXPIRED' && (
        <form onSubmit={add} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-2 border-b border-slate-100 bg-slate-50/60">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="อาการ / รายการที่แจ้งซ่อม *" className={`${field} md:col-span-4`} />
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="ตำแหน่ง เช่น ห้องน้ำชั้น 2" className={`${field} md:col-span-3`} />
          <input value={form.reportedBy} onChange={(e) => setForm({ ...form, reportedBy: e.target.value })} placeholder="ผู้แจ้ง" className={`${field} md:col-span-2`} />
          <input type="date" required value={form.reportedDate} min={warranty.startDate} max={today} onChange={(e) => setForm({ ...form, reportedDate: e.target.value })} className={`${field} md:col-span-2`} />
          <button type="submit" disabled={isPending} className="md:col-span-1 inline-flex items-center justify-center gap-1 rounded-lg bg-[#2453d4] text-white text-sm font-semibold disabled:opacity-50">
            <Plus className="w-4 h-4" /> แจ้ง
          </button>
        </form>
      )}
      {error && <p className="px-5 pt-3 text-sm text-rose-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-4">เลขที่</th>
              <th className="py-2.5 px-4">รายการ</th>
              <th className="py-2.5 px-4">ตำแหน่ง</th>
              <th className="py-2.5 px-4">วันที่แจ้ง</th>
              <th className="py-2.5 px-4">สถานะ</th>
              <th className="py-2.5 px-4">การแก้ไข</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {defects === null && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">กำลังโหลด…</td>
              </tr>
            )}
            {defects?.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">ยังไม่มีการแจ้งซ่อม</td>
              </tr>
            )}
            {defects?.map((d) => (
              <tr key={d.id}>
                <td className="py-2.5 px-4 font-mono text-slate-700">{d.number}</td>
                <td className="py-2.5 px-4 text-slate-800">
                  {d.title}
                  {d.reportedBy && <div className="text-[10px] text-slate-400">แจ้งโดย {d.reportedBy}</div>}
                </td>
                <td className="py-2.5 px-4 text-slate-600">{d.location || '-'}</td>
                <td className="py-2.5 px-4 font-mono text-slate-600">{thaiDate(d.reportedDate)}</td>
                <td className="py-2.5 px-4">
                  {warranty.canRecordDefects ? (
                    <select
                      value={d.status}
                      disabled={isPending}
                      onChange={(e) => setStatus(d, e.target.value as DefectStatus)}
                      className={`rounded px-2 py-1 text-[11px] font-medium border-0 ${DEFECT_BADGE[d.status]}`}
                    >
                      {DEFECT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {DEFECT_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${DEFECT_BADGE[d.status]}`}>{DEFECT_STATUS_LABELS[d.status]}</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-slate-600">
                  {d.resolution || '-'}
                  {d.fixedDate && <div className="text-[10px] text-slate-400">เสร็จ {thaiDate(d.fixedDate)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WarrantyClient({ rows, today }: { rows: WarrantyRow[]; today: string }) {
  const [selected, setSelected] = useState<string | null>(rows[0]?.projectId ?? null);
  const current = rows.find((r) => r.projectId === selected) ?? null;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">WARRANTY & DEFECTS</div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">ใบรับประกันผลงาน</h1>
          <p className="text-xs text-slate-500 mt-0.5">ระยะรับประกันเริ่มเมื่อลูกค้าตรวจรับงาน · บันทึกและติดตามการแจ้งซ่อม (Defect)</p>
        </div>
        <Link href="/handover" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white text-xs font-medium">
          <ShieldCheck className="w-4 h-4" /> ออกใบรับประกันจากการส่งมอบ
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#102d72] text-white">
                <th className="py-3 px-4 font-medium">โครงการ</th>
                <th className="py-3 px-4 font-medium">เลขที่ใบรับประกัน</th>
                <th className="py-3 px-4 font-medium">ระยะเวลารับประกัน</th>
                <th className="py-3 px-4 font-medium">วันสิ้นสุดรับประกัน</th>
                <th className="py-3 px-4 font-medium">สถานะ</th>
                <th className="py-3 px-4 font-medium text-center">แจ้งซ่อม (Defect)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-400 text-sm">
                    ยังไม่มีใบรับประกัน — จะออกให้อัตโนมัติเมื่อบันทึกว่าลูกค้าตรวจรับงานในหน้า{' '}
                    <Link href="/handover" className="text-[#2453d4] underline">
                      ส่งมอบโครงการ
                    </Link>
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.projectId}
                  onClick={() => setSelected(r.projectId)}
                  className={`cursor-pointer ${selected === r.projectId ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}
                >
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-800">{r.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {r.code} · {r.customer}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">{r.warrantyNumber}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {monthsText(r.warrantyMonths)} (โครงสร้าง {monthsText(r.structuralWarrantyMonths)})
                    <div className="text-[10px] text-slate-400">เริ่ม {thaiDate(r.startDate)}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-600 font-mono">
                    {thaiDate(r.endDate)}
                    <div className="text-[10px] text-slate-400">โครงสร้าง {thaiDate(r.structuralEndDate)}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATE_BADGE[r.state]}`}>{WARRANTY_STATE_LABELS[r.state]}</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={r.openDefects > 0 ? 'text-rose-600 font-semibold' : 'text-slate-400'}>
                      ค้าง {r.openDefects} / ทั้งหมด {r.totalDefects}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {current && <DefectsPanel key={current.projectId} warranty={current} today={today} />}
    </div>
  );
}
