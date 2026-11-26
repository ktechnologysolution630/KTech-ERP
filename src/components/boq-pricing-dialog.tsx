'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BadgeDollarSign, Loader2, X } from 'lucide-react';
import type { TakeoffItem } from '@/domain/boq-takeoff';
import type { PriceFrom } from '@/domain/takeoff-pricing';
import { priceTakeoffAction } from '@/app/(app)/boq-takeoff/actions';

/**
 * คิดราคา: fills material and labour rates per unit for the take-off items. Rates come from the
 * company's earlier BOQs and POs first; what was never priced gets an AI estimate of the market rate.
 * Each rate shows where it came from, and nothing changes until the user presses ใช้ราคา.
 */

export interface PriceUpdate {
  id: string;
  materialRate: number | '';
  laborRate: number | '';
  /** Short note of where the rates came from, kept in the item's note */
  priceNote: string;
}

interface Row {
  item: TakeoffItem;
  qty: number;
  material: number | '';
  labor: number | '';
  materialFrom: PriceFrom | null;
  laborFrom: PriceFrom | null;
  aiConfidence?: 'high' | 'medium' | 'low';
  /** Description and unit of the item this one repeats in another unit */
  sameWorkAs?: string;
  picked: boolean;
}

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hasRate = (v: number | '') => v !== '' && v > 0;

const SOURCE: Record<PriceFrom['source'], { label: string; cls: string }> = {
  boq: { label: 'BOQ เดิม', cls: 'bg-emerald-50 text-emerald-700' },
  po: { label: 'ราคาซื้อ PO', cls: 'bg-sky-50 text-sky-700' },
  ai: { label: 'AI ประมาณ', cls: 'bg-amber-50 text-amber-800' },
};

function SourceTag({ from }: { from: PriceFrom | null }) {
  if (!from) return null;
  const s = SOURCE[from.source];
  return (
    <span className={`mt-0.5 block truncate rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`} title={from.label}>
      {s.label}
      {from.source !== 'ai' ? ` · ${from.label.split(':')[0]!.replace(/^(BOQ|PO) /, '')}` : ''}
    </span>
  );
}

/** "ราคา: วัสดุ BOQ-6911-0002, แรง AI ประมาณ" replacing any earlier price note */
export function withPriceNote(note: string, priceNote: string): string {
  const rest = note
    .split(' · ')
    .filter((p) => p.trim() && !p.startsWith('ราคา:'))
    .join(' · ');
  return [rest, priceNote].filter(Boolean).join(' · ').slice(0, 500);
}

const sourceNote = (what: string, from: PriceFrom | null) => (from ? `${what} ${from.source === 'ai' ? 'AI ประมาณ' : from.label.split(':')[0]}` : '');

