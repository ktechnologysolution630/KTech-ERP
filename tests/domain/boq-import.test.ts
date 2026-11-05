import { describe, expect, test } from 'vitest';
import { parseBoqWorkbook, type BoqSheetCell, type BoqSheetGrid } from '@/domain/boq-import';

type Raw = string | number | { v: number; w: string } | null;
const cell = (raw: Raw): BoqSheetCell | null => {
  if (raw === null || raw === '') return null;
  return typeof raw === 'object' ? raw : { v: raw, w: String(raw) };
};
const sheet = (name: string, rows: Raw[][]): BoqSheetGrid => ({ name, rows: rows.map((r) => r.map(cell)) });

// The two-row heading of the government form, whose description column has no heading
const FORM_HEADING: Raw[][] = [
  ['ลำดับที่', '', 'จำนวน', 'หน่วย', 'ราคาวัสดุ', '', 'ค่าแรงงาน', '', 'รวมค่าวัสดุ', 'หมายเหตุ'],
  ['', '', '', '', 'ราคาต่อหน่วย', 'จำนวนเงิน', 'ราคาหน่วยละ', 'จำนวนเงิน', 'และค่าแรงงาน', ''],
];
const form = (name: string, rows: Raw[][]) =>
  sheet(name, [
    ['', 'รายการประมาณราคา โครงการ', 'อาคารตัวอย่าง', '', '', '', '', '', '', 'แบบ ปร.4'],
    ['', 'เจ้าของ', 'เทศบาลตัวอย่าง'],
    ['', 'สถานที่ก่อสร้าง', 'ตำบลตัวอย่าง จังหวัดตัวอย่าง'],
    ['', 'คำนวณราคากลางราคาเมื่อวันที่', 'วันที่   18    เดือน ธันวาคม  พ.ศ.2568', '', '', '', '', 'แบบเลขที่', 'ตย.1/2568'],
    ...FORM_HEADING,
    ...rows,
  ]);

describe('picking the BOQ tables out of a workbook', () => {
  const quantities = form('ปร.4 อาคาร', [[1, 'งานโครงสร้าง'], [1.1, 'เจาะสำรวจ', 2, 'จุด', 100, 200, 50, 100, 300]]);
  const summary = sheet('ปร.5', [['ลำดับ', 'รายการ', '', '', 'ค่าวัสดุและค่าแรง', 'Factor F'], [1, 'งานอาคาร', '', '', 500000, 1.07]]);
  const priceList = sheet('ราคาวัสดุ', [['ลำดับที่', 'รายการ', '', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'ราคารวม'], [1, 'ปูนซีเมนต์', '', 260, 'กก.', 2.76, 717.6]]);

  test('uses the quantity sheets and leaves summaries and price lists out', () => {
    const r = parseBoqWorkbook([summary, quantities, priceList, sheet('ว่าง', [])]);
    expect(r.usedSheets).toEqual([{ name: 'ปร.4 อาคาร', categories: 1, items: 1 }]);
    expect(r.skippedSheets).toEqual(['ปร.5', 'ราคาวัสดุ', 'ว่าง']);
    expect(r.lines.map((l) => l.description)).toEqual(['งานโครงสร้าง', 'เจาะสำรวจ']);
  });

  test('a plain priced table is used only when the file has nothing better', () => {
    const r = parseBoqWorkbook([priceList]);
    expect(r.lines).toMatchObject([{ description: 'ปูนซีเมนต์', qty: 260, unit: 'กก.', matRate: 2.76, labRate: '' }]);
  });

  test('a file with no table at all gives nothing', () => {
    const r = parseBoqWorkbook([summary, sheet('บันทึก', [['สวัสดี']])]);
    expect(r.lines).toEqual([]);
    expect(r.usedSheets).toEqual([]);
  });
});

