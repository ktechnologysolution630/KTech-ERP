import { describe, expect, test } from 'vitest';
import { findDates, linesFromTextItems, normalizeLine, ProjectDetailsCollector } from '@/domain/project-pdf';

const collect = (...pages: string[][]) => {
  const c = new ProjectDetailsCollector();
  pages.forEach((p) => c.addPage(p));
  return c;
};

describe('project details from a PDF', () => {
  test('picks out the form fields and ignores everything else on the page', () => {
    const { details } = collect([
      'สัญญาจ้างก่อสร้าง เลขที่ 12/2569',
      'ชื่อโครงการ: ก่อสร้างอาคารสำนักงานใหญ่ พระราม 9',
      'รหัสโครงการ : K69-009',
      'ผู้ว่าจ้าง บริษัท สยามพัฒนา จำกัด',
      'กลุ่มโครงการ: โครงการภาคกลาง',
      'สถานที่ก่อสร้าง: ถนนพระราม 9 กรุงเทพมหานคร',
      'วันเริ่มสัญญา 4 พฤศจิกายน 2569',
      'วันสิ้นสุดสัญญา 29/03/2570',
      'มูลค่าสัญญา 19,454,000.00 บาท (สิบเก้าล้านสี่แสนห้าหมื่นสี่พันบาทถ้วน)',
      'สถานะ: กำลังดำเนินการ',
      'ผู้ลงนาม นายสมชาย ใจดี โทร 081-234-5678',
    ]);
    expect(details).toEqual({
      name: 'ก่อสร้างอาคารสำนักงานใหญ่ พระราม 9',
      code: 'K69-009',
      clientName: 'บริษัท สยามพัฒนา จำกัด',
      projectGroup: 'โครงการภาคกลาง',
      location: 'ถนนพระราม 9 กรุงเทพมหานคร',
      startDate: '2026-11-04',
      endDate: '2027-03-29',
      budget: '19454000.00',
      status: 'IN_PROGRESS',
    });
  });

  test('two columns on one line stay in their own fields', () => {
    const { details } = collect(['ชื่อโครงการ: บ้านพักพนักงาน ลูกค้า: คุณวิชัย', 'วันเริ่ม 01/02/2026 วันสิ้นสุด 03/04/2026']);
    expect(details).toMatchObject({ name: 'บ้านพักพนักงาน', clientName: 'คุณวิชัย', startDate: '2026-02-01', endDate: '2026-04-03' });
  });

  test('a value on the line below its label is found, unless that line is another label', () => {
    expect(collect(['ชื่อโครงการ', 'โรงงานผลิตชิ้นส่วน']).details.name).toBe('โรงงานผลิตชิ้นส่วน');
    expect(collect(['ลูกค้า', 'สถานที่ ชลบุรี']).details).toEqual({ location: 'ชลบุรี' });
  });

  test('a more specific label on a later page wins; a vaguer one does not', () => {
    expect(collect(['โครงการ: ทั่วไป'], ['ชื่อโครงการ: ชัดเจน']).details.name).toBe('ชัดเจน');
    expect(collect(['ชื่อโครงการ: ชัดเจน'], ['โครงการ: ทั่วไป']).details.name).toBe('ชัดเจน');
  });

  test('does not mistake words inside other text for a label', () => {
    expect(collect(['เจ้าของโครงการ: คุณเอ']).details).toEqual({ clientName: 'คุณเอ' });
    expect(collect(['โครงการนี้จะแล้วเสร็จในปีหน้า']).details).toEqual({});
    expect(collect(['ค่าสถานที่จัดเก็บ 500 บาท']).details).toEqual({});
  });

  test('leaves a field empty rather than guessing a bad value', () => {
    expect(collect(['งบประมาณ ตามที่ตกลง', 'วันเริ่ม ยังไม่กำหนด', 'สถานะ: ไม่ทราบ']).details).toEqual({});
    expect(collect(['งบประมาณ 0.00']).details).toEqual({});
    expect(collect([`ชื่อโครงการ: ${'ก'.repeat(301)}`]).details).toEqual({});
    expect(collect(['วันเริ่ม 31/02/2026']).details).toEqual({});
  });

  test('a period names both dates, and a labelled date still takes priority', () => {
    expect(collect(['ระยะเวลาก่อสร้าง ตั้งแต่ 1 ม.ค. 69 ถึง 31 ธ.ค. 69']).details).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(collect(['ระยะเวลา 1 ม.ค. 2569 ถึง 31 ธ.ค. 2569'], ['วันเริ่ม 15/01/2026']).details).toMatchObject({ startDate: '2026-01-15', endDate: '2026-12-31' });
  });

  test('Thai digits and split Thai letters are read', () => {
    expect(collect(['งบ ประมาณ ๑,๒๐๐.๕๐ บาท']).details.budget).toBe('1200.50');
    expect(collect(['ชื่อ โครง การ : ทดสอบ']).details.name).toBe('ทดสอบ');
  });

  test('a font that lost tone marks above vowels still gives its fields, and says it guessed', () => {
    // These lines are what pdf.js extracted from a Thai PDF printed from a browser in Tahoma
    const c = collect([
      'สัญญาเลขที\u0000 12/2569 ทำขึ\u0000นระหว่างคู่สัญญาดังต่อไปนี\u0000',
      'ชื\u0000อโครงการ: ก่อสร้างอาคารสำนักงานใหญ่ พระราม 9 รหัสโครงการ: K69-777',
      'สถานที\u0000ก่อสร้าง: ถนนพระราม 9 กรุงเทพมหานคร',
      'วันเริ\u0000มสัญญา 4 พฤศจิกายน 2569',
      'วันสิ\u0000นสุดสัญญา 29 มีนาคม 2570',
    ]);
    expect(c.details).toEqual({
      name: 'ก่อสร้างอาคารสำนักงานใหญ่ พระราม 9',
      code: 'K69-777',
      location: 'ถนนพระราม 9 กรุงเทพมหานคร',
      startDate: '2026-11-04',
      endDate: '2027-03-29',
    });
    expect(c.toneMarksGuessed).toBe(true);
    expect(collect(['ชื่อโครงการ: ปกติ']).toneMarksGuessed).toBe(false);
  });

  test('a lost mark is filled in by word, and เมื่อ is not mistaken for มื้อ', () => {
    expect(normalizeLine('ที\u0000 ชื\u0000อ สิ\u0000น นี\u0000 ซื\u0000อ เมื\u0000อ เรื\u0000อง')).toBe('ที่ ชื่อ สิ้น นี้ ซื้อ เมื่อ เรื่อง');
  });

  test('old fonts keeping Thai marks in the private use area are read', () => {
    expect(normalizeLine('กอ ราน นา')).toBe('ก่อ ร้าน น่า');
  });

  test('stops only once something was found and many pages since added nothing', () => {
    const c = new ProjectDetailsCollector();
    for (let i = 0; i < 25; i++) c.addPage(['แบบก่อสร้าง']);
    expect(c.canStop).toBe(false);
    c.addPage(['ชื่อโครงการ: ทดสอบ']);
    expect(c.canStop).toBe(false);
    for (let i = 0; i < 20; i++) c.addPage(['แบบก่อสร้าง']);
    expect(c.canStop).toBe(true);
  });
});

