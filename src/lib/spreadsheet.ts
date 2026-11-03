import ExcelJS from 'exceljs';

/** Minimal CSV reader: comma separated, optional double quotes, "" as an escaped quote. */
export function parseCsvText(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const split = (line: string) => {
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
  };
  const headers = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = split(line);
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']));
  });
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
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
