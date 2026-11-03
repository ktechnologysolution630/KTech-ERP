'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { ADVANCE_STATUSES, ADVANCE_STATUS_LABELS, type AdvanceStatus } from '@/domain/advance';
import type { AdvanceList } from '@/server/services/advances';
import { requestAdvanceAction } from './actions';

type Tab = 'all' | 'clearing' | 'outstanding';

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]';

export function AdvancesClient({
  data,
  currentUserId,
  projects,
}: {
  data: AdvanceList;
  currentUserId: string;
  projects: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>('all');
  const [status, setStatus] = useState<AdvanceStatus | 'ALL'>('ALL');
  const [payee, setPayee] = useState('ALL');
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [form, setForm] = useState<{ purpose: string; amount: number; projectId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payees = [...new Map(data.rows.map((r) => [r.payeeId, r.payeeName])).entries()];
  const rows = data.rows.filter((r) => {
    if (tab === 'clearing' && r.status !== 'PAID' && r.status !== 'PARTIALLY_CLEARED') return false;
    if (tab === 'outstanding' && r.outstanding <= 0) return false;
    if (status !== 'ALL' && r.status !== status) return false;
    if (payee !== 'ALL' && r.payeeId !== payee) return false;
    if (projectFilter !== 'ALL' && (r.projectId ?? 'OFFICE') !== projectFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">เงินทดรองจ่าย</h1>
          <p className="text-xs text-slate-500">ขอเงินทดรอง → อนุมัติ → จ่ายเงิน → เคลียร์ด้วยใบเสร็จหรือใบรับรองแทนใบเสร็จ</p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ purpose: '', amount: 0, projectId: '' })}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700"
        >
          <Plus className="w-3.5 h-3.5" /> ใบขอเงินทดรองจ่าย
        </button>
      </div>

      <nav className="flex gap-2 border-b border-slate-200 pb-2 text-xs">
        {(
          [
            ['all', 'ใบขอเงินทดรอง'],
            ['clearing', 'เคลียร์เงินทดรอง'],
            ['outstanding', 'เงินทดรองคงค้าง'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg ${tab === k ? 'bg-blue-50 text-[#2453d4] font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap gap-2 text-xs">
        <select aria-label="ผู้รับเงิน" value={payee} onChange={(e) => setPayee(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg">
          <option value="ALL">ผู้รับเงิน: ทุกคน</option>
          {payees.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="โครงการ" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg">
          <option value="ALL">โครงการ: ทุกโครงการ</option>
          <option value="OFFICE">สำนักงาน</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select aria-label="สถานะ" value={status} onChange={(e) => setStatus(e.target.value as AdvanceStatus | 'ALL')} className="px-2 py-1.5 border border-slate-200 rounded-lg">
          <option value="ALL">ทุกสถานะ</option>
          {ADVANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ADVANCE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        {[
          ['เงินทดรองที่จ่าย', data.totals.paid],
          ['ใช้จริง', data.totals.spent],
          ['คงเหลือสุทธิ', data.totals.outstanding],
        ].map(([k, v]) => (
          <div key={k as string} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-slate-500">{k}</div>
            <div className="font-mono font-bold text-base">{baht(v as number)} บาท</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
        <table className="w-full text-xs min-w-[900px]">
          <thead className="bg-[#102d72] text-white">
            <tr>
              <th className="px-3 py-2 text-left">เลขที่ / วันที่ขอ</th>
              <th className="px-3 py-2 text-left">ผู้รับเงิน</th>
              <th className="px-3 py-2 text-left">โครงการ</th>
              <th className="px-3 py-2 text-left">วัตถุประสงค์</th>
              <th className="px-3 py-2 text-right">จำนวนเงิน</th>
              <th className="px-3 py-2 text-right">ใช้จริง</th>
              <th className="px-3 py-2 text-right">คงค้าง</th>
              <th className="px-3 py-2 text-left">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">ไม่พบรายการเงินทดรองจ่าย</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/advances/${r.id}`} className="font-mono text-[#2453d4] hover:underline">
                    {r.number}
                  </Link>
                  <div className="text-slate-400">{r.requestDate}</div>
                </td>
                <td className="px-3 py-2">
                  {r.payeeName}
                  {r.payeeId === currentUserId && <span className="text-slate-400"> (ฉัน)</span>}
                </td>
                <td className="px-3 py-2">{r.projectName ?? 'สำนักงาน'}</td>
                <td className="px-3 py-2">{r.purpose}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.amount)}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.spent)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{baht(r.outstanding)}</td>
                <td className="px-3 py-2">{ADVANCE_STATUS_LABELS[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const r = await requestAdvanceAction({ purpose: form.purpose, amount: form.amount, projectId: form.projectId || null });
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                setForm(null);
                router.push(`/advances/${r.value}`);
              });
            }}
            className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h2 className="font-bold text-sm">ใบขอเงินทดรองจ่าย</h2>
              <button type="button" onClick={() => setForm(null)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <fieldset disabled={isPending} className="space-y-3">
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">โครงการ</span>
                <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className={inputClass}>
                  <option value="">สำนักงาน / ไม่ระบุโครงการ</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">วัตถุประสงค์ *</span>
                <input required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className={inputClass} />
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">จำนวนเงิน (บาท) *</span>
                <input type="number" min={0.01} step="0.01" required value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) || 0 })} className={`${inputClass} font-mono`} />
              </label>
            </fieldset>
            {error && <p role="alert" className="text-red-600 font-medium">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="px-3 py-1.5 border border-slate-200 rounded-lg">ยกเลิก</button>
              <button type="submit" disabled={isPending} className="px-4 py-1.5 bg-[#2453d4] text-white rounded-lg font-semibold disabled:opacity-60">
                {isPending ? 'กำลังส่ง...' : 'ส่งขออนุมัติ'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
