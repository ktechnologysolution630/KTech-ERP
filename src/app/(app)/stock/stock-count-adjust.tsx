'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Plus, Search, X, XCircle } from 'lucide-react';
import { DateInput } from '@/components/date-input';
import { bangkokDateString } from '@/domain/thai';
import type { StockPageData } from '@/server/services/stock';
import { createStockCountAction, decideStockAdjustAction } from './actions';

const CENTRAL = 'CENTRAL';
const locKey = (projectId: string | null) => projectId ?? CENTRAL;
const qtyText = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateText = (d: Date | string) => new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
const tableHead = 'bg-[#102d72] text-xs text-white [&_th]:border-r [&_th]:border-white/40 [&_th:last-child]:border-r-0';
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#2453d4] focus:outline-none';
const diffClass = (n: number) => (n < 0 ? 'text-rose-600' : n > 0 ? 'text-emerald-700' : 'text-slate-400');
const signed = (n: number) => `${n > 0 ? '+' : ''}${qtyText(n)}`;

const ADJUST_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'รออนุมัติ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPROVED: { label: 'อนุมัติแล้ว', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECTED: { label: 'ไม่อนุมัติ', cls: 'bg-red-50 text-red-700 border-red-200' },
};

/** Locations the viewer may count or adjust (where they may move stock). */
function workableLocations(data: StockPageData) {
  return data.locations.filter((l) => (l.projectId === null ? data.permissions.moveCentral : data.permissions.movableProjectIds.includes(l.projectId)));
}

// ---------------------------------------------------------------------------
// นับสต็อก
// ---------------------------------------------------------------------------

