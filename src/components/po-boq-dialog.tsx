'use client';

import { useMemo, useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { formatMoneyDisplay } from '@/domain/money';
import type { BoqMaterialPick } from '@/components/po-form';

export interface BoqAllocLine {
  description: string;
  unitName: string;
  /** Line amount before VAT, what it takes from the BOQ budget */
  amount: number;
  boqLineId: string;
}

/**
 * ตัดงบ BOQ: choose the BOQ document (main BOQ or an approved VO), then the BOQ line each PO line
 * draws on. A BOQ line can also start a new PO line.
 */
export function PoBoqDialog({
  materials,
  lines,
  onSave,
  onClose,
}: {
  materials: BoqMaterialPick[];
  lines: BoqAllocLine[];
  onSave: (picks: string[], added: { description: string; unitName: string; boqLineId: string }[]) => void;
  onClose: () => void;
}) {
  const sources = useMemo(() => [...new Set(materials.map((m) => m.source ?? 'BOQ หลัก'))], [materials]);
  const firstUsed = materials.find((m) => lines.some((l) => l.boqLineId === m.id))?.source;
  const [source, setSource] = useState(firstUsed ?? (sources.length === 1 ? sources[0]! : ''));
  const [picks, setPicks] = useState(lines.map((l) => l.boqLineId));
  const [added, setAdded] = useState<{ description: string; unitName: string; boqLineId: string }[]>([]);
  const [adding, setAdding] = useState('');
  const options = materials.filter((m) => (m.source ?? 'BOQ หลัก') === source);
  const byId = new Map(materials.map((m) => [m.id, m]));

  const cut = lines.reduce((s, l, i) => s + (picks[i] ? l.amount : 0), 0);
  const chosen = [...new Set([...picks, ...added.map((a) => a.boqLineId)].filter(Boolean))];
  const remainingBudget = chosen.reduce((s, id) => s + (byId.get(id)?.remaining ?? 0), 0);
  const left = remainingBudget - cut;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label="ตัดงบ BOQ">
      <div className="w-full max-w-5xl rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-lg font-semibold text-slate-900">ตัดงบ BOQ</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="ปิด">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6 text-sm">
          <label className="block max-w-md">
            <span className="mb-1 block text-slate-700">เอกสาร BOQ</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-[#2453d4] focus:outline-none">
              <option value="">เลือกเอกสาร BOQ ก่อนเลือกรายการ</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="w-14 px-3 py-2.5 text-left font-semibold">ลำดับ</th>
                  <th className="px-3 py-2.5 text-left font-semibold">รายการในใบสั่งซื้อ</th>
                  <th className="w-[40%] px-3 py-2.5 text-left font-semibold">รายการ BOQ</th>
                  <th className="w-36 px-3 py-2.5 text-right font-semibold">ยอดตั้งต้น</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => {
                  const picked = picks[i] ? byId.get(picks[i]!) : undefined;
                  return (
                    <tr key={i}>
                      <td className="px-3 py-2.5">{i + 1}</td>
                      <td className="px-3 py-2.5">{l.description || `รายการที่ ${i + 1}`}</td>
                      <td className="px-3 py-1.5">
                        <select
                          value={picks[i] ?? ''}
                          onChange={(e) => setPicks((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                          disabled={!source && !picks[i]}
                          aria-label={`รายการ BOQ ของรายการที่ ${i + 1}`}
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                        >
                          <option value="">— ไม่ตัดงบ BOQ —</option>
                          {picked && !options.includes(picked) && <option value={picked.id}>[{picked.source}] {picked.no} {picked.description}</option>}
                          {options.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.no} {b.description} · คงเหลือ {formatMoneyDisplay(b.remaining.toFixed(2))}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-right">{formatMoneyDisplay(l.amount.toFixed(2))}</td>
                    </tr>
                  );
                })}
                {added.map((a, i) => (
                  <tr key={`new-${i}`} className="bg-blue-50/50">
                    <td className="px-3 py-2.5">{lines.length + i + 1}</td>
                    <td className="px-3 py-2.5">
                      {a.description} <span className="text-[11px] text-blue-700">(รายการใหม่)</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{byId.get(a.boqLineId)?.no} {byId.get(a.boqLineId)?.description}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" onClick={() => setAdded((prev) => prev.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                        เอาออก
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2.5 text-xs">
              <div className="flex items-center gap-2">
                <select value={adding} onChange={(e) => setAdding(e.target.value)} disabled={!source} aria-label="เลือกรายการ BOQ เพื่อเพิ่มเป็นรายการใหม่" className="max-w-xs rounded border border-slate-300 px-2 py-1.5 disabled:bg-slate-50">
                  <option value="">เลือกรายการ BOQ…</option>
                  {options.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.no} {b.description}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!adding}
                  onClick={() => {
                    const b = byId.get(adding);
                    if (!b) return;
                    setAdded((prev) => [...prev, { description: b.description, unitName: b.unit, boqLineId: b.id }]);
                    setAdding('');
                  }}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> เพิ่มหมวด BOQ
                </button>
              </div>
              <span className={left < 0 ? 'font-semibold text-red-600' : 'text-slate-600'}>
                ตัดแล้ว {formatMoneyDisplay(cut.toFixed(2))} / คงเหลือ {formatMoneyDisplay(left.toFixed(2))}
                {left < 0 && ' (เกินงบ BOQ ต้องขออนุมัติ)'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
          <span className="text-xs text-slate-400">งบคงเหลือคิดจากใบสั่งซื้อที่ส่งอนุมัติแล้ว</span>
          <button
            type="button"
            onClick={() => onSave(picks, added)}
            className="inline-flex items-center gap-2 rounded-md bg-[#2453d4] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1c43ab]"
          >
            <Save className="h-4 w-4" /> บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}
