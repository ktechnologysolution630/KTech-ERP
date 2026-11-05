'use client';

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { computeBoqTotals } from '@/domain/boq';
import type { BoqImportResult, ImportedBoqLine } from '@/domain/boq-import';
import { formatMoneyDisplay } from '@/domain/money';
import { formatDateText } from '@/domain/thai';

const sameText = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
const MAX_LISTED = 5;

function RowList({ rows }: { rows: string[] }) {
  return (
    <ul className="mt-1 list-disc pl-4 font-normal">
      {rows.slice(0, MAX_LISTED).map((r) => (
        <li key={r}>{r}</li>
      ))}
      {rows.length > MAX_LISTED && <li>และอีก {rows.length - MAX_LISTED} แถว</li>}
    </ul>
  );
}

const directCostOf = (lines: ImportedBoqLine[]) =>
  computeBoqTotals({ rows: lines.map((l) => ({ isCategory: l.isCategory, qty: l.qty, materialRate: l.matRate, laborRate: l.labRate })), overheadPercent: 0, discountAmount: 0, vatPercent: 0 }).directCost.toNumber();

function PriceChoice({ checked, onSelect, title, total, children }: { checked: boolean; onSelect: () => void; title: string; total: number; children: React.ReactNode }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${checked ? 'border-emerald-500 bg-emerald-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
      <input type="radio" name="boq-price" checked={checked} onChange={onSelect} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold text-slate-900">{title}</span>
          <span className="font-mono font-semibold text-slate-900">{formatMoneyDisplay(total)} บาท</span>
        </span>
        <span className="mt-0.5 block text-slate-600">{children}</span>
      </span>
    </label>
  );
}

/** What the import found, shown before anything enters the BOQ, so a wrong file or a misread sheet is caught here. */
export function BoqImportDialog({
  fileName,
  result,
  currentProjectName,
  hasExistingRows,
  onImport,
  onClose,
}: {
  fileName: string;
  result: BoqImportResult;
  currentProjectName: string;
  hasExistingRows: boolean;
  onImport: (mode: 'append' | 'replace', atOfferPrice: boolean) => void;
  onClose: () => void;
}) {
  const { lines, offerLines, usedSheets, skippedSheets, meta, unpricedItems, amountMismatches, unreadable } = result;
  const [atOfferPrice, setAtOfferPrice] = useState(false);
  const items = usedSheets.reduce((n, s) => n + s.items, 0);
  const categories = usedSheets.reduce((n, s) => n + s.categories, 0);
  const otherProject = meta.projectName !== '' && !sameText(meta.projectName, currentProjectName);
  const details = [
    ['โครงการในไฟล์', meta.projectName],
    ['เจ้าของ', meta.owner],
    ['สถานที่ก่อสร้าง', meta.location],
    ['วันที่ประมาณราคา', formatDateText(meta.estimateDate)],
  ].filter(([, value]) => value);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="ตรวจสอบก่อนนำเข้า BOQ">
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">ตรวจสอบก่อนนำเข้า BOQ</h3>
            <p className="truncate text-slate-500">{fileName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            พบ {items.toLocaleString()} รายการ ใน {categories.toLocaleString()} หมวด รวม {lines.length.toLocaleString()} แถว
          </div>

          <table className="w-full">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">ชีตที่ใช้</th>
                <th className="px-3 py-1.5 text-right font-medium">หมวด</th>
                <th className="px-3 py-1.5 text-right font-medium">รายการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usedSheets.map((s) => (
                <tr key={s.name}>
                  <td className="px-3 py-1.5 text-slate-800">{s.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{s.categories.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{s.items.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {skippedSheets.length > 0 && <p className="text-slate-500">ไม่ได้ใช้ เพราะไม่ใช่ตารางรายการ BOQ: {skippedSheets.join(', ')}</p>}

          {details.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2">
              {details.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-slate-800">{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {otherProject && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-semibold text-amber-900">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>ชื่อโครงการในไฟล์ไม่ตรงกับโครงการนี้ ({currentProjectName}) กรุณาตรวจว่าเลือกไฟล์ถูกต้อง</span>
            </p>
          )}
          {offerLines && (
            <fieldset className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
              <legend className="px-1 font-semibold text-slate-800">ไฟล์นี้มีราคา 2 แบบ เลือกแบบที่จะใช้</legend>
              <PriceChoice checked={!atOfferPrice} onSelect={() => setAtOfferPrice(false)} title="ค่างานต้นทุน" total={directCostOf(lines)}>
                ใช้คุมงบประมาณในการซื้อและจ้าง ยังไม่รวม Factor F และภาษี
              </PriceChoice>
              <PriceChoice checked={atOfferPrice} onSelect={() => setAtOfferPrice(true)} title="ราคาต่อหน่วยตามคำเสนอ" total={directCostOf(offerLines)}>
                ตรงกับราคาที่ชนะการจัดจ้าง รวม Factor F และภาษีแล้ว ระบบจะตั้งภาษีมูลค่าเพิ่มของ BOQ เป็น 0% เพื่อไม่ให้คิดภาษีซ้ำ
              </PriceChoice>
              <p className="text-slate-500">ไฟล์นี้ไม่แยกค่าวัสดุกับค่าแรง ราคาจึงลงในช่องค่าวัสดุ ยกเว้นรายการที่ชื่อขึ้นต้นด้วย &quot;ค่าแรง&quot; ซึ่งลงในช่องค่าแรง ยอดรวมอาจต่างจากในไฟล์เล็กน้อย เพราะราคาต่อหน่วยเก็บทศนิยม 2 ตำแหน่ง</p>
            </fieldset>
          )}
          {unpricedItems > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {unpricedItems.toLocaleString()} จาก {items.toLocaleString()} รายการในไฟล์ไม่มีราคาวัสดุและค่าแรง จึงนำเข้าได้เฉพาะจำนวนและหน่วย ยอดรวมจะยังไม่ครบจนกว่าจะกรอกราคา
              </span>
            </p>
          )}
          {amountMismatches.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-semibold text-amber-900">
              จำนวนเงินในไฟล์ไม่ตรงกับ จำนวน × ราคา {amountMismatches.length} แถว ระบบจะคำนวณจาก จำนวน × ราคา
              <RowList rows={amountMismatches} />
            </div>
          )}
          {unreadable.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-semibold text-amber-900">
              อ่านค่าไม่ได้ {unreadable.length} แถว จำนวนในแถวเหล่านี้จะเว้นว่างไว้
              <RowList rows={unreadable} />
            </div>
          )}
          <p className="text-slate-500">ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดบันทึก BOQ และไฟล์ต้นฉบับไม่ถูกแก้ไข</p>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          {hasExistingRows && (
            <button type="button" onClick={() => onImport('replace', atOfferPrice)} className="rounded-lg border border-red-200 px-3 py-2 font-semibold text-red-700 hover:bg-red-50">
              แทนที่รายการเดิม
            </button>
          )}
          <button type="button" onClick={() => onImport('append', atOfferPrice)} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
            {hasExistingRows ? 'ต่อท้ายรายการเดิม' : `นำเข้า ${lines.length.toLocaleString()} แถว`}
          </button>
        </div>
      </div>
    </div>
  );
}
