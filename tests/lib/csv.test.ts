import { describe, expect, test } from 'vitest';
import { toCsv } from '@/lib/csv';

describe('CSV export', () => {
  test('starts with a BOM for Thai in Excel and quotes fields that need it', () => {
    const out = toCsv(['ชื่อ', 'ยอด'], [['บริษัท "เอ", จำกัด', 1500.5], ['ข', null]]);
    expect(out).toBe('﻿ชื่อ,ยอด\r\n"บริษัท ""เอ"", จำกัด",1500.50\r\nข,\r\n');
  });
});
