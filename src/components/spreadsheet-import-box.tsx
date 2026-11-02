'use client';

import { useState, useTransition } from 'react';
import ExcelJS from 'exceljs';

function parseCsvText(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    return row;
  });
}

export function SpreadsheetImportBox({
  title,
  hint,
  onImportRows,
}: {
  title: string;
  hint: string;
  onImportRows: (rows: Record<string, string>[]) => Promise<{
    created: number;
    updated: number;
    errors: { row: number; message: string }[];
  }>;
}) {
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    errors: { row: number; message: string }[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    let rows: Record<string, string>[] = [];
    if (file.name.toLowerCase().endsWith('.csv')) {
      rows = parseCsvText(await file.text());
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (ws) {
        const headers: string[] = [];
        ws.getRow(1).eachCell((cell, colNumber) => {
          headers[colNumber] = String(cell.value ?? '').trim();
        });
        ws.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const record: Record<string, string> = {};
          headers.forEach((h, colNumber) => {
            if (!h) return;
            const val = row.getCell(colNumber).value;
            record[h] = val === null || val === undefined ? '' : String(val).trim();
          });
          rows.push(record);
        });
      }
    }
    startTransition(async () => {
      const res = await onImportRows(rows);
      setResult(res);
    });
    e.target.value = '';
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        <label className="cursor-pointer rounded-lg bg-slate-800 hover:bg-slate-900 text-white px-3 py-2 text-xs font-medium">
          {pending ? 'กำลังนำเข้า...' : 'เลือกไฟล์ CSV / XLSX'}
          <input
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            disabled={pending}
            onChange={handleFile}
          />
        </label>
      </div>
      {result && (
        <div className="mt-3 text-xs space-y-1">
          <p className="text-emerald-700 font-medium">
            เพิ่มใหม่ {result.created} รายการ · อัปเดต {result.updated} รายการ
          </p>
          {result.errors.map((err) => (
            <p key={err.row} className="text-red-600">
              แถวที่ {err.row}: {err.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
