'use client';

import { useState, useTransition } from 'react';
import { readSpreadsheetRows } from '@/lib/spreadsheet';

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
    const rows = await readSpreadsheetRows(file);
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
