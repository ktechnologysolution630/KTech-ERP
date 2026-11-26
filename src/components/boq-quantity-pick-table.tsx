'use client';

import React from 'react';
import type { ArchicadRow } from '@/domain/archicad-bridge';
import type { ExistingItem } from '@/domain/ai-takeoff-merge';

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 });

/** Quantities from a BIM model to tick before adding them to the take-off */
export function QuantityPickTable({
  rows,
  picked,
  already,
  onPick,
}: {
  rows: ArchicadRow[];
  picked: boolean[];
  already: (ExistingItem | null)[];
  onPick: (next: boolean[]) => void;
}) {
  const allOn = rows.length > 0 && picked.every(Boolean);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="w-8 px-2 py-1.5">
              <input type="checkbox" checked={allOn} onChange={() => onPick(rows.map(() => !allOn))} aria-label="เลือกทั้งหมด" />
            </th>
            <th className="px-2 py-1.5">หมวด</th>
            <th className="px-2 py-1.5">รายการ</th>
            <th className="px-2 py-1.5 text-right">จำนวน</th>
            <th className="px-2 py-1.5">หน่วย</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="px-2 py-1.5">
                <input type="checkbox" checked={picked[i] ?? false} onChange={() => onPick(picked.map((v, j) => (j === i ? !v : v)))} aria-label={`เลือก ${r.description}`} />
              </td>
              <td className="px-2 py-1.5 text-slate-500">{r.category}</td>
              <td className="px-2 py-1.5">
                <span className="font-semibold text-slate-900">{r.description}</span>
                {already[i] && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">มีในงานถอดแบบแล้ว: {already[i]!.description}</span>}
                <span className="block text-slate-400">{r.note}</span>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.qty)}</td>
              <td className="px-2 py-1.5">{r.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
