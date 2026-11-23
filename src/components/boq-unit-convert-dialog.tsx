'use client';

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { computeBoqLine } from '@/domain/boq';
import { formatMoneyDisplay } from '@/domain/money';
import { convertRow, estimateSteelWeight } from '@/domain/unit-convert';
import { boqUnitStatus, sameUnit, type UnitReference } from '@/domain/unit-match';
import { toRowInput, type BoqRow } from '@/components/boq-line-grid';

interface Plan {
  id: string;
  on: boolean;
  toUnit: string;
  /** How many of the old unit make one new unit */
  perUnit: string;
  basis: string;
}

/** Rows counted by weight, or in another unit than their register item: these are the ones worth converting */
export function convertCandidates(rows: BoqRow[], unitRef: UnitReference | null): Plan[] {
  const plans: Plan[] = [];
  for (const r of rows) {
    if (r.isCategory || !r.unit.trim()) continue;
    const status = unitRef ? boqUnitStatus(r, unitRef) : { kind: 'ok' as const };
    const byWeight = sameUnit(r.unit, 'กก.') || sameUnit(r.unit, 'ตัน');
    if (status.kind !== 'item-differs' && !byWeight) continue;
    const est = byWeight ? estimateSteelWeight(r.description) : null;
    // One ตัน is 1,000 กก.
    const kg = est ? (sameUnit(r.unit, 'ตัน') ? est.kgPerUnit / 1000 : est.kgPerUnit) : null;
    const toUnit = status.kind === 'item-differs' ? status.itemUnit : (est?.unit ?? '');
    if (!toUnit && !est) continue;
    plans.push({
      id: r.id,
      on: !!toUnit && kg !== null,
      toUnit,
      perUnit: kg !== null ? String(kg) : '',
      basis: est ? `${est.basis} ≈ ${est.kgPerUnit.toLocaleString('th-TH')} กก.` : '',
    });
  }
  return plans;
}

const money = (r: BoqRow) => computeBoqLine(toRowInput(r)).total.toNumber();

/**
 * Converts weight-counted rows (เหล็ก กก.) to the unit they are bought in: quantity ÷ weight per piece,
 * rates × weight per piece, so each row's money stays the same.
 */
export function BoqUnitConvertDialog({
  rows,
  unitRef,
  onApply,
  onClose,
}: {
  rows: BoqRow[];
  unitRef: UnitReference | null;
  onApply: (converted: Map<string, BoqRow>) => void;
  onClose: () => void;
}) {
  const [plans, setPlans] = useState<Plan[]>(() => convertCandidates(rows, unitRef));
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const set = (id: string, patch: Partial<Plan>) => setPlans((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const converted = (p: Plan) => {
    const row = byId.get(p.id)!;
    const per = Number(p.perUnit);
    return p.toUnit.trim() && per > 0 ? convertRow(row, p.toUnit.trim(), per) : null;
  };
  const chosen = plans.filter((p) => p.on && converted(p));
  const before = chosen.reduce((s, p) => s + money(byId.get(p.id)!), 0);
  const after = chosen.reduce((s, p) => s + money(converted(p)!), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="แปลงหน่วยและจำนวน">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white text-xs shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">แปลงหน่วยและจำนวน</h2>
            <p className="mt-0.5 text-slate-600">
              เช่น เหล็ก กก. เป็น เส้น: จำนวนใหม่ = จำนวนเดิม ÷ น้ำหนักต่อเส้น ราคาต่อหน่วย × น้ำหนักต่อเส้น ยอดเงินแต่ละแถวเท่าเดิม ตรวจน้ำหนักต่อหน่วยให้ตรงกับที่ซื้อจริงก่อนกดแปลง
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {plans.length === 0 ? (
            <p className="py-8 text-center text-slate-500">ไม่มีแถวที่นับเป็นน้ำหนัก หรือนับคนละหน่วยกับสินค้าในทะเบียน</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-300 text-left text-slate-700">
                  <th className="w-8 py-1.5" />
                  <th className="py-1.5 pr-2">รายการ</th>
                  <th className="py-1.5 pr-2 text-right">เดิม</th>
                  <th className="w-24 py-1.5 pr-2">หน่วยใหม่</th>
                  <th className="w-40 py-1.5 pr-2">1 หน่วยใหม่ = ? หน่วยเดิม</th>
                  <th className="py-1.5 pr-2 text-right">ใหม่</th>
                  <th className="py-1.5 text-right">ยอดเงิน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => {
                  const row = byId.get(p.id)!;
                  const out = converted(p);
                  return (
                    <tr key={p.id} className={p.on ? '' : 'text-slate-400'}>
                      <td className="py-1.5">
                        <input type="checkbox" checked={p.on} onChange={(e) => set(p.id, { on: e.target.checked })} aria-label={`แปลง ${row.description}`} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="font-medium text-slate-800">{row.description}</div>
                        {p.basis && <div className="text-[11px] text-slate-500">ค่ามาตรฐาน: {p.basis}</div>}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right font-mono">
                        {row.qty === '' ? '-' : row.qty.toLocaleString('th-TH')} {row.unit}
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          value={p.toUnit}
                          onChange={(e) => set(p.id, { toUnit: e.target.value })}
                          list="boq-register-units"
                          aria-label={`หน่วยใหม่ของ ${row.description}`}
                          className="w-full rounded border border-slate-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={p.perUnit}
                            onChange={(e) => set(p.id, { perUnit: e.target.value })}
                            aria-label={`จำนวนหน่วยเดิมต่อ 1 หน่วยใหม่ของ ${row.description}`}
                            className="w-full rounded border border-slate-300 px-1.5 py-1 text-right font-mono"
                          />
                          <span className="whitespace-nowrap text-slate-500">{row.unit}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right font-mono">
                        {out ? `${out.qty === '' ? '-' : out.qty.toLocaleString('th-TH')} ${out.unit}` : '-'}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right font-mono">
                        {formatMoneyDisplay(money(row))}
                        {out && Math.abs(money(out) - money(row)) >= 0.005 && (
                          <div className="text-[11px] text-amber-700">→ {formatMoneyDisplay(money(out))}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          <span className="text-slate-600">
            แปลง {chosen.length} แถว · ยอดเงิน {formatMoneyDisplay(before)} → {formatMoneyDisplay(after)} บาท
            {Math.abs(after - before) >= 0.005 && <span className="text-amber-700"> (ต่างจากปัดเศษ {formatMoneyDisplay(after - before)})</span>}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={chosen.length === 0}
              onClick={() => onApply(new Map(chosen.map((p) => [p.id, converted(p)!])))}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              แปลง {chosen.length} แถว
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
