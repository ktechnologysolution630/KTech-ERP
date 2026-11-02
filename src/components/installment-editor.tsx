'use client';

import { type InstallmentCondition } from '@/db/schema';
import { D, sum } from '@/domain/money';

export interface InstallmentRowState {
  name: string;
  percent: string;
  condition: InstallmentCondition;
  conditionNote: string;
}

const CONDITION_LABELS: Record<InstallmentCondition, string> = {
  BEFORE_PRODUCTION: 'ก่อนผลิต',
  BEFORE_DELIVERY: 'ก่อนส่งของ',
  AFTER_DELIVERY: 'หลังรับของ',
  OTHER: 'อื่นๆ',
};

export function InstallmentEditor({
  rows,
  onChange,
  grossTotal,
}: {
  rows: InstallmentRowState[];
  onChange: (next: InstallmentRowState[]) => void;
  grossTotal: string;
}) {
  const pctSum = sum(rows.map((r) => D(r.percent || 0)));
  const grossDec = D(grossTotal || 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">ตารางแบ่งจ่ายเป็นงวด (%)</h4>
          <p className="text-xs text-slate-500">
            ผลรวมปัจจุบัน:{' '}
            <strong className={pctSum.equals(100) ? 'text-emerald-700' : 'text-red-600'}>
              {pctSum.toFixed(2)}%
            </strong>{' '}
            (ต้องเท่ากับ 100%)
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...rows,
              {
                name: `งวดที่ ${rows.length + 1}`,
                percent: '10',
                condition: 'AFTER_DELIVERY',
                conditionNote: '',
              },
            ])
          }
          className="rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          + เพิ่มงวด
        </button>
      </div>

      {rows.map((row, idx) => {
        const estAmt = grossDec.times(D(row.percent || 0)).div(100).toFixed(2);
        return (
          <div
            key={idx}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-white rounded-lg border border-slate-200 p-2.5 items-end"
          >
            <div className="sm:col-span-3">
              <label className="block text-[11px] text-slate-500">ชื่องวด *</label>
              <input
                type="text"
                value={row.name}
                onChange={(e) =>
                  onChange(rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))
                }
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500">เปอร์เซ็นต์ (%) *</label>
              <input
                type="number"
                step="0.01"
                value={row.percent}
                onChange={(e) =>
                  onChange(
                    rows.map((r, i) => (i === idx ? { ...r, percent: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 px-2 py-1 text-right text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500">ยอดเงิน (บาท)</label>
              <div className="px-2 py-1 text-right text-xs font-medium text-slate-700 bg-slate-50 rounded border border-slate-200">
                {estAmt}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500">เงื่อนไข</label>
              <select
                value={row.condition}
                onChange={(e) =>
                  onChange(
                    rows.map((r, i) =>
                      i === idx
                        ? { ...r, condition: e.target.value as InstallmentCondition }
                        : r,
                    ),
                  )
                }
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              >
                {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500">รายละเอียดเงื่อนไข</label>
              <input
                type="text"
                value={row.conditionNote}
                onChange={(e) =>
                  onChange(
                    rows.map((r, i) =>
                      i === idx ? { ...r, conditionNote: e.target.value } : r,
                    ),
                  )
                }
                placeholder="หมายเหตุงวด"
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </div>

            <div className="sm:col-span-1 text-right">
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                  className="text-xs text-red-600 hover:underline py-1"
                >
                  ลบ
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
