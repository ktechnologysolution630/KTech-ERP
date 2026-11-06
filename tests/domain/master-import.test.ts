import { describe, expect, test } from 'vitest';
import type { BoqSheetCell, BoqSheetGrid } from '@/domain/boq-import';
import { isValidTaxId, parseMasterWorkbook } from '@/domain/master-import';

const cell = (raw: string | number | null): BoqSheetCell | null => (raw === null || raw === '' ? null : { v: raw, w: String(raw) });
const sheet = (name: string, rows: (string | number | null)[][]): BoqSheetGrid => ({ name, rows: rows.map((r) => r.map(cell)) });

const VENDOR_HEAD = ['search_vendor', 'VENDOR', 'ADDRESS 1', 'ADDRESS 2', 'TAX ID', 'TEL', 'MOBILE', 'FAX', 'E-MAIL', 'show_vendor'];
const vendorSheet = (rows: (string | number | null)[][]) => sheet('datavendor', [VENDOR_HEAD, ...rows]);
const itemSheet = (rows: (string | number | null)[][]) => sheet('dataitem', [['search_item', 'รหัสสินค้า', 'รายการสินค้า', 'show_item'], ...rows]);
const poSheet = (name: string, rows: (string | number | null)[][]) =>
  sheet(name, [['เรียน/ATTN:'], ['ลำดับที่', 'รหัสสินค้า', 'รายละเอียด', 'จำนวน', 'หน่วย'], ['NO.', 'PART NUMBER', 'DESCRIPTION', 'QUANTITY', 'UNIT'], ...rows]);

// Made-up ids with a correct check digit
const COMPANY_ID = '0105551234567';
const makeValid = (first12: string) => {
  const total = [...first12].reduce((sum, d, i) => sum + Number(d) * (13 - i), 0);
  return `${first12}${(11 - (total % 11)) % 10}`;
};
const COMPANY_VALID = makeValid(COMPANY_ID.slice(0, 12));
const PERSON_VALID = makeValid('110050012345');

describe('tax ids', () => {
  test('the check digit tells a real id from a mistyped one', () => {
    expect(isValidTaxId(COMPANY_VALID)).toBe(true);
    expect(isValidTaxId(PERSON_VALID)).toBe(true);
    const wrongLast = `${COMPANY_VALID.slice(0, 12)}${(Number(COMPANY_VALID[12]) + 1) % 10}`;
    expect(isValidTaxId(wrongLast)).toBe(false);
    expect(isValidTaxId('123')).toBe(false);
  });

  test('puts back the zero Excel dropped from a company id stored as a number', () => {
    const { vendors } = parseMasterWorkbook([vendorSheet([[1, 'บริษัท ตัวอย่าง จำกัด', 'ที่อยู่', '', Number(COMPANY_VALID)]])]);
    expect(vendors[0]).toMatchObject({ taxId: COMPANY_VALID, type: 'COMPANY' });
  });

  test('a mistyped id is left out and reported, and the vendor still goes in', () => {
    const r = parseMasterWorkbook([vendorSheet([[1, 'บริษัท พิมพ์ผิด จำกัด', '', '', 1234567]])]);
    expect(r.vendors[0]).toMatchObject({ name: 'บริษัท พิมพ์ผิด จำกัด', taxId: null });
    expect(r.invalidTaxIds).toEqual(['แถว 2: บริษัท พิมพ์ผิด จำกัด']);
  });
});

