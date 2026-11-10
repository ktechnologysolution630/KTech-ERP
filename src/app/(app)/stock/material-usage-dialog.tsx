'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Save, Search, X } from 'lucide-react';
import type { StockPageData } from '@/server/services/stock';
import { DateInput } from '@/components/date-input';
import { createStockDocAction } from './actions';

const CENTRAL = 'CENTRAL';
const toProjectId = (v: string) => (v === CENTRAL ? null : v);
const keyOf = (id: string | null) => id ?? CENTRAL;
const input = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#2453d4] focus:outline-none disabled:bg-slate-100 disabled:text-slate-500';

/**
 * Records what a site used: pick the project, tick the materials it holds and say how much went.
 * Saved as one issue document (เบิกใช้หน้างาน). The history tab lists earlier issues of the project.
 */
export function MaterialUsageDialog({ data, meName, today, onClose }: { data: StockPageData; meName: string; today: string; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const stores = data.locations.filter((l) => (l.projectId === null ? data.permissions.moveCentral : data.permissions.movableProjectIds.includes(l.projectId)));
  const [store, setStore] = useState(stores.length === 1 ? keyOf(stores[0]!.projectId) : '');
  const [tab, setTab] = useState<'record' | 'history'>('record');
  const [search, setSearch] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [date, setDate] = useState(today);
  const [zone, setZone] = useState('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const balanceOf = (itemId: string) => data.items.find((i) => i.id === itemId)?.balances.find((b) => keyOf(b.projectId) === store)?.quantity ?? 0;
  const q = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      store
        ? data.items
            .map((it) => ({ it, balance: it.balances.find((b) => keyOf(b.projectId) === store)?.quantity ?? 0 }))
            .filter((r) => (!onlyInStock || r.balance > 0) && (!q || `${r.it.sku} ${r.it.name} ${r.it.category}`.toLowerCase().includes(q)))
        : [],
    [data.items, store, onlyInStock, q],
  );
  const history = store ? data.movements.filter((m) => m.type === 'ISSUE' && keyOf(m.projectId) === store) : [];
  const allTicked = rows.length > 0 && rows.every((r) => ticked.has(r.it.id));
  const tick = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const save = () => {
    setError(null);
    setSaved(null);
    const lines = [...ticked].map((id) => ({ stockItemId: id, quantity: Number(qty[id] ?? '') }));
    const bad = lines.find((l) => !(l.quantity > 0));
    if (bad) {
      setError(`กรุณากรอกจำนวนที่ใช้ของ ${data.items.find((i) => i.id === bad.stockItemId)?.name ?? 'รายการที่เลือก'}`);
      return;
    }
    const over = lines.find((l) => l.quantity > balanceOf(l.stockItemId));
    if (over) {
      setError(`${data.items.find((i) => i.id === over.stockItemId)?.name} ใช้เกินยอดคงเหลือ (${balanceOf(over.stockItemId).toLocaleString('th-TH')})`);
      return;
    }
    const projectId = toProjectId(store);
    startTransition(async () => {
      const r = await createStockDocAction({
        type: 'ISSUE',
        docDate: date,
        projectId,
        issueKind: 'MATERIAL_ISSUE',
        useProjectId: projectId,
        zone,
        usageNote: note,
        notes: note,
        lines: lines.map((l) => ({ ...l, note: '' })),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(`บันทึกการใช้วัสดุ ${(r.value ?? '').split('|')[1] ?? ''} แล้ว ${lines.length} รายการ`);
      setTicked(new Set());
      setQty({});
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label="บันทึกการใช้วัสดุ">
      <div className="w-full max-w-6xl rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5">
          <h2 className="text-xl font-semibold text-slate-900">บันทึกการใช้วัสดุ</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="ปิด">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-7 py-5 text-sm">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-slate-700">โครงการ</span>
              <select
                value={store}
                onChange={(e) => {
                  setStore(e.target.value);
                  setTicked(new Set());
                  setQty({});
                  setSaved(null);
                }}
                className={input}
              >
                <option value="">เลือกโครงการ</option>
                {stores.map((l) => (
                  <option key={keyOf(l.projectId)} value={keyOf(l.projectId)}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-slate-700">ผู้บันทึก</span>
              <input value={meName} disabled className={input} />
            </label>
          </div>

          <div role="tablist" className="flex gap-6 border-b border-slate-200">
            {(
              [
                ['record', 'บันทึกการใช้วัสดุ'],
                ['history', 'ประวัติการใช้วัสดุ'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`-mb-px border-b-2 pb-2 ${tab === k ? 'border-[#2453d4] text-[#2453d4]' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
              >
                {l}
              </button>
            ))}
          </div>

          {tab === 'record' ? (
            <>
              <div className="flex flex-wrap gap-3">
                <div className="relative min-w-60 flex-1 sm:max-w-xl">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา" aria-label="ค้นหาวัสดุ" className={`${input} pl-9`} />
                </div>
                <select value={onlyInStock ? 'in' : 'all'} onChange={(e) => setOnlyInStock(e.target.value === 'in')} aria-label="แสดงวัสดุ" className={`${input} w-44`}>
                  <option value="in">มีของคงเหลือ</option>
                  <option value="all">ทั้งหมด</option>
                </select>
                <button type="button" onClick={() => startRefresh(() => router.refresh())} title="โหลดยอดคงเหลือล่าสุด" className="rounded-md border border-slate-300 px-3 text-slate-600 hover:bg-slate-50">
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-slate-700">วันที่ใช้วัสดุ</span>
                  <DateInput value={date} onChange={(e) => setDate(e.target.value)} className={input} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-slate-700">พื้นที่ / จุดใช้งาน</span>
                  <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="เช่น ชั้น 3 โซน A" className={input} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-slate-700">หมายเหตุ</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-slate-700">
                <input type="checkbox" checked={allTicked} disabled={rows.length === 0} onChange={() => setTicked(allTicked ? new Set() : new Set(rows.map((r) => r.it.id)))} />
                เลือกทั้งหมด
              </label>

              <div className="overflow-hidden rounded-md border border-slate-200">
                {!store ? (
                  <p className="py-10 text-center text-slate-600">กรุณาเลือกโครงการ</p>
                ) : rows.length === 0 ? (
                  <p className="py-10 text-center text-slate-500">{onlyInStock ? 'ไม่มีวัสดุคงเหลือในโครงการนี้' : 'ไม่พบวัสดุ'}</p>
                ) : (
                  <div className="max-h-[45vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
                        <tr>
                          <th className="w-10 px-3 py-2" />
                          <th className="px-3 py-2 text-left">SKU</th>
                          <th className="px-3 py-2 text-left">วัสดุ</th>
                          <th className="px-3 py-2 text-left">หมวด</th>
                          <th className="px-3 py-2 text-right">คงเหลือ</th>
                          <th className="w-36 px-3 py-2 text-right">จำนวนที่ใช้</th>
                          <th className="px-3 py-2 text-left">หน่วย</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map(({ it, balance }) => {
                          const on = ticked.has(it.id);
                          return (
                            <tr key={it.id} className={on ? 'bg-blue-50/50' : ''}>
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={on} onChange={() => tick(it.id)} aria-label={`เลือก ${it.name}`} />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-500">{it.sku}</td>
                              <td className="px-3 py-2 font-medium text-slate-900">{it.name}</td>
                              <td className="px-3 py-2 text-xs text-slate-500">{it.category}</td>
                              <td className={`px-3 py-2 text-right ${balance > 0 ? '' : 'text-slate-400'}`}>{balance.toLocaleString('th-TH')}</td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={balance}
                                  step="any"
                                  value={qty[it.id] ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setQty((prev) => ({ ...prev, [it.id]: v }));
                                    // Typing an amount ticks the row
                                    if (v && !on) tick(it.id);
                                  }}
                                  disabled={balance <= 0}
                                  aria-label={`จำนวนที่ใช้ ${it.name}`}
                                  className="w-full rounded border border-slate-300 px-2 py-1 text-right disabled:bg-slate-50"
                                />
                              </td>
                              <td className="px-3 py-2 text-slate-600">{it.unit}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              {!store ? (
                <p className="py-10 text-center text-slate-600">กรุณาเลือกโครงการ</p>
              ) : history.length === 0 ? (
                <p className="py-10 text-center text-slate-500">ยังไม่มีการใช้วัสดุในโครงการนี้</p>
              ) : (
                <div className="max-h-[55vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">วันที่ / เลขที่</th>
                        <th className="px-3 py-2 text-left">วัสดุ</th>
                        <th className="px-3 py-2 text-right">จำนวน</th>
                        <th className="px-3 py-2 text-left">พื้นที่ / จุดใช้งาน</th>
                        <th className="px-3 py-2 text-left">ผู้บันทึก</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {history.map((m) => (
                        <tr key={m.id}>
                          <td className="px-3 py-2">
                            <div>{new Date(m.date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                            <div className="font-mono text-[11px] text-slate-400">{m.referenceNumber ?? m.movementNumber}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900">{m.itemName}</div>
                            <div className="font-mono text-[11px] text-slate-400">{m.sku}</div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {m.quantity.toLocaleString('th-TH')} {m.unit}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{m.toName}</td>
                          <td className="px-3 py-2 text-slate-600">{m.performedByName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-7 py-5 text-sm">
          <span className="text-slate-600">เลือก {ticked.size.toLocaleString('th-TH')} รายการ</span>
          {error && (
            <p role="alert" className="font-medium text-red-600">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="font-medium text-emerald-700">
              {saved}
            </p>
          )}
          <button
            type="button"
            onClick={save}
            disabled={isPending || ticked.size === 0 || tab !== 'record'}
            className="ml-auto inline-flex items-center gap-2 rounded-md bg-[#2453d4] px-5 py-2.5 font-semibold text-white hover:bg-[#1c43ab] disabled:bg-blue-300"
          >
            <Save className="h-4 w-4" />
            {isPending ? 'กำลังบันทึก...' : 'บันทึกการใช้วัสดุ'}
          </button>
        </div>
      </div>
    </div>
  );
}