export function PricingDialog({ takeoffId, items, quantities, focusIds, onApply, onClose }: {
  takeoffId: string;
  items: TakeoffItem[];
  quantities: Map<string, { qty: number }>;
  /** Items just added (from ถอดแบบอัตโนมัติ / AI): only these start ticked */
  focusIds?: string[];
  onApply: (updates: PriceUpdate[]) => void;
  onClose: () => void;
}) {
  const [useAi, setUseAi] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [hint, setHint] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    items.filter((item) => !focusIds || focusIds.includes(item.id)).map((item) => ({
      item,
      qty: quantities.get(item.id)?.qty ?? 0,
      material: item.materialRate,
      labor: item.laborRate,
      materialFrom: null,
      laborFrom: null,
      picked: false,
    })),
  );

  const run = async () => {
    setRunning(true);
    setError(null);
    setInfo(null);
    const focus = focusIds ? new Set(focusIds) : null;
    const target = items.filter((i) => i.description.trim() && (!focus || focus.has(i.id)));
    const res = await priceTakeoffAction(takeoffId, {
      items: target.slice(0, 500).map((i) => ({ key: i.id, category: i.category.slice(0, 200), description: i.description.slice(0, 1000), unit: i.unit.slice(0, 50) })),
      useAi,
      hint: hint.trim() || undefined,
    }).catch(() => ({ ok: false as const, error: 'คิดราคาไม่สำเร็จ (การเชื่อมต่อขัดข้อง)' }));
    setRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const byId = new Map(res.result.items.map((p) => [p.key, p]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    setRows((rs) =>
      rs.map((r) => {
        const p = byId.get(r.item.id);
        if (!p) return r;
        const keepMaterial = !overwrite && hasRate(r.item.materialRate);
        const keepLabor = !overwrite && hasRate(r.item.laborRate);
        const material = keepMaterial ? r.item.materialRate : (p.materialRate ?? r.item.materialRate);
        const labor = keepLabor ? r.item.laborRate : (p.laborRate ?? r.item.laborRate);
        const changed = material !== r.item.materialRate || labor !== r.item.laborRate;
        const twin = p.sameWorkAs ? itemById.get(p.sameWorkAs) : undefined;
        if (twin) return { ...r, sameWorkAs: `${twin.description} (${twin.unit})`, materialFrom: null, laborFrom: null, picked: false };
        return {
          ...r,
          material,
          labor,
          materialFrom: keepMaterial ? null : p.materialFrom,
          laborFrom: keepLabor ? null : p.laborFrom,
          aiConfidence: p.aiConfidence,
          picked: changed,
        };
      }),
    );
    const found = res.result.items.filter((p) => p.materialFrom?.source !== 'ai' && p.materialFrom).length;
    const ai = res.result.items.filter((p) => p.materialFrom?.source === 'ai' || p.laborFrom?.source === 'ai').length;
    setInfo(`เทียบกับราคาเดิมในระบบ ${res.result.refCount.toLocaleString()} รายการ: พบราคาวัสดุจาก BOQ/PO ${found} รายการ${useAi ? ` · AI ประมาณราคาให้ ${ai} รายการ` : ''}`);
    if (res.result.aiError) setError(`ใช้ได้เฉพาะราคาเดิมในระบบ: ${res.result.aiError}`);
  };

  // Pricing starts as soon as the dialog opens; the options can be changed and run again
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (id: string, patch: Partial<Row>) => setRows((x) => x.map((r) => (r.item.id === id ? { ...r, ...patch } : r)));
  const amount = (r: Row) => Math.max(0, r.qty) * ((r.material === '' ? 0 : r.material) + (r.labor === '' ? 0 : r.labor));
  const totals = useMemo(() => {
    let material = 0;
    let labor = 0;
    for (const r of rows) {
      const q = Math.max(0, r.qty);
      material += q * (r.material === '' ? 0 : r.material);
      labor += q * (r.labor === '' ? 0 : r.labor);
    }
    return { material, labor };
  }, [rows]);
  const picked = rows.filter((r) => r.picked);
  const missing = rows.filter((r) => !hasRate(r.material) && !hasRate(r.labor)).length;
  const rate = (raw: string): number | '' => (raw.trim() === '' || !Number.isFinite(Number(raw)) ? '' : Math.max(0, Number(raw)));

  const apply = () =>
    onApply(
      picked.map((r) => ({
        id: r.item.id,
        materialRate: r.material,
        laborRate: r.labor,
        priceNote: (() => {
          const parts = [sourceNote('วัสดุ', r.materialFrom), sourceNote('แรง', r.laborFrom)].filter(Boolean);
          return parts.length ? `ราคา: ${parts.join(', ')}` : '';
        })(),
      })),
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="คิดราคาวัสดุและค่าแรง">
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <BadgeDollarSign className="h-4 w-4 text-emerald-600" /> คิดราคาวัสดุและค่าแรง
          </h3>
          <button type="button" onClick={onClose} disabled={running} className="text-slate-400 hover:text-slate-600 disabled:opacity-40" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <p className="text-slate-600">
            ระบบหาราคาต่อหน่วยจาก <b>BOQ ของโครงการเดิม</b> (ได้ทั้งค่าวัสดุและค่าแรง) และ <b>ราคาซื้อล่าสุดใน PO</b> (ค่าวัสดุ ไม่รวม VAT) โดยเทียบชื่องาน ขนาด และหน่วย
            รายการที่ไม่เคยมีราคาให้ <b>AI ประมาณราคาตลาด</b> (ติดป้ายสีเหลือง ควรตรวจก่อนใช้) แก้ตัวเลขในตารางได้ก่อนกดใช้ราคา
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-1.5 text-slate-700">
              <input type="checkbox" checked={useAi} disabled={running} onChange={(e) => setUseAi(e.target.checked)} /> ให้ AI ประมาณราคาที่ไม่มีในระบบ
            </label>
            <label className="flex items-center gap-1.5 text-slate-700">
              <input type="checkbox" checked={overwrite} disabled={running} onChange={(e) => setOverwrite(e.target.checked)} /> คิดใหม่ทับราคาที่กรอกไว้แล้ว
            </label>
            <label className="min-w-[16rem] flex-1">
              <span className="text-slate-600">ข้อมูลเพิ่มให้ AI (ไม่บังคับ)</span>
              <input value={hint} disabled={running} onChange={(e) => setHint(e.target.value)} maxLength={1000} placeholder="เช่น งานต่างจังหวัด ภาคตะวันออก, คอนกรีต 240 ksc" className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </label>
            <button type="button" onClick={() => void run()} disabled={running} className="flex items-center gap-1 rounded-lg border border-emerald-600 px-3 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeDollarSign className="h-3.5 w-3.5" />}
              {running ? 'กำลังคิดราคา…' : 'คิดราคาใหม่'}
            </button>
          </div>
          {running && (
            <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังหาราคาจาก BOQ/PO เดิม{useAi ? ' และให้ AI ประมาณราคาที่ไม่มี (ประมาณ 1–2 นาที)' : ''}…
            </p>
          )}
          {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">{info}</p>}
          {error && (
            <p className="flex items-start gap-1 rounded-lg bg-red-50 px-3 py-2 font-semibold text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[60rem]">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="w-8 px-2 py-2">
                    <input type="checkbox" checked={rows.length > 0 && rows.every((r) => r.picked)} onChange={(e) => setRows((x) => x.map((r) => ({ ...r, picked: e.target.checked })))} aria-label="เลือกทั้งหมด" />
                  </th>
                  <th className="px-2 py-2">รายการ</th>
                  <th className="px-2 py-2 text-right">ปริมาณ</th>
                  <th className="px-2 py-2">หน่วย</th>
                  <th className="w-36 px-2 py-2 text-right">ค่าวัสดุ/หน่วย</th>
                  <th className="w-36 px-2 py-2 text-right">ค่าแรง/หน่วย</th>
                  <th className="px-2 py-2 text-right">รวมเงิน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.item.id} className={r.picked ? '' : 'opacity-60'}>
                    <td className="px-2 py-1.5 align-top">
                      <input type="checkbox" checked={r.picked} onChange={(e) => update(r.item.id, { picked: e.target.checked })} aria-label={`ใช้ราคา ${r.item.description}`} />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <span className="block font-semibold text-slate-900">{r.item.description}</span>
                      <span className="text-slate-500">{r.item.category}</span>
                      {r.aiConfidence === 'low' && <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">AI ไม่แน่ใจ ควรตรวจ</span>}
                      {r.sameWorkAs && (
                        <span className="mt-0.5 block rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">
                          งานเดียวกับ “{r.sameWorkAs}” คนละหน่วย ไม่คิดราคาซ้ำ (ไม่ติ๊กไว้) ควรลบรายการนี้ออกจาก BOQ
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right align-top font-mono">{fmt(Math.max(0, r.qty))}</td>
                    <td className="px-2 py-1.5 align-top">{r.item.unit}</td>
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={r.material}
                        onChange={(e) => update(r.item.id, { material: rate(e.target.value), materialFrom: null, picked: true })}
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-right"
                        aria-label="ค่าวัสดุต่อหน่วย"
                      />
                      <SourceTag from={r.materialFrom} />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={r.labor}
                        onChange={(e) => update(r.item.id, { labor: rate(e.target.value), laborFrom: null, picked: true })}
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-right"
                        aria-label="ค่าแรงต่อหน่วย"
                      />
                      <SourceTag from={r.laborFrom} />
                    </td>
                    <td className="px-2 py-1.5 text-right align-top font-mono font-semibold">{fmt(amount(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <span className="text-slate-600">
            ค่าวัสดุ <b className="font-mono text-slate-900">{fmt(totals.material)}</b> + ค่าแรง <b className="font-mono text-slate-900">{fmt(totals.labor)}</b> = รวม{' '}
            <b className="font-mono text-sm text-slate-900">{fmt(totals.material + totals.labor)}</b> บาท
            {missing > 0 && <span className="ml-2 font-semibold text-amber-700">ยังไม่มีราคา {missing} รายการ</span>}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={running} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              ปิด
            </button>
            <button type="button" onClick={apply} disabled={running || picked.length === 0} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              ใช้ราคา {picked.length} รายการ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