describe('vendors', () => {
  test('takes the fields by heading and drops the dashes that mean nothing', () => {
    const { vendors } = parseMasterWorkbook([
      vendorSheet([[1, 'นางสาวตัวอย่าง ทดสอบ', '1 หมู่ 2 ตำบลตัวอย่าง', '-', PERSON_VALID, '-', '081-111-1111', '-', '-', 'ซ้ำ']]),
    ]);
    expect(vendors).toEqual([{ name: 'นางสาวตัวอย่าง ทดสอบ', type: 'INDIVIDUAL', taxId: PERSON_VALID, branch: '00000', address: '1 หมู่ 2 ตำบลตัวอย่าง', phone: '081-111-1111', email: '', fax: '' }]);
  });

  test('joins both address lines, a postcode stored as a number included', () => {
    const { vendors } = parseMasterWorkbook([vendorSheet([[1, 'ร้าน ก', 'ถนนตัวอย่าง', 10220]])]);
    expect(vendors[0]!.address).toBe('ถนนตัวอย่าง 10220');
  });

  test('joins phone and mobile', () => {
    expect(parseMasterWorkbook([vendorSheet([[1, 'ร้าน ก', '', '', '', '02-111-1111', '081-111-1111']])]).vendors[0]!.phone).toBe('02-111-1111, 081-111-1111');
  });

  test('tells person from company by the name, then by the tax id', () => {
    const type = (name: string, id: string | number = '') => parseMasterWorkbook([vendorSheet([[1, name, '', '', id]])]).vendors[0]!.type;
    expect(type('นายตัวอย่าง ทดสอบ')).toBe('INDIVIDUAL');
    expect(type('นางตัวอย่าง ทดสอบ')).toBe('INDIVIDUAL');
    expect(type('Miss Sample Name')).toBe('INDIVIDUAL');
    expect(type('บริษัท ตัวอย่าง จำกัด (มหาชน)')).toBe('COMPANY');
    expect(type('ห้างหุ้นส่วนจำกัด ตัวอย่าง')).toBe('COMPANY');
    // A trading name with a personal tax id is a person for withholding tax
    expect(type('ตัวอย่างการช่าง', PERSON_VALID)).toBe('INDIVIDUAL');
    expect(type('ตัวอย่างการช่าง', COMPANY_VALID)).toBe('COMPANY');
    expect(type('กรมตัวอย่าง')).toBe('COMPANY');
  });

  test('reads a branch when one is named, and the head office otherwise', () => {
    const branch = (name: string, address = '') => parseMasterWorkbook([vendorSheet([[1, name, address]])]).vendors[0]!.branch;
    expect(branch('บริษัท ก จำกัด (สาขาที่ 00012)')).toBe('00012');
    expect(branch('บริษัท ข จำกัด', 'สาขาที่ 00003 ถนนตัวอย่าง')).toBe('00003');
    expect(branch('บริษัท ค จำกัด (สำนักงานใหญ่)')).toBe('00000');
  });

  test('skips blank rows and repeats, and counts contacts it cannot keep', () => {
    const r = parseMasterWorkbook([vendorSheet([[1, 'ร้าน ก', '', '', '', '', '', '02-222-2222', 'a@example.com'], [2, ''], [3, 'ร้าน ก']])]);
    expect(r.vendors).toHaveLength(1);
    expect(r.skippedVendors).toEqual(['แถว 4: ร้าน ก ซ้ำกับแถวก่อนหน้า']);
    expect(r.vendors[0]).toMatchObject({ fax: '02-222-2222', email: 'a@example.com' });
  });
});

describe('items', () => {
  test('takes the unit used most often in the purchase orders', () => {
    const r = parseMasterWorkbook([
      itemSheet([[1, 'CM-1', 'ปูนซีเมนต์'], [2, 'PV-1', 'ท่อ PVC']]),
      poSheet('PO-1', [[1, 'CM-1', 'ปูน', 3, 'ถุง'], [2, 'PV-1', 'ท่อ', 2, 'เส้น']]),
      poSheet('PO-2', [[1, 'CM-1', 'ปูน', 3, 'ถุง'], [2, 'CM-1', 'ปูน', 1, 'กระสอบ']]),
    ]);
    expect(r.items).toEqual([{ code: 'CM-1', name: 'ปูนซีเมนต์', unitName: 'ถุง' }, { code: 'PV-1', name: 'ท่อ PVC', unitName: 'เส้น' }]);
    expect(r.itemsWithSeveralUnits).toBe(1);
    expect(r.itemsWithoutUnit).toBe(0);
    expect(r.poSheetsRead).toBe(2);
  });

  test('an item no purchase order mentions has no unit, and is counted', () => {
    const r = parseMasterWorkbook([itemSheet([[1, 'X-1', 'ของใหม่']])]);
    expect(r.items).toEqual([{ code: 'X-1', name: 'ของใหม่', unitName: null }]);
    expect(r.itemsWithoutUnit).toBe(1);
  });

  test('a code stored as text keeps its leading zeros', () => {
    expect(parseMasterWorkbook([itemSheet([[1, '0001', 'สวิตช์']])]).items[0]!.code).toBe('0001');
  });

  test('reports a repeated code and a row missing its name or code, and keeps the first', () => {
    const r = parseMasterWorkbook([itemSheet([[1, 'A-1', 'ชื่อแรก'], [2, 'A-1', 'ชื่ออื่น'], [3, 'B-1', ''], [4, '', 'ไม่มีรหัส'], [5, '', '']])]);
    expect(r.items).toEqual([{ code: 'A-1', name: 'ชื่อแรก', unitName: null }]);
    expect(r.skippedItems).toEqual(['แถว 3: รหัส A-1 ซ้ำกับแถวก่อนหน้า', 'แถว 4: B-1 ไม่มีชื่อสินค้า', 'แถว 5: ไม่มีรหัส ไม่มีรหัสสินค้า']);
  });
});

describe('finding the sheets', () => {
  test('by their headings, wherever they sit, and ignores the rest', () => {
    const r = parseMasterWorkbook([sheet('บันทึก', [['สวัสดี']]), itemSheet([[1, 'A-1', 'ของ']]), vendorSheet([[1, 'ร้าน ก']])]);
    expect([r.vendors.length, r.items.length]).toEqual([1, 1]);
  });

  test('a file with neither gives nothing', () => {
    const r = parseMasterWorkbook([sheet('บันทึก', [['สวัสดี']]), sheet('ว่าง', [])]);
    expect([r.vendors, r.items]).toEqual([[], []]);
  });
});
