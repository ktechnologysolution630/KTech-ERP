'use client';

import React, { useMemo, useState } from 'react';
import { Layers, X } from 'lucide-react';
import type { TakeoffItem } from '@/domain/boq-takeoff';
import { buildElementItems, cleanParams, ELEMENT_TEMPLATES, type ElementKey } from '@/domain/takeoff-elements';

/**
 * Picks a building element (wall, slab, column …) and its dimensions. One measurement of the element
 * then gives all its BOQ lines, as Archicad does for the elements in its model.
 */
export function ElementDialog({ categories, defaultCategory, newId, colorOf, onAdd, onClose }: {
  categories: string[];
  defaultCategory: string;
  newId: () => string;
  colorOf: (i: number) => string;
  onAdd: (items: TakeoffItem[]) => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState<ElementKey>('wall');
  const template = ELEMENT_TEMPLATES.find((t) => t.key === key)!;
  const [name, setName] = useState('');
  const [category, setCategory] = useState(defaultCategory);
  const [raw, setRaw] = useState<Record<string, string>>({});

  const values = useMemo(() => {
    const parsed: Record<string, number | undefined> = {};
    for (const p of template.params) {
      const s = raw[`${key}.${p.key}`];
      parsed[p.key] = s === undefined || s.trim() === '' ? undefined : Number(s);
    }
    return cleanParams(template, parsed);
  }, [raw, key, template]);
  const lines = template.lines(values);
  const shownName = name.trim() || template.defaultName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="เพิ่มชิ้นส่วน">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Layers className="h-4 w-4 text-brand" /> เพิ่มชิ้นส่วน (วัดครั้งเดียวได้หลายรายการ)
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ELEMENT_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setKey(t.key)}
                className={`rounded-lg border px-2 py-2 font-semibold ${key === t.key ? 'border-brand bg-blue-50 text-brand' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-slate-500">วิธีวัด: {template.measureHint}</p>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="font-semibold text-slate-700">ชื่อชิ้นส่วน</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={template.defaultName} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="block">
              <span className="font-semibold text-slate-700">หมวดงาน</span>
              <input list="element-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="เช่น งานโครงสร้าง" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              <datalist id="element-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {template.params.map((p) => (
              <label key={`${key}.${p.key}`} className="block">
                <span className="font-semibold text-slate-700">
                  {p.label} ({p.unit})
                </span>
                <input
                  type="number"
                  step="any"
                  min={p.min}
                  max={p.max}
                  defaultValue={p.default}
                  onChange={(e) => setRaw((r) => ({ ...r, [`${key}.${p.key}`]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right"
                />
              </label>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">รายการที่จะได้</th>
                  <th className="px-2 py-1.5">หน่วย</th>
                  <th className="px-2 py-1.5">วิธีคำนวณ</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-semibold text-slate-900">{l.prefix ? `${l.prefix} ${shownName}` : shownName}</td>
                    <td className="px-2 py-1.5">{l.unit}</td>
                    <td className="px-2 py-1.5 text-slate-600">{l.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-slate-500">ทุกรายการใช้การวัดชุดเดียวกัน แก้ตัวคูณหรือช่องเปิดของแต่ละรายการได้ภายหลังที่ปุ่มแก้ไข</p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onAdd(buildElementItems(template, values, { name, category: category.trim(), newId, colorOf }))}
            className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-hover"
          >
            เพิ่ม {lines.length} รายการแล้วเริ่มวัด
          </button>
        </div>
      </div>
    </div>
  );
}
