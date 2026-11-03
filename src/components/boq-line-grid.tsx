'use client';

import React from 'react';
import { computeBoqLine, computeBoqTotals, type BoqRowInput } from '@/domain/boq';
import type { BoqDocumentDto, SaveBoqInput } from '@/server/services/boq';

export interface BoqRow {
  id: string;
  isCategory?: boolean;
  isBold?: boolean;
  no: string;
  description: string;
  qty: number | '';
  unit: string;
  matRate: number | '';
  labRate: number | '';
  note: string;
}

export function newRowId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function rowsFromDto(boq: BoqDocumentDto | null): BoqRow[] {
  return (boq?.lines ?? []).map((l) => ({
    id: l.id,
    isCategory: l.isCategory,
    isBold: l.isBold,
    no: l.no,
    description: l.description,
    qty: l.qty,
    unit: l.unit,
    matRate: l.materialRate,
    labRate: l.laborRate,
    note: l.note,
  }));
}

export function toRowInput(r: BoqRow): BoqRowInput {
  return { isCategory: !!r.isCategory, qty: r.qty, materialRate: r.matRate, laborRate: r.labRate };
}

/** Grid rows → the `lines` payload of a BOQ save. */
export function rowsToLines(rows: BoqRow[]): SaveBoqInput['lines'] {
  return rows.map((r) => ({
    id: r.id,
    isCategory: !!r.isCategory,
    isBold: !!r.isBold,
    no: r.no,
    description: r.description,
    qty: r.qty,
    unit: r.unit,
    materialRate: r.matRate,
    laborRate: r.labRate,
    note: r.note,
  }));
}

export function makeCategoryRow(existing: BoqRow[]): BoqRow {
  const n = existing.filter((r) => r.isCategory).length + 1;
  return {
    id: newRowId(),
    isCategory: true,
    isBold: true,
    no: `${n}`,
    description: `หมวดงานที่ ${n}. (ระบุชื่อหมวดงาน)`,
    qty: '',
    unit: '',
    matRate: '',
    labRate: '',
    note: '',
  };
}

export function makeItemRow(description = 'รายการงานก่อสร้างใหม่'): BoqRow {
  return { id: newRowId(), isCategory: false, isBold: false, no: '', description, qty: 1, unit: 'หน่วย', matRate: 0, labRate: 0, note: '' };
}

export function makeSubItemRow(): BoqRow {
  return makeItemRow('  └ รายการย่อย');
}

