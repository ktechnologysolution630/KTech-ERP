'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, X } from 'lucide-react';
import { saveCustomerAction } from '../actions';

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  taxId: string;
  branch: string;
  address: string;
  contactName: string;
  phone: string;
  email: string;
  creditDays: number;
  active: boolean;
}

const EMPTY: Omit<CustomerRow, 'id'> & { id?: string } = {
  code: '',
  name: '',
  taxId: '',
  branch: '00000',
  address: '',
  contactName: '',
  phone: '',
  email: '',
  creditDays: 30,
  active: true,
};

const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]';

export function CustomersClient({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<(Omit<CustomerRow, 'id'> & { id?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const set = <K extends keyof CustomerRow>(k: K, v: CustomerRow[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const shown = customers.filter(
    (c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.code.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ลูกค้า</h1>
          <p className="text-xs text-slate-500">ข้อมูลลูกค้าสำหรับใบแจ้งหนี้ ใบเสร็จรับเงิน/ใบกำกับภาษี และใบลดหนี้</p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหารหัส / ชื่อลูกค้า"
            aria-label="ค้นหาลูกค้า"
            className="px-3 py-2 border border-slate-200 rounded-lg text-xs"
          />
          <button
            type="button"
            onClick={() => setForm({ ...EMPTY })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700"
          >
            <Plus className="w-3.5 h-3.5" /> เพิ่มลูกค้า
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
        <table className="w-full text-xs min-w-[800px]">
          <thead className="bg-[#102d72] text-white">
            <tr>
              <th className="px-3 py-2 text-left">รหัส</th>
              <th className="px-3 py-2 text-left">ลูกค้า</th>
              <th className="px-3 py-2 text-left">เลขประจำตัวผู้เสียภาษี</th>
              <th className="px-3 py-2 text-left">สาขา</th>
              <th className="px-3 py-2 text-left">ผู้ติดต่อ</th>
              <th className="px-3 py-2 text-left">โทรศัพท์</th>
              <th className="px-3 py-2 text-right">เครดิต</th>
              <th className="px-3 py-2 text-left">สถานะ</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">ยังไม่มีลูกค้า</td>
              </tr>
            )}
            {shown.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-mono">{c.code}</td>
                <td className="px-3 py-2 font-medium">{c.name}</td>
                <td className="px-3 py-2 font-mono">{c.taxId || '-'}</td>
                <td className="px-3 py-2 font-mono">{c.branch === '00000' ? 'สำนักงานใหญ่' : c.branch}</td>
                <td className="px-3 py-2">{c.contactName || '-'}</td>
                <td className="px-3 py-2">{c.phone || '-'}</td>
                <td className="px-3 py-2 text-right">{c.creditDays} วัน</td>
                <td className="px-3 py-2">{c.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setForm({ ...c })}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    title="แก้ไข"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </td>
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
                const r = await saveCustomerAction({ ...form, taxId: form.taxId || null });
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                setForm(null);
                router.refresh();
              });
            }}
            className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-5 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h2 className="font-bold text-sm">{form.id ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า'}</h2>
              <button type="button" onClick={() => setForm(null)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <fieldset disabled={isPending} className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">รหัสลูกค้า *</span>
                <input required value={form.code} onChange={(e) => set('code', e.target.value)} className={`${inputClass} font-mono`} />
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">เครดิต (วัน)</span>
                <input type="number" min={0} max={365} value={form.creditDays} onChange={(e) => set('creditDays', Math.trunc(Number(e.target.value) || 0))} className={inputClass} />
              </label>
              <label className="block col-span-2">
                <span className="block font-medium text-slate-700 mb-1">ชื่อลูกค้า *</span>
                <input required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">เลขประจำตัวผู้เสียภาษี (13 หลัก)</span>
                <input inputMode="numeric" value={form.taxId} onChange={(e) => set('taxId', e.target.value)} className={`${inputClass} font-mono`} />
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">สาขา (00000 = สำนักงานใหญ่)</span>
                <input value={form.branch} onChange={(e) => set('branch', e.target.value)} className={`${inputClass} font-mono`} />
              </label>
              <label className="block col-span-2">
                <span className="block font-medium text-slate-700 mb-1">ที่อยู่ (ใช้ในใบกำกับภาษี)</span>
                <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">ผู้ติดต่อ</span>
                <input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">โทรศัพท์</span>
                <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
              </label>
              <label className="flex items-center gap-2 col-span-2">
                <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
                <span>ใช้งาน</span>
              </label>
            </fieldset>
            {error && <p role="alert" className="text-red-600 font-medium">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="px-3 py-1.5 border border-slate-200 rounded-lg">ยกเลิก</button>
              <button type="submit" disabled={isPending} className="px-4 py-1.5 bg-[#2453d4] text-white rounded-lg font-semibold disabled:opacity-60">
                {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