describe('reading the rows', () => {
  const read = (rows: Raw[][]) => parseBoqWorkbook([form('ปร.4', rows)]);

  test('takes quantity, unit and both prices from the right columns', () => {
    const { lines } = read([[1.1, 'คอนกรีต', 10, 'ลบ.ม.', 2200, 22000, 350, 3500, 25500, 'รวมค่าส่ง']]);
    expect(lines).toEqual([{ isCategory: false, isBold: false, no: '1.1', description: 'คอนกรีต', qty: 10, unit: 'ลบ.ม.', matRate: 2200, labRate: 350, note: 'รวมค่าส่ง' }]);
  });

  test('totals the file adds itself are not counted again', () => {
    const { lines } = read([
      [1, 'งานโครงสร้าง', '', 'รวม', '', '', '', '', 500],
      ['', 'สรุปงานอาคาร', '', '', '', '', '', '', 500],
      [1, 'งานโครงสร้าง'],
      [1.1, 'เจาะสำรวจ', 2, 'จุด', 100, 200, 50, 100, 300],
      ['', 'รวมงานโครงสร้าง', '', '', '', '', '', '', 300],
    ]);
    expect(lines.map((l) => l.description)).toEqual(['งานโครงสร้าง', 'เจาะสำรวจ']);
  });

  test('an item whose name merely starts with the word for total stays, because it has a quantity', () => {
    expect(read([['', 'รวมค่าติดตั้งระบบ', 1, 'งาน', 500]]).lines).toMatchObject([{ description: 'รวมค่าติดตั้งระบบ', qty: 1, matRate: 500 }]);
  });

  test('numbering is kept as Excel shows it, so 1.10 does not become 1.1', () => {
    const { lines } = read([[{ v: 1.1, w: '1.10' }, 'เหล็กเสริม', 5, 'กก.']]);
    expect(lines[0]!.no).toBe('1.10');
  });

  test('whole-numbered headings become categories; sub-headings and run-over lines stay as text in place', () => {
    const { lines } = read([
      ['', 'อาคารตัวอย่าง'],
      [1, 'งานโครงสร้าง'],
      [1.7, 'คอนกรีต'],
      ['', ' - คอนกรีตหยาบ', 14, 'ลบ.ม.'],
      ['', ' - กล้องวงจรปิดแบบมุมมองคงที่', 28, 'ชุด'],
      ['', 'ภายในอาคาร สำหรับใช้งานทั่วไป'],
      ['', 'LP3'],
    ]);
    expect(lines.map((l) => [l.isCategory, l.qty === '' ? 'text' : 'item', l.description])).toEqual([
      [false, 'text', 'อาคารตัวอย่าง'],
      [true, 'text', 'งานโครงสร้าง'],
      [false, 'text', 'คอนกรีต'],
      [false, 'item', '- คอนกรีตหยาบ'],
      [false, 'item', '- กล้องวงจรปิดแบบมุมมองคงที่'],
      [false, 'text', 'ภายในอาคาร สำหรับใช้งานทั่วไป'],
      [false, 'text', 'LP3'],
    ]);
    expect(lines[2]).toMatchObject({ isBold: true, no: '1.7' });
  });

  test('without numbered sections, plain headings become the categories', () => {
    const { lines } = read([['', 'ค่าใช้จ่ายพิเศษ'], ['', ' - รายละเอียดย่อย'], [1, 'ค่าเครน', 1, 'งาน', 170000]]);
    expect(lines.map((l) => l.isCategory)).toEqual([true, false, false]);
  });

  test('a form with one lump-sum column gives a rate per unit', () => {
    const r = parseBoqWorkbook([
      sheet('ปร.4 พิเศษ', [
        ['ลำดับที่', '', 'จำนวน', 'หน่วย', 'ค่าใช้จ่ายรวม', '', 'หมายเหตุ'],
        ['', '', '', '', '(ค่าก่อสร้าง)'],
        ['', 'ค่าใช้จ่ายพิเศษตามข้อกำหนด'],
        [1, 'ค่าเครน', 2, 'งาน', 170000],
        ['', 'รวม', '', '', 170000],
      ]),
    ]);
    expect(r.lines).toMatchObject([{ isCategory: true, description: 'ค่าใช้จ่ายพิเศษตามข้อกำหนด' }, { qty: 2, matRate: 85000, labRate: '' }]);
    expect(r.unpricedItems).toBe(0);
  });

  test('a remark written one column past the heading is kept, but helper figures are not', () => {
    const { lines } = read([
      ['', 'ขนย้ายดิน', 925, 'ลบ.ม.', '', '', '', '', 0, '', 'คิดค่าขนส่ง 15 กม.'],
      ['', 'เบรกเกอร์', 3, 'Set', '', '', '', '', 0, '', 0, '', 0],
    ]);
    expect(lines.map((l) => l.note)).toEqual(['คิดค่าขนส่ง 15 กม.', '']);
  });

  test('empty price cells stay empty rather than becoming a price of zero, and are counted', () => {
    const r = read([['', 'เจาะสำรวจ', 2, 'จุด'], ['', 'คอนกรีต', 1, 'ลบ.ม.', 100]]);
    expect(r.lines[0]).toMatchObject({ matRate: '', labRate: '' });
    expect(r.unpricedItems).toBe(1);
  });

  test('values round the way the save stores them', () => {
    const { lines } = read([['', 'ตะปู', 1728.2256, 'กก.', 12.345, '', 6.784]]);
    expect(lines[0]).toMatchObject({ qty: 1728.226, matRate: 12.35, labRate: 6.78 });
  });

  test('flags a row whose amount in the file differs from quantity × rate, allowing for rounding', () => {
    const r = read([
      ['', 'ถูก', 2, 'จุด', 100, 200, 50, 100, 300],
      ['', 'ปัดเศษ', 3, 'จุด', 33.33, 100, 0, 0, 100],
      ['', 'ผิด', 2, 'จุด', 100, 999, 50, 100, 1099],
    ]);
    expect(r.amountMismatches).toEqual(['ปร.4 แถว 9']);
  });

  test('a formula amount that has not been worked out (zero) is not a mismatch', () => {
    expect(read([['', 'ยังไม่คำนวณ', 2, 'จุด', 100, 0, 50, 0, 0]]).amountMismatches).toEqual([]);
  });

  test('reports a quantity it cannot read, by sheet and row, instead of guessing', () => {
    const r = read([['', 'ติดลบ', -5, 'จุด', 10], ['', 'คำ', 'เหมา', 'งาน', 10]]);
    expect(r.unreadable).toEqual(['ปร.4 แถว 7: จำนวนติดลบ', 'ปร.4 แถว 8: จำนวน "เหมา" ไม่ใช่ตัวเลข']);
    expect(r.lines.map((l) => l.qty)).toEqual(['', '']);
  });

  test('skips repeated page headings, signatures and rows with no description', () => {
    const { lines } = read([
      ['ลำดับที่', '', 'จำนวน', 'หน่วย'],
      ['', '', '', '', '', '', '', '', 0],
      ['', '(ลงชื่อ)  ผู้ประมาณราคา'],
      ['', 'ของจริง', 1, 'งาน'],
    ]);
    expect(lines.map((l) => l.description)).toEqual(['ของจริง']);
  });

  test('clips text to what the save accepts', () => {
    const { lines } = read([['1.2.3.4.5.6.7.8.9.10.11.12', 'ก'.repeat(1200), 1, 'ห'.repeat(60)]]);
    expect(lines[0]!.no).toHaveLength(20);
    expect(lines[0]!.description).toHaveLength(1000);
    expect(lines[0]!.unit).toHaveLength(50);
  });
});

