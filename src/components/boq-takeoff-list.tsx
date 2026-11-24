'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus, Ruler, Search, Trash2, X } from 'lucide-react';
import type { TakeoffSummaryDto } from '@/server/services/boq-takeoff';
import { createTakeoffAction, deleteTakeoffAction } from '@/app/(app)/boq-takeoff/actions';
import { SearchSelect } from '@/components/search-select';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export function BoqTakeoffList({ takeoffs, projects }: { takeoffs: TakeoffSummaryDto[]; projects: { id: string; label: string }[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return takeoffs;
    return takeoffs.filter((t) => [t.number, t.name, t.projectLabel, t.fileName].some((v) => v.toLowerCase().includes(q)));
  }, [query, takeoffs]);

  const create = () => {
    setError(null);
    startTransition(async () => {
      const res = await createTakeoffAction({ name, projectId: projectId || null });
      if (!res.ok) return setError(res.error);
      router.push(`/boq-takeoff/${res.id}`);
    });
  };

  const remove = (t: TakeoffSummaryDto) => {
    if (!window.confirm(`ลบงานถอดแบบ ${t.number} "${t.name}" ใช่หรือไม่? การวัดทั้งหมดจะหายไป (BOQ ที่ส่งไปแล้วไม่ถูกลบ)`)) return;
    startTransition(async () => {
      const res = await deleteTakeoffAction(t.id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 text-sm text-slate-800 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Ruler className="h-5 w-5 text-brand" /> ถอดแบบ BOQ จาก PDF
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">เปิดแบบ CAD ที่สั่งพิมพ์เป็น PDF แล้ววัดระยะ พื้นที่ และนับจำนวนบนแบบ ระบบรวมปริมาณเป็นรายการ BOQ ให้</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
        >
          <Plus className="h-4 w-4" /> ถอดแบบใหม่
        </button>
      </div>

      {creating && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">เริ่มงานถอดแบบใหม่</h2>
            <button type="button" onClick={() => setCreating(false)} className="text-slate-400 hover:text-slate-600" title="ปิด">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs">
              <span className="font-semibold text-slate-700">ชื่องานถอดแบบ *</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น อาคาร A ชั้น 1 งานสถาปัตย์"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="font-semibold text-slate-700">โครงการ (ไม่บังคับ)</span>
              <SearchSelect value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">ยังไม่ระบุโครงการ</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </SearchSelect>
            </label>
          </div>
          {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={pending || !name.trim()}
              onClick={create}
              className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {pending ? 'กำลังสร้าง...' : 'สร้างแล้วเลือกไฟล์ PDF'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาเลขที่ ชื่องาน โครงการ หรือชื่อไฟล์" className="w-full bg-transparent text-sm outline-none" />
        </div>
        {!creating && error && <p className="px-4 pt-2 text-xs font-semibold text-red-600">{error}</p>}
        {shown.length === 0 ? (
          <div className="px-4 py-12 text-center text-xs text-slate-500">
            {takeoffs.length === 0 ? 'ยังไม่มีงานถอดแบบ กด "ถอดแบบใหม่" เพื่อเริ่ม' : 'ไม่พบงานถอดแบบที่ค้นหา'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">เลขที่</th>
                  <th className="px-4 py-2 text-left font-medium">ชื่องาน</th>
                  <th className="px-4 py-2 text-left font-medium">โครงการ</th>
                  <th className="px-4 py-2 text-left font-medium">ไฟล์แบบ</th>
                  <th className="px-4 py-2 text-right font-medium">รายการ</th>
                  <th className="px-4 py-2 text-left font-medium">ส่งเข้า BOQ</th>
                  <th className="px-4 py-2 text-left font-medium">แก้ไขล่าสุด</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono">
                      <Link href={`/boq-takeoff/${t.id}`} className="font-semibold text-brand hover:underline">
                        {t.number}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/boq-takeoff/${t.id}`} className="text-slate-900 hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{t.projectLabel || '-'}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {t.fileName ? (
                        <span className="flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-red-500" />
                          <span className="max-w-[14rem] truncate">{t.fileName}</span>
                          <span className="text-slate-400">({t.pageCount} หน้า)</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">ยังไม่เลือกไฟล์</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{t.itemCount.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      {t.sentAt ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{t.sentBoqNumber}</span> : <span className="text-slate-400">ยังไม่ส่ง</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {dateTime(t.updatedAt)} · {t.updatedByName}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {t.canDelete && (
                        <button type="button" onClick={() => remove(t)} disabled={pending} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="ลบ">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
