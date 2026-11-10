'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import type { StockItemDto } from '@/server/services/stock';
import { setReorderPointsAction } from './actions';

/** Sets reorder points for many items at once; leaving a point at 0 means no warning */
export function ReorderPointDialog({ items, onClose }: { items: StockItemDto[]; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [onlySet, setOnlySet] = useState(false);
  const [points, setPoints] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.reorderPoint ? String(i.reorderPoint) : ''])));
  const [error, setError] = useState<string | null>(null);
  const q = search.trim().toLowerCase();
  const shown = items.filter((i) => (!onlySet || i.reorderPoint > 0) && (!q || `${i.sku} ${i.name} ${i.category}`.toLowerCase().includes(q)));
  const changed = items.filter((i) => Number(points[i.id] || 0) !== i.reorderPoint);

  const save = () => {
    setError(null);
    const bad = changed.find((i) => !(Number(points[i.id] || 0) >= 0));
    if (bad) {
      setError(`จุดสั่งซื้อของ ${bad.name} ไม่ถูกต้อง`);
      return;
    }
    startTransition(async () => {
      const r = await setReorderPointsAction(changed.map((i) => ({ stockItemId: i.id, reorderPoint: Number(points[i.id] || 0) })));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label="ตั้งค่าจุดสั่งซื้อ">
      <div className="w-full max-w-4xl rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">ตั้งค่าจุดสั่งซื้อ</h2>
            <p className="text-xs text-slate-500">เมื่อคงเหลือรวมทุกคลังไม่เกินจุดสั่งซื้อ วัสดุจะขึ้นเป็นสีแดงในหน้าแจ้งเตือน ใส่ 0 หรือเว้นว่างเพื่อไม่แจ้งเตือน</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="ปิด">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-6 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาวัสดุ, SKU, หมวด..." aria-label="ค้นหาวัสดุ" className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 focus:border-[#2453d4] focus:outline-none" />
            </div>
            <label className="inline-flex items-center gap-1.5 text-slate-700">
              <input type="checkbox" checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} /> เฉพาะที่ตั้งไว้แล้ว
            </label>
          </div>
          <div className="max-h-[55vh] overflow-auto rounded-md border border-slate-200">
            <table className="w-full">
              <thead className="sticky top-0 bg-[#102d72] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">วัสดุ</th>
                  <th className="px-3 py-2.5 text-left font-medium">หมวด</th>
                  <th className="px-3 py-2.5 text-right font-medium">คงเหลือรวม</th>
                  <th className="w-40 px-3 py-2.5 text-right font-medium">จุดสั่งซื้อ</th>
                  <th className="px-3 py-2.5 text-left font-medium">หน่วย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-400">
                      ไม่พบวัสดุ
                    </td>
                  </tr>
                ) : (
                  shown.map((i) => {
                    const point = Number(points[i.id] || 0);
                    const low = point > 0 && i.totalQty <= point;
                    return (
                      <tr key={i.id} className={Number(points[i.id] || 0) !== i.reorderPoint ? 'bg-amber-50/60' : ''}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{i.name}</div>
                          <div className="font-mono text-[10px] text-slate-400">{i.sku}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{i.category}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${low ? 'text-rose-600' : 'text-slate-800'}`}>{i.totalQty.toLocaleString('th-TH')}</td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={points[i.id] ?? ''}
                            onChange={(e) => setPoints((prev) => ({ ...prev, [i.id]: e.target.value }))}
                            placeholder="0"
                            aria-label={`จุดสั่งซื้อ ${i.name}`}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-right"
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-600">{i.unit}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 text-sm">
          <span className="mr-auto text-xs text-slate-500">แก้ไขแล้ว {changed.length.toLocaleString('th-TH')} รายการ</span>
          {error && (
            <p role="alert" className="text-xs font-medium text-red-600">
              {error}
            </p>
          )}
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" onClick={save} disabled={isPending || changed.length === 0} className="rounded-md bg-[#2453d4] px-5 py-2 font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