describe('the details above the table', () => {
  test('reads the project, owner, site and date, with the Buddhist year', () => {
    expect(parseBoqWorkbook([form('ปร.4', [])]).meta).toEqual({
      projectName: 'อาคารตัวอย่าง',
      owner: 'เทศบาลตัวอย่าง',
      location: 'ตำบลตัวอย่าง จังหวัดตัวอย่าง',
      estimateDate: '2025-12-18',
    });
  });

  test('the first sheet that says wins', () => {
    const later = sheet('ปร.4 อื่น', [['', 'เจ้าของ', 'เจ้าของอื่น'], ...FORM_HEADING]);
    expect(parseBoqWorkbook([form('ปร.4', []), later]).meta.owner).toBe('เทศบาลตัวอย่าง');
  });
});

describe('the template the system itself gives out', () => {
  test('still imports', () => {
    const r = parseBoqWorkbook([
      sheet('Sheet1', [
        ['ลำดับ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วยวัสดุ', 'ราคาต่อหน่วยค่าแรง', 'หมายเหตุ'],
        ['1', 'หมวดงานที่ 1 งานโครงสร้าง'],
        ['1.1', 'คอนกรีตผสมเสร็จ 240 ksc', 10, 'ลบ.ม.', 2200, 350],
        ['1.2', 'เหล็กเสริม DB12', '1,500', 'กก.', 28, 6, 'รวมค่าดัด'],
      ]),
    ]);
    expect(r.lines).toEqual([
      { isCategory: true, isBold: true, no: '1', description: 'หมวดงานที่ 1 งานโครงสร้าง', qty: '', unit: '', matRate: '', labRate: '', note: '' },
      { isCategory: false, isBold: false, no: '1.1', description: 'คอนกรีตผสมเสร็จ 240 ksc', qty: 10, unit: 'ลบ.ม.', matRate: 2200, labRate: 350, note: '' },
      { isCategory: false, isBold: false, no: '1.2', description: 'เหล็กเสริม DB12', qty: 1500, unit: 'กก.', matRate: 28, labRate: 6, note: 'รวมค่าดัด' },
    ]);
  });
});
