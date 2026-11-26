'use client';

import React, { useMemo, useState } from 'react';
import { AlertCircle, Box, Download, Upload, X } from 'lucide-react';
import { parseArchicadRows, type ArchicadRow } from '@/domain/archicad-takeoff';
import { findInTakeoff, type ExistingItem } from '@/domain/ai-takeoff-merge';

export type ArchicadPickedItem = ArchicadRow;

const TOOLS = [
  { href: '/tools/archicad/boq_from_archicad.py', label: 'boq_from_archicad.py', hint: 'สคริปต์ดึงปริมาณ' },
  { href: '/tools/archicad/boq_config.json', label: 'boq_config.json', hint: 'กฎการถอดแบบ แก้ได้' },
  { href: '/tools/archicad/run_boq.bat', label: 'run_boq.bat', hint: 'ดับเบิลคลิกเพื่อรัน' },
];

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 });

/**
 * Brings in quantities taken off an Archicad model. Archicad answers only on the user's own computer,
 * so a small script runs there and writes a CSV; this dialog reads the CSV and lets the user pick rows.
 */
export function ArchicadImportDialog({ existing, onAdd, onClose }: { existing: ExistingItem[]; onAdd: (items: ArchicadPickedItem[]) => void; onClose: () => void }) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ArchicadRow[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [error, setError] = useState('');

  const already = useMemo(() => findInTakeoff(rows, existing), [rows, existing]);

  const readFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    try {
      const { readSpreadsheetRows } = await import('@/lib/spreadsheet');
      const res = parseArchicadRows(await readSpreadsheetRows(file));
      if (res.rows.length === 0) {
        setRows([]);
        setPicked([]);
        setSkipped(res.skipped);
        setError('ไม่พบรายการที่มีปริมาณในไฟล์นี้ ตรวจว่าเป็นไฟล์ที่สคริปต์ Archicad สร้าง (มีคอลัมน์ ลำดับ, รายการ, จำนวน, หน่วย)');
        return;
      }
      const dup = findInTakeoff(res.rows, existing);
      setRows(res.rows);
      setSkipped(res.skipped);
      // Rows already in the take-off start unticked so they are not counted twice
      setPicked(dup.map((d) => !d));
    } catch {
      setRows([]);
      setPicked([]);
      setError('อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ .csv หรือ .xlsx');
    }
  };

  const chosen = rows.filter((_, i) => picked[i]);
  const allOn = rows.length > 0 && picked.every(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="นำเข้าปริมาณจาก Archicad">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Box className="h-4 w-4 text-brand" /> นำเข้าปริมาณจาก Archicad
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <ol className="list-decimal space-y-1 rounded-lg bg-slate-50 p-3 pl-7 text-slate-700">
            <li>
              ดาวน์โหลดไฟล์ทั้ง 3 ไฟล์ไว้ในโฟลเดอร์เดียวกันบนเครื่องที่ติดตั้ง Archicad (ทำครั้งเดียว ต้องมี Python 3):
              <span className="mt-1 flex flex-wrap gap-2">
                {TOOLS.map((t) => (
                  <a key={t.href} href={t.href} download className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-brand hover:bg-blue-50" title={t.hint}>
                    <Download className="h-3 w-3" /> {t.label}
                  </a>
                ))}
              </span>
            </li>
            <li>เปิดโปรเจกต์ใน Archicad แล้วดับเบิลคลิก run_boq.bat จะได้ไฟล์ BOQ_Archicad.csv</li>
            <li>เลือกไฟล์ BOQ_Archicad.csv ด้านล่าง แล้วเลือกรายการที่จะเพิ่ม</li>
          </ol>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 p-4 font-semibold text-slate-700 hover:border-brand hover:bg-blue-50">
            <Upload className="h-4 w-4 text-brand" />
            {fileName ? `ไฟล์: ${fileName} (เลือกใหม่)` : 'เลือกไฟล์ BOQ_Archicad.csv'}
            <input
              type="file"
              accept=".csv,.xlsx"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = '';
              }}
            />
          </label>

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 font-semibold text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="w-8 px-2 py-1.5">
                      <input type="checkbox" checked={allOn} onChange={() => setPicked(rows.map(() => !allOn))} aria-label="เลือกทั้งหมด" />
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
                        <input type="checkbox" checked={picked[i] ?? false} onChange={() => setPicked((p) => p.map((v, j) => (j === i ? !v : v)))} aria-label={`เลือก ${r.description}`} />
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{r.category}</td>
                      <td className="px-2 py-1.5">
                        <span className="font-semibold text-slate-900">{r.description}</span>
                        {already[i] && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">มีในงานถอดแบบแล้ว: {already[i]!.description}</span>}
                        {r.note && <span className="block text-slate-400">{r.note}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.qty)}</td>
                      <td className="px-2 py-1.5">{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {skipped.length > 0 && <p className="text-slate-500">ข้าม {skipped.length} แถวที่ไม่มีปริมาณ: {skipped.slice(0, 10).join(', ')}{skipped.length > 10 ? ' …' : ''}</p>}
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
