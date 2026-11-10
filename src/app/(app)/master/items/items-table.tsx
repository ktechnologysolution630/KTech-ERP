'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Trash2, X } from 'lucide-react';
import type { ItemDeleteResult } from '@/server/services/item-delete';
import { deleteItemsAction } from '../actions';

export interface ItemRow {
  id: string;
  code: string;
  name: string;
  unitName: string;
  category: string | null;
  active: boolean;
}

const DELETE_WORD = 'ลบ';

/** The item register with search, ticking and bulk delete (owner / admin). */
export function ItemsTable({ items, canDelete }: { items: ItemRow[]; canDelete: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ItemDeleteResult | null>(null);

  const q = search.trim().toLowerCase();
  const shown = q ? items.filter((i) => `${i.code} ${i.name} ${i.category ?? ''}`.toLowerCase().includes(q)) : items;
  const selectedRows = items.filter((i) => selected.has(i.id));
  // "All" ticks only what the search shows, so nothing hidden is deleted by surprise
  const allShown = shown.length > 0 && shown.every((i) => selected.has(i.id));
  const toggleShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of shown) {
        if (allShown) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-96">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหารหัส ชื่อ หรือหมวด เช่น AA01"
            aria-label="ค้นหาสินค้า"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-[#2453d4] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">
            {shown.length.toLocaleString('th-TH')} / {items.length.toLocaleString('th-TH')} รายการ
            {selectedRows.length > 0 && <b className="text-red-600"> · เลือก {selectedRows.length.toLocaleString('th-TH')}</b>}
          </span>
          {canDelete && (
            <button
              type="button"
              disabled={selectedRows.length === 0}
              onClick={() => {
                setResult(null);
                setConfirming(true);
              }}
              title={selectedRows.length === 0 ? 'ติ๊กเลือกสินค้าที่จะลบก่อน' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> ลบ{selectedRows.length > 0 && ` (${selectedRows.length.toLocaleString('th-TH')})`}
            </button>
          )}
        </div>
      </div>

      {result && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <div>
            <p className="font-semibold">ลบแล้ว {result.deleted.toLocaleString('th-TH')} รายการ</p>
            {result.deactivated.length > 0 && (
              <p className="mt-1 text-amber-800">
                ปิดใช้งาน {result.deactivated.length.toLocaleString('th-TH')} รายการแทนการลบ เพราะมีใบขอซื้อหรือใบสั่งซื้ออ้างถึงอยู่ — จะไม่แสดงให้เลือกในใบใหม่อีก แต่เอกสารเดิมยังเปิดดูได้ครบ
              </p>
            )}
          </div>
          <button type="button" onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
              <tr>
                {canDelete && (
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" checked={allShown} onChange={toggleShown} aria-label="เลือกทั้งหมดที่แสดง" />
                  </th>
                )}
                <th className="px-4 py-3 text-left">รหัส</th>
                <th className="px-4 py-3 text-left">ชื่อสินค้า</th>
                <th className="px-4 py-3 text-left">หน่วย</th>
                <th className="px-4 py-3 text-left">หมวด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={canDelete ? 5 : 4} className="py-12 text-center text-slate-400">
                    {items.length === 0 ? 'ยังไม่มีสินค้าในทะเบียน' : `ไม่พบสินค้าที่ตรงกับ “${search.trim()}”`}
                  </td>
                </tr>
              ) : (
                shown.map((it) => (
                  <tr key={it.id} className={selected.has(it.id) ? 'bg-red-50/50' : it.active ? '' : 'bg-slate-50 text-slate-400'}>
                    {canDelete && (
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleOne(it.id)} aria-label={`เลือก ${it.code} ${it.name}`} />
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-medium">{it.code}</td>
                    <td className="px-4 py-2.5">
                      {it.name}
                      {!it.active && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">ปิดใช้งาน</span>}
                    </td>
                    <td className="px-4 py-2.5">{it.unitName}</td>
                    <td className="px-4 py-2.5 text-slate-500">{it.category || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirming && selectedRows.length > 0 && (
        <ConfirmDelete
          count={selectedRows.length}
          sample={selectedRows.slice(0, 50)}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            setSelected(new Set());
            setResult(r);
            router.refresh();
          }}
          ids={selectedRows.map((r) => r.id)}
        />
      )}
    </div>
  );
}

function ConfirmDelete({
  count,
  sample,
  ids,
  onClose,
  onDone,
}: {
  count: number;
  sample: ItemRow[];
  ids: string[];
  onClose: () => void;
  onDone: (r: ItemDeleteResult) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await deleteItemsAction(ids);
        if (r.ok) onDone(r.result);
        else setError(r.error);
      } catch {
        setError('ลบไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={`ลบสินค้า ${count} รายการ`}>
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white text-sm shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="font-bold text-slate-900">ลบสินค้าออกจากทะเบียน {count.toLocaleString('th-TH')} รายการ</h3>
          <button type="button" onClick={onClose} disabled={isPending} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-xs">
            {sample.map((t) => (
              <li key={t.id} className="flex gap-2 px-3 py-1.5">
                <span className="shrink-0 font-mono text-slate-500">{t.code}</span>
                <span className="truncate text-slate-800">{t.name}</span>
              </li>
            ))}
            {count > sample.length && <li className="px-3 py-1.5 text-slate-500">และอีก {(count - sample.length).toLocaleString('th-TH')} รายการ</li>}
          </ul>
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-bold">ลบถาวร กู้คืนไม่ได้</p>
            <p className="mt-1">สินค้าที่มีใบขอซื้อหรือใบสั่งซื้ออ้างถึงแล้ว ระบบจะไม่ลบ แต่จะปิดใช้งานแทน เพื่อให้เอกสารเดิมยังถูกต้อง</p>
          </div>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-700">พิมพ์คำว่า &quot;{DELETE_WORD}&quot; เพื่อยืนยัน</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-red-500 focus:outline-none" />
          </label>
          {error && (
            <p role="alert" className="text-xs font-medium text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" onClick={confirm} disabled={isPending || typed.trim() !== DELETE_WORD} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {isPending ? 'กำลังลบ...' : `ลบ ${count.toLocaleString('th-TH')} รายการ`}
          </button>
        </div>
      </div>
    </div>
  );
}
