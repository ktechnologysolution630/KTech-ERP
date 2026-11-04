import ExcelJS from 'exceljs';

/** Minimal CSV reader: comma separated, optional double quotes, "" as an escaped quote. */
export function parseCsvText(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']));
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return String(value.result ?? '');
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('text' in value) return String(value.text);
  }
  return String(value).trim();
}

/** Reads the first sheet of an .xlsx file or a .csv file into header-keyed rows. */
export async function readSpreadsheetRows(file: File): Promise<Record<string, string>[]> {
  if (file.name.toLowerCase().endsWith('.csv')) return parseCsvText(await file.text());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = cellText(cell.value);
  });
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const record: Record<string, string> = {};
    headers.forEach((h, col) => {
      if (h) record[h] = cellText(row.getCell(col).value);
    });
    rows.push(record);
  });
  return rows;
}

export interface SheetPreview {
  name: string;
  rows: string[][];
  /** Rows beyond the display limit that were left out */
  hiddenRows: number;
}

const MAX_PREVIEW_ROWS = 2000;

function previewCellText(cell: ExcelJS.Cell): string {
  // A merged range holds its value on the first cell only; the others would repeat it
  if (cell.isMerged && cell.master.address !== cell.address) return '';
  const value = cell.value;
  const shown = value && typeof value === 'object' && 'result' in value ? value.result : value;
  if (shown instanceof Date) return shown.toISOString().slice(0, 10);
  if (shown && typeof shown === 'object' && 'error' in shown) return String(shown.error);
  return cellText(shown as ExcelJS.CellValue);
}

/** Every sheet of an .xlsx file as plain text rows, for viewing; blank rows and columns at the end are dropped. */
export async function readWorkbookPreview(data: ArrayBuffer): Promise<SheetPreview[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(previewCellText(row.getCell(c)));
      rows.push(cells);
    }
    return trimPreview(ws.name, rows);
  });
}

/** A .csv file as plain text rows, for viewing. */
export function readCsvPreview(text: string, name = 'CSV'): SheetPreview[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  return [trimPreview(name, lines.map(splitCsvLine))];
}

function trimPreview(name: string, rows: string[][]): SheetPreview {
  let last = rows.length;
  while (last > 0 && rows[last - 1]!.every((c) => c === '')) last--;
  const used = rows.slice(0, last);
  const width = used.reduce((w, r) => {
    let end = r.length;
    while (end > 0 && r[end - 1] === '') end--;
    return Math.max(w, end);
  }, 0);
  return {
    name,
    rows: used.slice(0, MAX_PREVIEW_ROWS).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')),
    hiddenRows: Math.max(0, used.length - MAX_PREVIEW_ROWS),
  };
}

/** Builds a one-sheet workbook and triggers a browser download. */
export async function downloadWorkbook(fileName: string, header: string[], rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(header).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c, i) => {
    c.width = i === 1 ? 48 : 16;
  });
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
