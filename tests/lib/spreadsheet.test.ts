import { describe, expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import { previewKind } from '@/lib/file-preview';
import { parseCsvText, readCsvPreview, readWorkbookPreview } from '@/lib/spreadsheet';

describe('document preview', () => {
  test('chooses how to show a file by its name', () => {
    expect(previewKind('รายงาน.PDF')).toBe('PDF');
    expect(previewKind('K69-004-BOQ-023.xlsx')).toBe('WORKBOOK');
    expect(previewKind('site.JPG')).toBe('IMAGE');
    expect(previewKind('a.csv')).toBe('CSV');
    expect(previewKind('notes.txt')).toBe('TEXT');
    expect(previewKind('old.xls')).toBe('NONE');
    expect(previewKind('contract.docx')).toBe('NONE');
    expect(previewKind('pdf')).toBe('NONE');
  });

  test('reads every sheet as text: formulas, dates, merged cells, trailing blanks', async () => {
    const wb = new ExcelJS.Workbook();
    const boq = wb.addWorksheet('BOQ');
    boq.addRow(['รายการ', 'จำนวน', 'วันที่', 'รวม']);
    boq.addRow(['เหล็ก', 2, new Date(Date.UTC(2026, 10, 4)), { formula: 'B2*10', result: 20 }]);
    boq.addRow(['หัวข้อรวม']);
    boq.mergeCells('A3:D3');
    boq.addRow([{ richText: [{ text: 'ปู' }, { text: 'น' }] }, null, null, null]);
    boq.getCell('F9').value = '';
    wb.addWorksheet('ว่าง');
    const buf = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;

    const sheets = await readWorkbookPreview(buf);
    expect(sheets.map((s) => s.name)).toEqual(['BOQ', 'ว่าง']);
    expect(sheets[0]!.rows).toEqual([
      ['รายการ', 'จำนวน', 'วันที่', 'รวม'],
      ['เหล็ก', '2', '2026-11-04', '20'],
      ['หัวข้อรวม', '', '', ''],
      ['ปูน', '', '', ''],
    ]);
    expect(sheets[1]).toEqual({ name: 'ว่าง', rows: [], hiddenRows: 0 });
  });

  test('limits very long sheets and keeps csv quoting and uneven rows', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ยาว');
    for (let i = 0; i < 2005; i++) ws.addRow([i]);
    const long = await readWorkbookPreview((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    expect(long[0]).toMatchObject({ hiddenRows: 5 });
    expect(long[0]!.rows).toHaveLength(2000);

    expect(readCsvPreview('﻿a,"b, c"\r\n1\r\n\r\n')[0]).toEqual({ name: 'CSV', rows: [['a', 'b, c'], ['1', '']], hiddenRows: 0 });
  });
});

describe('parseCsvText', () => {
  test('handles BOM, quotes, commas inside quotes and escaped quotes', () => {
    const csv = '﻿ลำดับ,รายการ,จำนวน,หมายเหตุ\r\n"1","เหล็ก DB12, ยาว 10 ม.",1,500,"ขนาด ""พิเศษ"""\r\n\r\n2,ปูน,20,\n';
    expect(parseCsvText(csv)).toEqual([
      { ลำดับ: '1', รายการ: 'เหล็ก DB12, ยาว 10 ม.', จำนวน: '1', หมายเหตุ: '500' },
      { ลำดับ: '2', รายการ: 'ปูน', จำนวน: '20', หมายเหตุ: '' },
    ]);
  });

  test('returns nothing without data rows', () => {
    expect(parseCsvText('a,b\n')).toEqual([]);
    expect(parseCsvText('')).toEqual([]);
  });
});
