'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, X } from 'lucide-react';
import { saveAccountCategoryAction } from '../../sales/actions';

type CatType = 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY' | 'OTHER';
export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  type: CatType;
  groupName: string;
  vatDefault: 'VAT7' | 'NONE';
  whtRate: number;
  active: boolean;
}

const TYPE_LABEL: Record<CatType, string> = { INCOME: 'รายรับ', EXPENSE: 'ค่าใช้จ่าย', ASSET: 'สินทรัพย์', LIABILITY: 'หนี้สิน', EQUITY: 'ทุน', OTHER: 'อื่นๆ' };
const field = 'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-normal focus:border-[#2453d4] focus:outline-none';

/** หมวดรายรับ / หมวดค่าใช้จ่าย with a type filter, add and edit */
export function CategoriesClient({ categories }: { categories: CategoryRow[] }) {
  const [type, setType] = useState<'ALL' | CatType>('ALL');
  const [editing, setEditing] = useState<CategoryRow | 'new' | null>(null);
  const shown = categories.filter((c) => type === 'ALL' || c.type === type);
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-900">หมวดรายรับ / หมวดค่าใช้จ่าย</h2>
        <div className="flex items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="ประเภทหมวด" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
            <option value="ALL">ทุกประเภท</option>
            {(Object.keys(TYPE_LABEL) as CatType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 rounded-lg bg-[#2453d4] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1c43ab]">
            <Plus className="h-3.5 w-3.5" /> เพิ่มหมวด
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-[#102d72] text-white">
            <tr>
              {['รหัส', 'ชื่อหมวด', 'ประเภท', 'กลุ่มบัญชี', 'VAT / WHT', 'สถานะ', 'จัดการ'].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  ยังไม่มีหมวดในประเภทนี้
                </td>
              </tr>
            ) : (
              shown.map((c) => (
                <tr key={c.id} className={c.active ? 'hover:bg-slate-50' : 'text-slate-400'}>
                  <td className="px-3 py-2 font-mono">{c.code}</td>
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">{TYPE_LABEL[c.type]}</td>
                  <td className="px-3 py-2">{c.groupName || '-'}</td>
                  <td className="px-3 py-2">
                    {c.vatDefault === 'VAT7' ? 'VAT 7%' : 'ไม่มี VAT'}
                    {c.whtRate > 0 && ` / WHT ${c.whtRate}%`}
                  </td>
                  <td className="px-3 py-2">{c.active ? 'ใช้งาน' : 'ไม่ใช้งาน'}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setEditing(c)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title={`แก้ไข ${c.code} ${c.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-400">หมวดรายรับและค่าใช้จ่ายที่ใช้งานอยู่ จะเป็นตัวเลือก &quot;หมวดบัญชี&quot; ในเอกสารขาย รายรับ และรายจ่าย</p>
      {editing && <CategoryDialog category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function CategoryDialog({ category, onClose }: { category: CategoryRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({
    code: category?.code ?? '',
    name: category?.name ?? '',
    type: category?.type ?? ('EXPENSE' as CatType),
    groupName: category?.groupName ?? '',
    vatDefault: category?.vatDefault ?? ('VAT7' as 'VAT7' | 'NONE'),
    whtRate: category ? String(category.whtRate) : '0',
    active: category?.active ?? true,
  });
  const set = (patch: Partial<typeof v>) => setV((p) => ({ ...p, ...patch }));
  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveAccountCategoryAction({ ...v, id: category?.id, whtRate: Number(v.whtRate || 0) });
      if (!r.ok) setError(r.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label={category ? 'แก้ไขหมวด' : 'เพิ่มหมวด'}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">{category ? 'แก้ไขหมวด' : 'เพิ่มหมวด'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="ปิด">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-5 text-xs">
          <label className="block font-semibold text-slate-700">
            รหัส <span className="text-red-500">*</span>
            <input value={v.code} onChange={(e) => set({ code: e.target.value })} placeholder="เช่น 5111" className={field} />
          </label>
          <label className="block font-semibold text-slate-700">
            ประเภท
            <select value={v.type} onChange={(e) => set({ type: e.target.value as CatType })} className={field}>
              {(Object.keys(TYPE_LABEL) as CatType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block font-semibold text-slate-700">
            ชื่อหมวด <span className="text-red-500">*</span>
            <input value={v.name} onChange={(e) => set({ name: e.target.value })} className={field} />
          </label>
          <label className="col-span-2 block font-semibold text-slate-700">
            กลุ่มบัญชี
            <input value={v.groupName} onChange={(e) => set({ groupName: e.target.value })} placeholder="เช่น ต้นทุนโครงการ" className={field} />
          </label>
          <label className="block font-semibold text-slate-700">
            VAT ปกติ
            <select value={v.vatDefault} onChange={(e) => set({ vatDefault: e.target.value as 'VAT7' | 'NONE' })} className={field}>
              <option value="VAT7">VAT 7%</option>
              <option value="NONE">ไม่มี VAT</option>
            </select>
          </label>
          <label className="block font-semibold text-slate-700">
            หัก ณ ที่จ่ายปกติ (%)
            <input type="number" min={0} max={100} step="0.5" value={v.whtRate} onChange={(e) => set({ whtRate: e.target.value })} className={field} />
          </label>
          <label className="col-span-2 inline-flex items-center gap-1.5 font-semibold text-slate-700">
            <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> ใช้งาน
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 text-sm">
          {error && (
            <p role="alert" className="mr-auto text-xs font-medium text-red-600">
              {error}
            </p>
          )}
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" disabled={pending} onClick={save} className="rounded-md bg-[#2453d4] px-5 py-2 font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
            {pending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
