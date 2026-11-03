import { describe, expect, test } from 'vitest';
import { parseCsvText } from '@/lib/spreadsheet';

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
