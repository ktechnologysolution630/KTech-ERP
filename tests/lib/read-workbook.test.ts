import { describe, expect, test } from 'vitest';
import { isExcelLockFile, readWorkbook } from '@/lib/read-workbook';

describe('the small file Excel leaves beside an open workbook', () => {
  test('is told apart from the workbook by its name', () => {
    expect(isExcelLockFile('~$ใบสั่งซื้อ.xlsx')).toBe(true);
    expect(isExcelLockFile('ใบสั่งซื้อ.xlsx')).toBe(false);
    expect(isExcelLockFile('งบ~$ปี69.xlsx')).toBe(false);
  });

  test('is refused before any reading starts', async () => {
    await expect(readWorkbook(new File(['x'], '~$ใบสั่งซื้อ.xlsx'))).rejects.toThrow('EXCEL_LOCK_FILE');
  });
});
