'use client';

import React, { useMemo, useState } from 'react';
import { AlertCircle, FileBox, Loader2, Upload, X } from 'lucide-react';
import type { ArchicadRow } from '@/domain/archicad-bridge';
import { readIfc } from '@/domain/ifc-takeoff';
import { findInTakeoff, type ExistingItem } from '@/domain/ai-takeoff-merge';
import { QuantityPickTable } from '@/components/boq-quantity-pick-table';

/**
 * Brings in quantities from an IFC file exported from Archicad (or any BIM program). The file is read
 * in the browser and never uploaded; only the picked BOQ lines are added to the take-off.
 */
export function IfcImportDialog({ existing, onAdd, onClose }: { existing: ExistingItem[]; onAdd: (items: ArchicadRow[]) => void; onClose: () => void }) {
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<ArchicadRow[]>([]);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [found, setFound] = useState<{ label: string; count: number }[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');

  const already = useMemo(() => findInTakeoff(rows, existing), [rows, existing]);
  const chosen = rows.filter((_, i) => picked[i]);

  const readFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    setReading(true);
    setRows([]);
    setFound([]);
    setWarnings([]);
    try {
      // Let the "reading" state paint before the parse holds the thread
      await new Promise((r) => setTimeout(r, 30));
      const res = readIfc(await file.text());
      const dup = findInTakeoff(res.rows, existing);
      setRows(res.rows);
      // Rows already in the take-off start unticked so they are not counted twice
      setPicked(dup.map((d) => !d));
      setFound(res.found);
      setWarnings(res.warnings);
      if (res.rows.length === 0) setError('ไม่พบปริมาณในไฟล์นี้ ตอน export IFC จาก Archicad ให้เปิดตัวเลือก "Base Quantities" (ปริมาณพื้นฐาน) แล้ว export ใหม่');
    } catch {
      setError('อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ .ifc');
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="นำเข้าปริมาณจากไฟล์ IFC">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <FileBox className="h-4 w-4 text-brand" /> นำเข้าปริมาณจากไฟล์ IFC
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <p className="rounded-lg bg-slate-50 p-3 text-slate-700">
            ใน Archicad เลือก File › Save As… แล้วเลือกชนิดไฟล์ IFC (ตั้งค่า Translator ให้มี Base Quantities) จากนั้นเลือกไฟล์ด้านล่าง ไฟล์จะถูกอ่านในเครื่องนี้ ไม่ได้อัปโหลดขึ้นระบบ
          </p>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 p-4 font-semibold text-slate-700 hover:border-brand hover:bg-blue-50">
            {reading ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <Upload className="h-4 w-4 text-brand" />}
            {reading ? `กำลังอ่าน ${fileName}…` : fileName ? `ไฟล์: ${fileName} (เลือกใหม่)` : 'เลือกไฟล์ .ifc'}
            <input
              type="file"
              accept=".ifc"
              className="sr-only"
              disabled={reading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = '';
              }}
            />
          </label>

          {found.length > 0 && <p className="text-slate-600">พบในไฟล์: {found.map((f) => `${f.label} ${f.count.toLocaleString('th-TH')}`).join(' · ')}</p>}

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 font-semibold text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          {rows.length > 0 && <QuantityPickTable rows={rows} picked={picked} already={already} onPick={setPicked} />}

          {warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-slate-500">
              {warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" disabled={chosen.length === 0} onClick={() => onAdd(chosen)} className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-hover disabled:opacity-40">
            เพิ่ม {chosen.length} รายการ
          </button>
        </div>
      </div>
    </div>
  );
}
