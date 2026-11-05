import * as XLSX from 'xlsx';
import type { BoqSheetCell, BoqSheetGrid } from '@/domain/boq-import';

/** BOQ tables are narrow; some sheets claim 256 columns of stray formatting */
const MAX_COLUMNS = 30;

export type WorkbookWorkerReply = { ok: true; sheets: BoqSheetGrid[] } | { ok: false; reason: 'PASSWORD' | 'UNREADABLE' };

/**
 * Parsing runs in this worker on purpose. It keeps the page responsive on large files, and it keeps the parser,
 * which handles files from outside, away from the page's own objects and data. The file is only read.
 */
self.onmessage = async (event: MessageEvent<File>) => {
  const file = event.data;
  try {
    const isCsv = /\.csv$/i.test(file.name);
    const workbook = isCsv ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const hidden = new Set((workbook.Workbook?.Sheets ?? []).filter((s) => s.Hidden).map((s) => s.name));
    const sheets: BoqSheetGrid[] = workbook.SheetNames.filter((name) => !hidden.has(name)).map((name) => {
      const sheet = workbook.Sheets[name]!;
      if (!sheet['!ref']) return { name, rows: [] };
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const rows: BoqSheetGrid['rows'] = [];
      for (let r = 0; r <= range.e.r; r++) {
        const row: (BoqSheetCell | null)[] = [];
        for (let c = 0; c < Math.min(range.e.c + 1, MAX_COLUMNS); c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
          const usable = cell && (typeof cell.v === 'string' || typeof cell.v === 'number');
          row.push(usable ? { v: cell.v as string | number, w: cell.w ?? String(cell.v) } : null);
        }
        rows.push(row);
      }
      return { name, rows };
    });
    self.postMessage({ ok: true, sheets } satisfies WorkbookWorkerReply);
  } catch (err) {
    const password = err instanceof Error && /password|encrypt/i.test(err.message);
    self.postMessage({ ok: false, reason: password ? 'PASSWORD' : 'UNREADABLE' } satisfies WorkbookWorkerReply);
  }
};
