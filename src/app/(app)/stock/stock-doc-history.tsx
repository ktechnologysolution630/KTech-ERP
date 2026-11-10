'use client';

import { useState } from 'react';
import { History, Search, X } from 'lucide-react';
import type { StockDocRow } from '@/server/services/stock-docs';

const TYPE_LABEL: Record<StockDocRow['type'], string> = { RECEIVE: 'รับเข้า', ISSUE: 'จ่ายออก', TRANSFER: 'โอนย้าย', BORROW: 'ยืม' };
const TYPE_BADGE: Record<StockDocRow['type'], string> = {
  RECEIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ISSUE: 'bg-rose-50 text-rose-700 border-rose-200',
  TRANSFER: 'bg-blue-50 text-blue-700 border-blue-200',
  BORROW: 'bg-amber-50 text-amber-700 border-amber-200',
};

const dateText = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });

/** Every saved stock document: receipts, issues, transfers and borrows */
export function StockDocHistoryDialog({ docs, onClose }: { docs: StockDocRow[]; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'All' | StockDocRow['type']>('All');
  const q = search.trim().toLowerCase();
  const shown = docs.filter(
    (d) => (type === 'All' || d.type === type) && (!q || [d.number, d.fromName, d.toName, d.reference, d.performedByName].some((s) => s.toLowerCase().includes(q))),
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label="ประวัติเอกสารที่บันทึก">
      <div className="w-full max-w-6xl rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <History className="h-5 w-5 text-slate-500" /> ประวัติเอกสารที่บันทึก
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="ปิด">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-6 text-xs">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-60 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาเลขที่เอกสาร, Supplier, คลัง, PO..."
                aria-label="ค้นหาเอกสาร"
                className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 focus:border-[#2453d4] focus:outline-none"
              />
            </div>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="ประเภทเอกสาร" className="rounded-md border border-slate-300 px-3 py-2">
              <option value="All">ทุกประเภท</option>
              {(Object.keys(TYPE_LABEL) as StockDocRow['type'][]).map((k) => (
                <option key={k} value={k}>
                  {TYPE_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="self-center text-slate-500">{shown.length.toLocaleString('th-TH')} เอกสาร</span>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[900px]">
              <thead className="sticky top-0 bg-[#102d72] text-white">
                <tr>
                  {['วันที่ / เลขที่', 'ประเภท', 'ต้นทาง / Supplier', 'ปลายทาง', 'อ้างอิง', 'รายการ', 'มูลค่าสุทธิ', 'ผู้ทำรายการ'].map((h) => (
                    <th key={h} className={`px-3 py-2.5 font-medium ${h === 'รายการ' || h === 'มูลค่าสุทธิ' ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      ยังไม่มีเอกสารที่บันทึก
                    </td>
                  </tr>
                ) : (
                  shown.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="text-slate-700">{dateText(d.docDate)}</div>
                        <div className="font-mono text-[10px] text-slate-400">{d.number}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TYPE_BADGE[d.type]}`}>{TYPE_LABEL[d.type]}</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{d.fromName}</td>
                      <td className="px-3 py-2.5 text-slate-700">{d.toName}</td>
                      <td className="px-3 py-2.5 text-slate-500">{d.reference || '-'}</td>
                      <td className="px-3 py-2.5 text-right">{d.lineCount}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">{d.type === 'RECEIVE' ? `฿${d.net.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{d.performedByName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
