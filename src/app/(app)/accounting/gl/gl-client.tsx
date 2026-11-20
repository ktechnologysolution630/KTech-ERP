'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { GL_ACCOUNT_TYPE_LABEL, GL_ACCOUNT_TYPES, SYSTEM_ACCOUNT_LABEL, type GlAccountType, type SystemAccountKey } from '@/domain/gl';
import { formatMoneyDisplay } from '@/domain/money';
import type { GlAccountDto } from '@/server/services/gl';
import { repostAllAction, saveGlAccountAction, setSystemAccountAction } from './actions';

const field = 'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-normal focus:border-[#2453d4] focus:outline-none';

/** ลงบัญชีย้อนหลัง: posts documents made before Auto-GL and re-checks every entry against its document */
export function RepostButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await repostAllAction();
            if (!r.ok) setMsg(r.error);
            else if (r.data) setMsg(`ลงบัญชีใหม่ ${r.data.posted} · ยกเลิก ${r.data.voided} · ตรงอยู่แล้ว ${r.data.unchanged}`);
            router.refresh();
          })
        }
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} /> ลงบัญชีย้อนหลัง / ตรวจสอบ
      </button>
    </div>
  );
}

type Editing = { id?: string; code: string; name: string; type: GlAccountType; active: boolean };

export function AccountsClient({ accounts, canManage }: { accounts: GlAccountDto[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [type, setType] = useState<'ALL' | GlAccountType>('ALL');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shown = accounts.filter((a) => (type === 'ALL' || a.type === type) && (!q || `${a.code} ${a.name}`.toLowerCase().includes(q.toLowerCase())));
  const keys = Object.keys(SYSTEM_ACCOUNT_LABEL) as SystemAccountKey[];

  const save = () =>
    editing &&
    start(async () => {
      const r = await saveGlAccountAction(editing);
      if (!r.ok) return setError(r.error);
      setEditing(null);
      setError(null);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">ผังบัญชี ({accounts.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารหัส / ชื่อ" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs" />
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="ประเภทบัญชี" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="ALL">ทุกหมวด</option>
              {GL_ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {GL_ACCOUNT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <a href={`/api/csv/gl-accounts?v=${accounts.length}`} download className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
              Export CSV
            </a>
            {canManage && (
              <button type="button" onClick={() => setEditing({ code: '', name: '', type: 'EXPENSE', active: true })} className="inline-flex items-center gap-1 rounded-lg bg-[#2453d4] px-3 py-1.5 text-xs font-semibold text-white">
                <Plus className="h-3.5 w-3.5" /> เพิ่มบัญชี
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-[#102d72] text-white">
              <tr>
                {['รหัส', 'ชื่อบัญชี', 'หมวด', 'ใช้ลงบัญชีอัตโนมัติ', 'ยอดคงเหลือ', 'สถานะ', ''].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 font-medium ${h === 'ยอดคงเหลือ' ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((a) => (
                <tr key={a.id} className={a.active ? 'hover:bg-slate-50' : 'text-slate-400'}>
                  <td className="px-3 py-2 font-mono">{a.code}</td>
                  <td className="px-3 py-2">{a.name}</td>
                  <td className="px-3 py-2">{GL_ACCOUNT_TYPE_LABEL[a.type]}</td>
                  <td className="px-3 py-2 text-slate-500">{a.systemKey ? SYSTEM_ACCOUNT_LABEL[a.systemKey] : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.balance === 0 ? '-' : `${formatMoneyDisplay(Math.abs(a.balance).toFixed(2))} ${a.balance > 0 ? 'Dr' : 'Cr'}`}</td>
                  <td className="px-3 py-2">{a.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <button type="button" onClick={() => setEditing({ id: a.id, code: a.code, name: a.name, type: a.type, active: a.active })} aria-label={`แก้ไข ${a.code}`} className="text-slate-500 hover:text-[#2453d4]">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">บัญชีที่ใช้ลงบัญชีอัตโนมัติ</h2>
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {keys.map((k) => {
            const current = accounts.find((a) => a.systemKey === k);
            return (
              <label key={k} className="text-xs text-slate-600">
                {SYSTEM_ACCOUNT_LABEL[k]}
                <select
                  disabled={!canManage || pending}
                  value={current?.id ?? ''}
                  onChange={(e) =>
                    start(async () => {
                      const r = await setSystemAccountAction(k, e.target.value);
                      setError(r.ok ? null : r.error);
                      router.refresh();
                    })
                  }
                  className={field}
                >
                  {!current && <option value="">— ยังไม่ได้กำหนด —</option>}
                  {accounts
                    .filter((a) => a.active || a.id === current?.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </div>
        <p className="px-4 pb-3 text-[11px] text-slate-400">เปลี่ยนบัญชีแล้วมีผลกับเอกสารที่บันทึกต่อจากนี้ รายการเก่าคงเดิมจนกว่าจะกด &quot;ลงบัญชีย้อนหลัง&quot;</p>
      </section>
      {error && !editing && <p className="text-xs text-rose-600">{error}</p>}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">{editing.id ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'}</h3>
              <button type="button" onClick={() => setEditing(null)} aria-label="ปิด">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs font-medium text-slate-700">
              <label className="block">
                รหัสบัญชี
                <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} className={field} />
              </label>
              <label className="block">
                ชื่อบัญชี
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={field} />
              </label>
              <label className="block">
                หมวดบัญชี
                <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as GlAccountType })} className={field}>
                  {GL_ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {GL_ACCOUNT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              {editing.id && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> ใช้งาน
                </label>
              )}
              {error && <p className="text-rose-600">{error}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">
                ยกเลิก
              </button>
              <button type="button" disabled={pending} onClick={save} className="rounded-lg bg-[#2453d4] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