describe('dates in text', () => {
  test('reads written Thai dates and numeric ones, in order', () => {
    expect(findDates('4 พฤศจิกายน 2569 และ 29/03/2027 และ 1 ม.ค. พ.ศ. 2570')).toEqual(['2026-11-04', '2027-03-29', '2027-01-01']);
    expect(findDates('31 กุมภาพันธ์ 2569')).toEqual([]);
    expect(findDates('12 ชิ้น 2569')).toEqual([]);
  });
});

describe('text pieces into lines', () => {
  const item = (str: string, x: number, y: number, width = 10) => ({ str, x, y, width, height: 10 });

  test('orders top to bottom and left to right, spacing only real gaps', () => {
    expect(linesFromTextItems([item('ล่าง', 0, 100), item('ขวา', 200, 300), item('ซ้าย', 0, 300), item('ติด', 210, 300), item(' ', 300, 300)])).toEqual(['ซ้าย ขวาติด', 'ล่าง']);
  });

  test('pieces slightly off the baseline stay on one line', () => {
    expect(linesFromTextItems([item('ก', 0, 100), item('ข', 10, 98)])).toEqual(['กข']);
  });

  test('a lost mark reaches the collector, so it can say it guessed', () => {
    const c = new ProjectDetailsCollector();
    c.addPage(linesFromTextItems([item('ชื\u0000อโครงการ: ทดสอบ', 0, 100)]));
    expect(c.toneMarksGuessed).toBe(true);
    expect(c.details.name).toBe('ทดสอบ');
  });

  test('a page with no text gives no lines', () => {
    expect(linesFromTextItems([])).toEqual([]);
  });
});