export function StockCountTab({ data }: { data: StockPageData }) {
  const [counting, setCounting] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);
  const canCount = workableLocations(data).length > 0;
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">นับสต็อก</h2>
          <p className="text-xs text-slate-500">ประวัติการตรวจนับย้อนหลัง โดยไม่เปลี่ยนยอดคงเหลือในระบบ</p>
        </div>
        {canCount && (
          <button
            type="button"
            onClick={() => {
              setSaved(null);
              setCounting(true);
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800"
          >
            <ClipboardCheck className="h-4 w-4" /> นับสต็อก
          </button>
        )}
      </div>

      {saved && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          <span>
            บันทึกผลนับ <b className="font-mono">{saved}</b> แล้ว — ถ้ายอดจริงต่างจากระบบ ให้สร้างใบปรับปรุงยอดที่เมนู &quot;ปรับปรุงยอดสต็อก&quot; เพื่อขออนุมัติ
          </span>
          <button type="button" onClick={() => setSaved(null)} className="text-emerald-600 hover:text-emerald-800" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">ประวัติการนับสต็อก</h3>
        </div>
        {data.counts.length === 0 ? (
          <p className="py-14 text-center text-sm text-slate-400">ยังไม่มีประวัติการนับสต็อก</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead className={tableHead}>
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3.5 py-2.5 text-left font-medium">เลขที่ / วันที่นับ</th>
                  <th className="px-3.5 py-2.5 text-right font-medium">รายการที่นับ</th>
                  <th className="px-3.5 py-2.5 text-right font-medium">มีผลต่าง</th>
                  <th className="px-3.5 py-2.5 text-left font-medium">ผู้นับ</th>
                  <th className="px-3.5 py-2.5 text-left font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.counts.map((c) => {
                  const isOpen = open.has(c.id);
                  const withDiff = c.lines.filter((l) => l.differenceQty !== 0).length;
                  return (
                    <React.Fragment key={c.id}>
                      <tr className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(c.id)}>
                        <td className="px-3 py-2.5 text-slate-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        <td className="px-3.5 py-2.5">
                          <div className="font-mono font-semibold">{c.countNumber}</div>
                          <div className="text-slate-400">{dateText(c.countedOn)}</div>
                        </td>
                        <td className="px-3.5 py-2.5 text-right">{c.lines.length.toLocaleString('th-TH')}</td>
                        <td className={`px-3.5 py-2.5 text-right font-semibold ${withDiff ? 'text-amber-700' : 'text-slate-400'}`}>{withDiff.toLocaleString('th-TH')}</td>
                        <td className="px-3.5 py-2.5 text-slate-600">{c.countedByName}</td>
                        <td className="max-w-xs truncate px-3.5 py-2.5 text-slate-500" title={c.note}>
                          {c.note || '-'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50 px-4 py-3">
                            <table className="w-full text-xs">
                              <thead className="text-slate-500">
                                <tr>
                                  <th className="py-1 text-left font-medium">คลัง</th>
                                  <th className="py-1 text-left font-medium">SKU / สินค้า</th>
                                  <th className="py-1 text-right font-medium">คงเหลือในระบบ</th>
                                  <th className="py-1 text-right font-medium">นับจริง</th>
                                  <th className="py-1 text-right font-medium">ผลต่าง</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200/70">
                                {c.lines.map((l, i) => (
                                  <tr key={i}>
                                    <td className="py-1.5 text-slate-600">{l.locationName}</td>
                                    <td className="py-1.5">
                                      <span className="font-mono text-[10px] text-slate-400">{l.sku}</span> {l.itemName}
                                    </td>
                                    <td className="py-1.5 text-right">
                                      {qtyText(l.systemQty)} {l.unit}
                                    </td>
                                    <td className="py-1.5 text-right font-semibold">
                                      {qtyText(l.countedQty)} {l.unit}
                                    </td>
                                    <td className={`py-1.5 text-right font-bold ${diffClass(l.differenceQty)}`}>{signed(l.differenceQty)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {counting && (
        <StockCountDialog
          data={data}
          onClose={() => setCounting(false)}
          onSaved={(number) => {
            setCounting(false);
            setSaved(number);
          }}
        />
      )}
    </div>
  );
}

function StockCountDialog({ data, onClose, onSaved }: { data: StockPageData; onClose: () => void; onSaved: (countNumber: string) => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [countedOn, setCountedOn] = useState(bangkokDateString());
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [counted, setCounted] = useState<Record<string, string>>({});

  // Every item held at a location the user may count, plus items held nowhere (counted in the central store)
  const rows = useMemo(() => {
    const allowed = new Map(workableLocations(data).map((l) => [locKey(l.projectId), l]));
    const out: { key: string; stockItemId: string; projectId: string | null; locationName: string; sku: string; name: string; unit: string; systemQty: number }[] = [];
    for (const it of data.items) {
      const held = it.balances.filter((b) => allowed.has(locKey(b.projectId)));
      const places = held.length > 0 ? held : it.balances.length === 0 && allowed.has(CENTRAL) ? [{ projectId: null, locationName: allowed.get(CENTRAL)!.name, quantity: 0 }] : [];
      for (const b of places) {
        out.push({
          key: `${it.id}:${locKey(b.projectId)}`,
          stockItemId: it.id,
          projectId: b.projectId,
          locationName: b.locationName,
          sku: it.sku,
          name: it.name,
          unit: it.unit,
          systemQty: b.quantity,
        });
      }
    }
    return out.sort((a, b) => a.locationName.localeCompare(b.locationName, 'th') || a.sku.localeCompare(b.sku));
  }, [data]);

  const q = search.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.locationName} ${r.sku} ${r.name}`.toLowerCase().includes(q)) : rows;
  const locationCount = new Set(rows.map((r) => locKey(r.projectId))).size;
  const entered = rows.filter((r) => (counted[r.key] ?? '') !== '');
  const invalid = entered.some((r) => {
    const n = Number(counted[r.key]);
    return !Number.isFinite(n) || n < 0;
  });

  const save = () => {
    if (invalid) {
      setError('ยอดนับจริงต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const r = await createStockCountAction({
          countedOn,
          note,
          lines: entered.map((row) => ({ stockItemId: row.stockItemId, projectId: row.projectId, countedQty: Number(counted[row.key]) })),
        });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.refresh();
        onSaved(r.value ?? '');
      } catch {
        setError('บันทึกไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="นับสต็อก">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">นับสต็อก</h3>
            <p className="text-xs text-slate-500">บันทึกจำนวนที่ตรวจนับจริงโดยยังไม่เปลี่ยนยอดคงเหลือในระบบ</p>
          </div>
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="ปิด">
            <X className="h-5 w-5" />
          </button>
        </div>

        <fieldset disabled={isPending} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-xs">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">ข้อมูลการตรวจนับ</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-slate-500">วันที่นับ *</span>
                <DateInput value={countedOn} onChange={(e) => setCountedOn(e.target.value)} required className={inputClass} aria-label="วันที่นับ" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-slate-500">หมายเหตุ</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="ระบุหมายเหตุ (ถ้ามี)" className={inputClass} />
              </label>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">สินค้าทุกคลังที่คุณนับได้</h4>
                <p className="text-slate-500">
                  {locationCount} คลัง · ทั้งหมด {rows.length.toLocaleString('th-TH')} รายการ · กรอกแล้ว <b className="text-emerald-700">{entered.length.toLocaleString('th-TH')}</b> รายการ
                </p>
              </div>
              <div className="relative sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาคลัง SKU หรือชื่อสินค้า" aria-label="ค้นหาสินค้าที่จะนับ" className={`${inputClass} pl-9`} />
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="bg-sky-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">คลัง</th>
                    <th className="px-3 py-2 text-left font-semibold">SKU / สินค้า</th>
                    <th className="px-3 py-2 text-left font-semibold">หน่วย</th>
                    <th className="px-3 py-2 text-right font-semibold">คงเหลือในระบบ</th>
                    <th className="w-32 px-3 py-2 text-right font-semibold">นับจริง</th>
                    <th className="px-3 py-2 text-right font-semibold">ผลต่าง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        {rows.length === 0 ? 'ยังไม่มีสินค้าในคลังที่คุณนับได้ — เพิ่มวัสดุที่เมนูสต็อกทั้งหมดก่อน' : `ไม่พบสินค้าที่ตรงกับ “${search.trim()}”`}
                      </td>
                    </tr>
                  ) : (
                    shown.map((r) => {
                      const value = counted[r.key] ?? '';
                      const n = Number(value);
                      const diff = value !== '' && Number.isFinite(n) ? n - r.systemQty : null;
                      return (
                        <tr key={r.key} className={value !== '' ? 'bg-emerald-50/40' : ''}>
                          <td className="px-3 py-1.5 text-slate-600">{r.locationName}</td>
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-[10px] text-slate-400">{r.sku}</span> {r.name}
                          </td>
                          <td className="px-3 py-1.5 text-slate-600">{r.unit}</td>
                          <td className="px-3 py-1.5 text-right">{qtyText(r.systemQty)}</td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              inputMode="decimal"
                              value={value}
                              onChange={(e) => setCounted((prev) => ({ ...prev, [r.key]: e.target.value }))}
                              aria-label={`นับจริง ${r.name} ที่ ${r.locationName}`}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-right focus:border-[#2453d4] focus:outline-none"
                            />
                          </td>
                          <td className={`px-3 py-1.5 text-right font-bold ${diff === null ? 'text-slate-300' : diffClass(diff)}`}>{diff === null ? '-' : signed(diff)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {error && (
            <p role="alert" className="font-medium text-red-600">
              {error}
            </p>
          )}
        </fieldset>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-3">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending || entered.length === 0 || invalid}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {isPending ? 'กำลังบันทึก...' : 'บันทึกผลนับสต็อก'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ปรับปรุงยอดสต็อก
// ---------------------------------------------------------------------------

export function StockAdjustTab({ data, onCreate }: { data: StockPageData; onCreate?: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [docSearch, setDocSearch] = useState('');
  const [requester, setRequester] = useState('');
  const [loc, setLoc] = useState('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'All' | 'UP' | 'DOWN'>('All');
  const [status, setStatus] = useState('All');

  const q = docSearch.trim().toLowerCase();
  const who = requester.trim().toLowerCase();
  const rows = data.adjustRequests.filter((r) => {
    if (q && !`${r.requestNumber} ${r.sku} ${r.itemName}`.toLowerCase().includes(q)) return false;
    if (who && !r.requestedByName.toLowerCase().includes(who)) return false;
    if (loc !== 'All' && locKey(r.projectId) !== loc) return false;
    const day = bangkokDateString(new Date(r.createdAt));
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (kind === 'UP' && r.differenceQty <= 0) return false;
    if (kind === 'DOWN' && r.differenceQty >= 0) return false;
    if (status !== 'All' && r.status !== status) return false;
    return true;
  });
  const valueOf = (r: (typeof rows)[number]) => r.differenceQty * r.unitCost;
  const totalValue = rows.reduce((s, r) => s + valueOf(r), 0);

  const decide = (id: string, approve: boolean) => {
    if (!confirm(approve ? 'อนุมัติปรับยอดสต็อกตามใบนี้?' : 'ไม่อนุมัติใบปรับปรุงยอดนี้?')) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await decideStockAdjustAction(id, approve);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } catch {
        setError('บันทึกไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
      }
    });
  };

  const filterClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#2453d4] focus:outline-none';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">ปรับปรุงยอดสต็อก</h2>
          <p className="text-xs text-slate-500">สร้างเอกสารและขออนุมัติก่อนเปลี่ยนยอดคงเหลือ</p>
        </div>
        {onCreate && (
          <button type="button" onClick={onCreate} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1c43ab]">
            <Plus className="h-4 w-4" /> สร้างใบปรับปรุงยอด
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <input type="search" value={docSearch} onChange={(e) => setDocSearch(e.target.value)} placeholder="เลขที่เอกสาร / ชื่อวัสดุ" aria-label="ค้นหาเลขที่เอกสารหรือชื่อวัสดุ" className={filterClass} />
        <input type="search" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="ผู้จัดทำ" aria-label="ค้นหาผู้จัดทำ" className={filterClass} />
        <select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="คลัง" className={filterClass}>
          <option value="All">ทุกคลัง</option>
          {data.locations.map((l) => (
            <option key={locKey(l.projectId)} value={locKey(l.projectId)}>
              {l.name}
            </option>
          ))}
        </select>
        <DateInput value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} className={filterClass} aria-label="ตั้งแต่วันที่" />
        <DateInput value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} className={filterClass} aria-label="ถึงวันที่" />
        <select value={kind} onChange={(e) => setKind(e.target.value as 'All' | 'UP' | 'DOWN')} aria-label="ประเภท" className={filterClass}>
          <option value="All">ทุกประเภท</option>
          <option value="UP">ปรับเพิ่ม</option>
          <option value="DOWN">ปรับลด</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะ" className={filterClass}>
          <option value="All">ทุกสถานะ</option>
          {Object.entries(ADJUST_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-xs">
            <thead className={tableHead}>
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">เลขที่เอกสาร</th>
                <th className="px-3.5 py-2.5 text-left font-medium">วันที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium">คลัง</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ประเภท</th>
                <th className="px-3.5 py-2.5 text-left font-medium">รายการ</th>
                <th className="px-3.5 py-2.5 text-right font-medium">มูลค่าผลต่าง</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ผู้จัดทำ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">สถานะ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    {data.adjustRequests.length === 0 ? 'ยังไม่มีใบปรับปรุงยอด' : 'ไม่พบใบปรับปรุงยอดที่ตรงกับตัวกรอง'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const canDecide = data.permissions.approveAdjust && r.status === 'PENDING' && r.requestedBy !== data.me;
                  const up = r.differenceQty > 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3.5 py-2.5 font-mono font-semibold">{r.requestNumber}</td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-slate-500">{dateText(r.createdAt)}</td>
                      <td className="px-3.5 py-2.5 text-slate-600">{r.locationName}</td>
                      <td className="px-3.5 py-2.5">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${up ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                          {up ? 'ปรับเพิ่ม' : 'ปรับลด'}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium">{r.itemName}</div>
                        <div className="text-[10px] text-slate-500">
                          <span className="font-mono">{r.sku}</span> · {qtyText(r.currentQty)} → {qtyText(r.adjustedQty)} {r.unit} (
                          <span className={diffClass(r.differenceQty)}>{signed(r.differenceQty)}</span>)
                        </div>
                        {r.reason && <div className="mt-0.5 max-w-xs truncate text-[10px] text-slate-400" title={r.reason}>{r.reason}</div>}
                      </td>
                      <td className={`px-3.5 py-2.5 text-right font-semibold ${diffClass(valueOf(r))}`}>
                        {valueOf(r) > 0 ? '+' : ''}
                        {baht(valueOf(r))}
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-600">{r.requestedByName}</td>
                      <td className="px-3.5 py-2.5">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ADJUST_STATUS[r.status].cls}`}>{ADJUST_STATUS[r.status].label}</span>
                        {r.approvedByName && <div className="mt-0.5 text-[10px] text-slate-400">โดย {r.approvedByName}</div>}
                      </td>
                      <td className="px-3.5 py-2.5">
                        {canDecide ? (
                          <div className="flex gap-1.5">
                            <button type="button" disabled={isPending} onClick={() => decide(r.id, true)} className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] text-white disabled:opacity-50">
                              <CheckCircle2 className="h-3 w-3" /> อนุมัติ
                            </button>
                            <button type="button" disabled={isPending} onClick={() => decide(r.id, false)} className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11px] text-red-600 disabled:opacity-50">
                              <XCircle className="h-3 w-3" /> ไม่อนุมัติ
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-right text-xs text-slate-500">
        {rows.length.toLocaleString('th-TH')} เอกสาร · มูลค่าผลต่าง {totalValue > 0 ? '+' : ''}
        {baht(totalValue)} บาท
      </p>
    </div>
  );
}