export function formatBaht(val: number): string {
  if (val === 0) return '-';
  return val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface BoqLineGridProps {
  rows: BoqRow[];
  onRowsChange: (update: (prev: BoqRow[]) => BoqRow[]) => void;
  selectedRowId: string | null;
  onSelectRow: (id: string) => void;
  overheadPercent: number;
  onOverheadPercentChange: (v: number) => void;
  discountAmount: number;
  onDiscountAmountChange: (v: number) => void;
  vatPercent: number;
  /** Omit to show VAT read-only (e.g. when the VAT % is set elsewhere on the form) */
  onVatPercentChange?: (v: number) => void;
  remarks: string;
  onRemarksChange: (v: string) => void;
  emptyHint?: React.ReactNode;
}

/**
 * The Thai BOQ table (material/labour columns) with its footer: overhead → discount → VAT →
 * grand total. Fully controlled; wrap in a disabled fieldset for read-only use.
 */
export function BoqLineGrid({
  rows,
  onRowsChange,
  selectedRowId,
  onSelectRow,
  overheadPercent,
  onOverheadPercentChange,
  discountAmount,
  onDiscountAmountChange,
  vatPercent,
  onVatPercentChange,
  remarks,
  onRemarksChange,
  emptyHint,
}: BoqLineGridProps) {
  const updateRow = <K extends keyof BoqRow>(id: string, field: K, value: BoqRow[K]) =>
    onRowsChange((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const deleteRow = (id: string) => onRowsChange((prev) => prev.filter((r) => r.id !== id));

  // Decimal arithmetic, same rules the server stores
  const totals = computeBoqTotals({ rows: rows.map(toRowInput), overheadPercent, discountAmount, vatPercent });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-400 font-semibold text-slate-800 text-center">
              <th rowSpan={2} className="border-r border-slate-400 py-2 px-2 w-12">ลำดับ</th>
              <th rowSpan={2} className="border-r border-slate-400 py-2 px-4 text-center min-w-[260px]">รายการ</th>
              <th rowSpan={2} className="border-r border-slate-400 py-2 px-2 w-16">จำนวน</th>
              <th rowSpan={2} className="border-r border-slate-400 py-2 px-2 w-14">หน่วย</th>
              <th colSpan={2} className="border-r border-slate-400 py-1 px-2 border-b">ค่าวัสดุสิ่งของ</th>
              <th colSpan={2} className="border-r border-slate-400 py-1 px-2 border-b">ค่าแรง</th>
              <th rowSpan={2} className="border-r border-slate-400 py-2 px-2 w-28 text-center">
                ค่าวัสดุและค่าแรง
                <br />
                รวมเป็นเงิน
              </th>
              <th rowSpan={2} className="border-r border-slate-400 py-2 px-2 w-24">หมายเหตุ</th>
              <th rowSpan={2} className="py-2 px-1 w-8 text-center text-slate-400 print:hidden">✕</th>
            </tr>
            <tr className="bg-slate-100 border-b-2 border-slate-600 text-center text-[11px] font-semibold text-slate-700">
              <th className="border-r border-slate-400 py-1 px-2 w-24">ราคา/หน่วยละ</th>
              <th className="border-r border-slate-400 py-1 px-2 w-24">จำนวนเงิน</th>
              <th className="border-r border-slate-400 py-1 px-2 w-24">ราคา/หน่วยละ</th>
              <th className="border-r border-slate-400 py-1 px-2 w-24">จำนวนเงิน</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-300">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-10 text-center text-slate-400">
                  {emptyHint ?? (
                    <>
                      ยังไม่มีรายการใน BOQ คลิกที่ปุ่ม <strong className="text-slate-600">+ หมวด BOQ</strong> หรือ{' '}
                      <strong className="text-slate-600">+ รายการ</strong> เพื่อเริ่มสร้าง
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isSelected = selectedRowId === r.id;
                if (r.isCategory) {
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onSelectRow(r.id)}
                      className={`bg-slate-50/90 hover:bg-slate-100 transition cursor-pointer font-bold ${
                        isSelected ? 'ring-2 ring-blue-500 inset-0' : ''
                      }`}
                    >
                      <td className="border-r border-slate-300 py-2 px-2 text-center font-mono">
                        <input
                          type="text"
                          aria-label="ลำดับหมวด"
                          value={r.no}
                          onChange={(e) => updateRow(r.id, 'no', e.target.value)}
                          className="w-full text-center bg-transparent focus:bg-white focus:outline-hidden font-bold"
                        />
                      </td>
                      <td colSpan={9} className="border-r border-slate-300 py-2 px-3 text-slate-900">
                        <input
                          type="text"
                          aria-label="ชื่อหมวด"
                          value={r.description}
                          onChange={(e) => updateRow(r.id, 'description', e.target.value)}
                          className="w-full bg-transparent focus:bg-white focus:outline-hidden font-bold text-slate-900"
                        />
                      </td>
                      <td className="py-2 px-1 text-center print:hidden">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRow(r.id);
                          }}
                          className="text-slate-400 hover:text-red-600 p-0.5 rounded"
                          title="ลบหมวดหมู่นี้"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                }

                const amounts = computeBoqLine(toRowInput(r));
                const numberCell = (field: 'qty' | 'matRate' | 'labRate', label: string, align: string) => (
                  <input
                    type="number"
                    min={0}
                    aria-label={label}
                    value={r[field]}
                    onChange={(e) => updateRow(r.id, field, e.target.value === '' ? '' : Number(e.target.value))}
                    className={`w-full ${align} bg-transparent focus:bg-white focus:outline-hidden font-mono`}
                  />
                );
                return (
                  <tr
                    key={r.id}
                    onClick={() => onSelectRow(r.id)}
                    className={`hover:bg-blue-50/40 transition cursor-pointer ${isSelected ? 'bg-blue-50/70' : ''} ${
                      r.isBold ? 'font-bold' : ''
                    }`}
                  >
                    <td className="border-r border-slate-300 py-1.5 px-2 text-center font-mono text-slate-600">
                      <input
                        type="text"
                        aria-label="ลำดับ"
                        value={r.no}
                        onChange={(e) => updateRow(r.id, 'no', e.target.value)}
                        className="w-full text-center bg-transparent focus:bg-white focus:outline-hidden"
                      />
                    </td>
                    <td className="border-r border-slate-300 py-1.5 px-3 text-slate-800">
                      <input
                        type="text"
                        aria-label="รายการ"
                        placeholder="ระบุวัสดุ สิ่งของ หรืองานค่าแรง"
                        value={r.description}
                        onChange={(e) => updateRow(r.id, 'description', e.target.value)}
                        className="w-full bg-transparent focus:bg-white focus:outline-hidden"
                      />
                    </td>
                    <td className="border-r border-slate-300 py-1.5 px-2 text-center font-mono">{numberCell('qty', 'จำนวน', 'text-center')}</td>
                    <td className="border-r border-slate-300 py-1.5 px-2 text-center text-slate-600">
                      <input
                        type="text"
                        aria-label="หน่วย"
                        value={r.unit}
                        onChange={(e) => updateRow(r.id, 'unit', e.target.value)}
                        className="w-full text-center bg-transparent focus:bg-white focus:outline-hidden"
                      />
                    </td>
                    <td className="border-r border-slate-300 py-1.5 px-2 text-right font-mono">{numberCell('matRate', 'ค่าวัสดุต่อหน่วย', 'text-right')}</td>
                    <td className="border-r border-slate-300 py-1.5 px-2 text-right font-mono text-slate-700 bg-slate-50/50">
                      {formatBaht(amounts.material.toNumber())}
                    </td>
                    <td className="border-r border-slate-300 py-1.5 px-2 text-right font-mono">{numberCell('labRate', 'ค่าแรงต่อหน่วย', 'text-right')}</td>
                    <td className="border-r border-slate-300 py-1.5 px-2 text-right font-mono text-slate-700 bg-slate-50/50">
                      {formatBaht(amounts.labor.toNumber())}
                    </td>
                    <td className="border-r border-slate-300 py-1.5 px-2 text-right font-mono font-bold text-slate-900 bg-slate-50">
                      {formatBaht(amounts.total.toNumber())}
                    </td>
                    <td className="border-r border-slate-300 py-1.5 px-2 text-slate-500">
                      <input
                        type="text"
                        aria-label="หมายเหตุรายการ"
                        value={r.note}
                        onChange={(e) => updateRow(r.id, 'note', e.target.value)}
                        className="w-full bg-transparent focus:bg-white focus:outline-hidden"
                      />
                    </td>
                    <td className="py-1.5 px-1 text-center print:hidden">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRow(r.id);
                        }}
                        className="text-slate-400 hover:text-red-600 p-0.5 rounded"
                        title="ลบแถวนี้"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })
            )}

            <tr className="bg-slate-100 border-t-2 border-slate-700 font-bold">
              <td className="border-r border-slate-400 py-2.5 px-2 text-center" />
              <td className="border-r border-slate-400 py-2.5 px-4 text-center font-bold text-slate-900">ยอดรวมทั้งหมด</td>
              <td className="border-r border-slate-400 py-2.5 px-2" />
              <td className="border-r border-slate-400 py-2.5 px-2" />
              <td className="border-r border-slate-400 py-2.5 px-2 text-right text-slate-400">-</td>
              <td className="border-r border-slate-400 py-2.5 px-2 text-right font-mono font-bold text-slate-900">
                {formatBaht(totals.materialTotal.toNumber())}
              </td>
              <td className="border-r border-slate-400 py-2.5 px-2 text-right text-slate-400">-</td>
              <td className="border-r border-slate-400 py-2.5 px-2 text-right font-mono font-bold text-slate-900">
                {formatBaht(totals.laborTotal.toNumber())}
              </td>
              <td className="border-r border-slate-400 py-2.5 px-2 text-right font-mono font-bold text-slate-900">
                {formatBaht(totals.directCost.toNumber())}
              </td>
              <td className="border-r border-slate-400 py-2.5 px-2" />
              <td className="py-2.5 px-1 print:hidden" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 border-t-2 border-slate-700">
        <div className="md:col-span-6 p-4 border-b md:border-b-0 md:border-r border-slate-400 space-y-2">
          <span className="font-bold text-slate-800 block">หมายเหตุ</span>
          <textarea
            rows={5}
            aria-label="หมายเหตุ BOQ"
            value={remarks}
            onChange={(e) => onRemarksChange(e.target.value)}
            className="w-full p-2 border border-slate-300 rounded text-xs focus:border-blue-600 focus:outline-hidden font-sans leading-relaxed text-slate-700"
            placeholder="ระบุหมายเหตุ เงื่อนไขการชำระเงิน หรือการรับประกันผลงาน..."
          />
        </div>

        <div className="md:col-span-6 divide-y divide-slate-300 text-xs">
          <div className="flex items-center justify-between p-2.5 px-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-700">ค่าดำเนินการ และผลกำไร</span>
              <div className="flex items-center gap-1 font-mono text-[11px]">
                <span>(</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  aria-label="ค่าดำเนินการ (%)"
                  value={overheadPercent}
                  onChange={(e) => onOverheadPercentChange(Number(e.target.value))}
                  className="w-10 text-center border border-slate-300 rounded py-0.5"
                />
                <span>%)</span>
              </div>
            </div>
            <span className="font-mono font-medium text-slate-800">{formatBaht(totals.overheadAmount.toNumber())}</span>
          </div>

          <div className="flex items-center justify-between p-2.5 px-4 bg-slate-50/50">
            <span className="font-bold text-slate-800">รวม</span>
            <span className="font-mono font-bold text-slate-900">{formatBaht(totals.subtotal.toNumber())}</span>
          </div>

          <div className="flex items-center justify-between p-2.5 px-4">
            <span className="font-bold text-red-600">ส่วนลด</span>
            <div className="flex items-center gap-1 font-mono">
              <input
                type="number"
                min="0"
                aria-label="ส่วนลด"
                value={discountAmount}
                onChange={(e) => onDiscountAmountChange(Number(e.target.value))}
                placeholder="0.00"
                className="w-24 text-right border border-red-200 rounded py-0.5 px-1.5 text-red-600 font-mono"
              />
              <span className="text-red-600">{discountAmount > 0 ? `-${formatBaht(discountAmount)}` : '-'}</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-2.5 px-4 bg-slate-50/50">
            <span className="font-medium text-slate-700">ราคาหลังหักส่วนลด</span>
            <span className="font-mono font-semibold text-slate-800">{formatBaht(totals.afterDiscount.toNumber())}</span>
          </div>

          <div className="flex items-center justify-between p-2.5 px-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-700">ภาษีมูลค่าเพิ่ม</span>
              {onVatPercentChange ? (
                <select
                  aria-label="ภาษีมูลค่าเพิ่ม (%)"
                  value={vatPercent}
                  onChange={(e) => onVatPercentChange(Number(e.target.value))}
                  className="px-2 py-0.5 border border-slate-300 rounded font-mono text-[11px]"
                >
                  <option value={7}>7%</option>
                  <option value={0}>0% (ยกเว้นภาษี)</option>
                </select>
              ) : (
                <span className="font-mono text-[11px] text-slate-600">{vatPercent}%</span>
              )}
            </div>
            <span className="font-mono font-medium text-slate-800">{formatBaht(totals.vatAmount.toNumber())}</span>
          </div>

          <div className="flex items-center justify-between p-3.5 px-4 bg-[#102d72] text-white">
            <span className="font-bold text-sm tracking-wide">สรุปรวมราคาทั้งสิ้น</span>
            <span className="font-mono font-bold text-base tracking-tight">฿{formatBaht(totals.grandTotal.toNumber())}</span>
          </div>
        </div>
      </div>
    </>
  );
}
