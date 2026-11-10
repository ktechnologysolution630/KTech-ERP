'use client';

import { useState } from 'react';
import { ArrowLeft, History, Search } from 'lucide-react';
import type { StockDocRow } from '@/server/services/stock-docs';

const TYPE_LABEL: Record<StockDocRow['type'], string> = { RECEIVE: 'รับเข้า', ISSUE: 'จ่ายออก', TRANSFER: 'โอนย้าย', BORROW: 'ยืม' };
const TYPE_BADGE: Record<StockDocRow['type'], string> = {
  RECEIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ISSUE: 'bg-rose-50 text-rose-700 border-rose-200',
  TRANSFER: 'bg-blue-50 text-blue-700 border-blue-200',
  BORROW: 'bg-amber-50 text-amber-700 border-amber-200',
};
const PAGE_SIZE = 20;
const CENTRAL = 'CENTRAL';
const dateText = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });

/** Every saved stock document as a page of the สต็อกทั้งหมด tab, with search, filters and paging */
export function StockDocHistoryView({
  docs,
  locations,
  onBack,
}: {
  docs: StockDocRow[];
  locations: { projectId: string | null; name: string }[];
  onBack: () => void;
}) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'All' | StockDocRow['type']>('All');
  const [store, setStore] = useState('All');
  const [page, setPage] = useState(1);
  const q = search.trim().toLowerCase();
  const shown = docs.filter(
    (d) =>
      (type === 'All' || d.type === type) &&
      (store === 'All' || d.storeIds.some((s) => (s ?? CENTRAL) === store)) &&
      (!q || [d.number, d.itemsSummary, d.fromName, d.reference, d.performedByName, d.notes].some((s) => s.toLowerCase().includes(q))),
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const filter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <History className="h-4 w-4" /> ประวัติเอกสารที่บันทึก
          </h2>
          <p className="text-xs text-slate-500">เอกสารรับเข้า จ่ายออก โอนย้าย และยืม ที่บันทึกในระบบ พร้อมผู้บันทึกและเหตุผล</p>
        </div>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-3.5 w-3.5" /> กลับสต็อกทั้งหมด
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => filter(() => setSearch(e.target.value))}
            placeholder="ค้นหาเลขที่เอกสาร สินค้า SKU ผู้บันทึก หรือเหตุผล"
            aria-label="ค้นหาเอกสาร"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-xs focus:border-[#2453d4] focus:outline-none"
          />
        </div>
        <select value={type} onChange={(e) => filter(() => setType(e.target.value as typeof type))} aria-label="ประเภทเอกสาร" className="rounded-lg border border-slate-200 px-3 py-2 text-xs sm:w-48">
          <option value="All">ทุกประเภท</option>
          {(Object.keys(TYPE_LABEL) as StockDocRow['type'][]).map((k) => (
            <option key={k} value={k}>
              {TYPE_LABEL[k]}
            </option>
          ))}
        </select>
        <select value={store} onChange={(e) => filter(() => setStore(e.target.value))} aria-label="คลัง" className="rounded-lg border border-slate-200 px-3 py-2 text-xs sm:w-56">
          <option value="All">ทุกคลัง</option>
          {locations.map((l) => (
            <option key={l.projectId ?? CENTRAL} value={l.projectId ?? CENTRAL}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[1000px] text-xs">
          <thead className="bg-[#102d72] text-white">
            <tr>
              {['วันที่บันทึก', 'เอกสาร', 'สถานะล่าสุด', 'สินค้า / วัสดุ', 'คลัง', 'ผู้ขอ / ผู้บันทึก', 'เหตุผล'].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <p>ยังไม่มีประวัติเอกสารที่บันทึก</p>
                  <p className="mt-1 text-[11px]">เมื่อบันทึกรับเข้า จ่ายออก โอนย้าย หรือยืมแล้ว รายการจะแสดงที่นี่</p>
                </td>
              </tr>
            ) : (
              rows.map((d) => (
                <tr key={d.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{dateText(d.docDate)}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-mono font-semibold text-[#2453d4]">{d.number}</div>
                    {d.reference && <div className="text-[10px] text-slate-400">{d.reference}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TYPE_BADGE[d.type]}`}>{TYPE_LABEL[d.type]}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-800">
                    {d.itemsSummary || '-'}
                    <div className="text-[10px] text-slate-400">
                      {d.lineCount} รายการ{d.type === 'RECEIVE' ? ` · ฿${d.net.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{d.storeName}</td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {d.performedByName}
                    {d.type === 'RECEIVE' && d.fromName !== '-' && <div className="text-[10px] text-slate-400">จาก {d.fromName}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{d.notes || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>
          {shown.length.toLocaleString('th-TH')} รายการ · หน้า {current} / {pages}
        </span>
        <div className="flex gap-1.5">
          <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className="rounded border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40">
            ก่อนหน้า
          </button>
          <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} className="rounded border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40">
            ถัดไป
          </button>
        </div>
      </div>
    </div>
  );
}
