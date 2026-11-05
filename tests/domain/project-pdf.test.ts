import { describe, expect, test } from 'vitest';
import { amountMatchesWords, findDates, linesFromTextItems, normalizeLine, parseThaiAmount, ProjectDetailsCollector, reconcileReadings } from '@/domain/project-pdf';

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

  test('what OCR read from a scanned contract gives its fields, despite garbled letters', () => {
    // These lines are what the OCR engine returned for a scanned Thai contract
    const { details } = collect([
      'Qs',
      'งัญญาจ้างเหมาก่อสร้าง',
      'สัญญาเลขที 12/2569 ทําขึนระหว่างคู่สัญญาดังต่อไปนี',
      'ชือโครงการ: ก่อสร้างอาคารสํานักงานใหญ่ พระราม 9                 รหัสโครงการ: K69-777',
      'ผู้ว่าจ้าง: บริษัท สยามพัฒนาการก่อสร้าง จํากัด                      กลุ่มโครงการ: โครงการภาคกลาง',
      'สถานทีก่อสร้าง: ถนนพระราม 9 แขวงห้วยขวาง กรุงเทพมหานคร',
      '็นเริ่มสัญญา 4 พฤศจิกายน 2569',
      'วันสินสุดสัญญา 29 มีนาคม 2570',
      'มูลค่าสัญญา 19,454,000.00 บาท (สิบเก้าล้านสี่แสนห้าหมื่นสี่พันบาทถ้วน)',
      'เร้บจ้างตกลงรับจ้างทํางานตามแบบรูปรายการ เบอร์โทร 081-234-5678 เลขผู้เสียภาษี 0105551234567',
    ]);
    expect(details).toEqual({
      name: 'ก่อสร้างอาคารสำนักงานใหญ่ พระราม 9',
      code: 'K69-777',
      clientName: 'บริษัท สยามพัฒนาการก่อสร้าง จำกัด',
      projectGroup: 'โครงการภาคกลาง',
      location: 'ถนนพระราม 9 แขวงห้วยขวาง กรุงเทพมหานคร',
      startDate: '2026-11-04',
      endDate: '2027-03-29',
      budget: '19454000.00',
    });
  });

  test('a date label inside a word still needs a real date after it', () => {
    expect(collect(['การเริ่มต้นงานจะแจ้งให้ทราบ', 'ผลสิ้นสุด ตามที่ตกลง']).details).toEqual({});
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
    expect(c.canStop(20)).toBe(false);
    c.addPage(['ชื่อโครงการ: ทดสอบ']);
    expect(c.canStop(20)).toBe(false);
    for (let i = 0; i < 20; i++) c.addPage(['แบบก่อสร้าง']);
    expect(c.canStop(20)).toBe(true);
  });
});

describe('checking two readings of a scan', () => {
  const scan = (...lines: string[]) => {
    const c = new ProjectDetailsCollector();
    c.addPage(lines, { page: 1, scanned: true });
    return c;
  };

  test('values read the same twice are confirmed, ignoring tone marks and keeping the fuller spelling', () => {
    const r = reconcileReadings(scan('ชื่อโครงการ: อาคารศูนย์ทีหนึ่ง', 'รหัสโครงการ: K69-777'), scan('ชื่อโครงการ: อาคารศูนย์ที่หนึ่ง', 'รหัสโครงการ: K69-777'));
    expect(r.details).toEqual({ name: 'อาคารศูนย์ที่หนึ่ง', code: 'K69-777' });
    expect(r.confirmed).toEqual(['name', 'code']);
    expect(r.needsCheck).toEqual([]);
    expect(r.refused).toEqual([]);
  });

  test('numbers, dates and codes that disagree fill in nothing and show both readings', () => {
    const r = reconcileReadings(
      scan('งบประมาณ 19,454,000.00', 'วันเริ่ม 04/11/2026', 'รหัสโครงการ: K69-777'),
      scan('งบประมาณ 19,454,800.00', 'วันเริ่ม 04/11/2028', 'รหัสโครงการ: 69-777'),
    );
    expect(r.details).toEqual({});
    expect(r.refused).toEqual([
      { field: 'code', readings: ['K69-777', '69-777'] },
      { field: 'startDate', readings: ['2026-11-04', '2028-11-04'] },
      { field: 'budget', readings: ['19454000.00', '19454800.00'] },
    ]);
  });

  test('the amount in words settles a budget, even when the two readings disagree', () => {
    const words = '(สิบเก้าล้านสี่แสนห้าหมื่นสี่พันบาทถ้วน)';
    const r = reconcileReadings(scan(`มูลค่าสัญญา 19,454,800.00 บาท`), scan(`มูลค่าสัญญา 19,454,000.00 บาท ${words}`));
    expect(r.details.budget).toBe('19454000.00');
    expect(r.confirmed).toEqual(['budget']);
    // Words naming another amount confirm nothing
    expect(amountMatchesWords('19454800.00', words)).toBe(false);
    expect(amountMatchesWords('19454000.00', 'สิบเก้าล้านสี่แสนห้าหมื่นสี่พัน บาท ถ้วน')).toBe(true);
    // OCR often drops tone marks; the amount named is still the same
    expect(amountMatchesWords('19454000.00', 'สิบเกาลานสีแสนหาหมืนสีพันบาทถวน')).toBe(true);
  });

  test('wording that differs is filled in but marked to check', () => {
    const r = reconcileReadings(scan('ชื่อโครงการ: อาคารสำนักงน'), scan('ชื่อโครงการ: อาคารสำนักงาน'));
    expect(r.details.name).toBe('อาคารสำนักงาน');
    expect(r.needsCheck).toEqual(['name']);
  });

  test('a value only one reading found is marked to check', () => {
    const r = reconcileReadings(scan('งบประมาณ 100.00', 'ลูกค้า: คุณเอ'), scan('ลูกค้า: คุณเอ'));
    expect(r.details).toEqual({ budget: '100.00', clientName: 'คุณเอ' });
    expect(r.needsCheck).toEqual(['budget']);
    expect(r.confirmed).toEqual(['clientName']);
  });

  test('stopped before the second reading, everything from the scan is marked to check', () => {
    const r = reconcileReadings(scan('ลูกค้า: คุณเอ', 'งบประมาณ 100.00'), null);
    expect(r.confirmed).toEqual([]);
    expect(r.needsCheck).toEqual(['clientName', 'budget']);
  });

  test('a start after the end fills in neither date', () => {
    const lines = ['วันเริ่ม 01/05/2027', 'วันสิ้นสุด 01/05/2026'];
    const r = reconcileReadings(scan(...lines), scan(...lines));
    expect(r.details).toEqual({});
    expect(r.refused.map((f) => f.field)).toEqual(['startDate', 'endDate']);
  });

  test('real text in the file needs no second reading', () => {
    const c = new ProjectDetailsCollector();
    c.addPage(['ลูกค้า: คุณเอ'], { page: 1, scanned: false });
    expect(c.scannedSourcePages).toEqual([]);
    expect(reconcileReadings(c, null).confirmed).toEqual(['clientName']);
  });

  test('knows which scanned pages gave values, and when it has enough to stop', () => {
    const c = new ProjectDetailsCollector();
    c.addPage(['แบบก่อสร้าง'], { page: 1, scanned: true });
    c.addPage(['ชื่อโครงการ: ก', 'ลูกค้า: ข', 'สถานที่: ค'], { page: 2, scanned: true });
    expect(c.hasCoreDetails).toBe(false);
    c.addPage(['วันเริ่ม 01/01/2026', 'งบประมาณ 100'], { page: 4, scanned: true });
    expect(c.hasCoreDetails).toBe(true);
    expect(c.scannedSourcePages).toEqual([2, 4]);
  });
});

describe('a Thai government contract, which has sentences instead of labelled fields', () => {
  // Shaped like what OCR returned for a real scanned contract, with the names and figures made up.
  // The bracketed amounts read correctly; the Thai digits are wrong in the same way on both readings.
  const scannedContract = [
    'or',
    'สัญญาจ้างปรับปรุงอาคารสำนักงานเทศบาลเมืองตัวอย่างเป็นศูนย์บริการประชาชน',
    'สัญญาเลขที ฆ/๒๕๒๐๕',
    'ว)  o Xo &       YY vw a oo',
    'สัญญาฉบับนี้ทําขึ้น ณ สำนักงานเทศบาลเมืองตัวอย่าง',
    'เมื่อวันที่ ๑๕ กันยายน ๒๕๒๐๕ ระหว่าง เทศบาลเมืองตัวอย่าง โดย นายสมมติ ใจดี ตําแหน่ง นายกเทศมนตรี',
    'ซึ่งต่อไปในสัญญานี่เรียกว่า "ผู้ว่าจ้าง" ฝ่ายหนึ่ง กับ บริษัท ผู้รับเหมาตัวอย่าง จํากัด',
    'ซึงต่อไปในสัญญานี่เรียกว่า "ผู้รับจ้าง" อีกฝ่ายหนึ่ง',
    'ผู้ว่าจ้างตกลงจ้างและผู้รับจ้างตกลงรับจ้างทํางาน ปรับปรุงอาคารสำนักงาน',
    'ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding) ณ สำนักงานเทศบาลเมืองตัวอย่าง ตำบลในเมือง',
    'vw ow a a      Pl   ๑.    PE',
    'อำเภอเมือง จังหวัดตัวอย่าง ตามข้อกําหนดและเงื่อนไขแห่งสัญญานี้',
  ];
  const paymentPage = [
    'เป็นจํานวนเงิน ๒,๕๕๓๕,๐๐.๐๐ UM',
    '(สองล้านสี่แสนสี่หมื่นเจ็ดพันเจ็ดร้อยบาทถ้วน) ซึ่งเท่ากับร้อยละ ๕ (ห้า) ของราคาค่าจ้างตามสัญญา',
    'ผู้ว่าจ้าง ตกลงจ่าย และผู้รับจ้างตกลงรับเงินค่าจ้างจํานวนเงิน ๕๕,๕๕๕,๐๐๐.๐๐ UM (สีสิบแปดล้าน',
    'ม',
    'เก้าแสนห้าหมื่นสี่พันบาทถ้วน) ซึ่งได้รวมภาษีมูลค่าเพิ่ม จํานวน ๓,๒๐๒,๕๕๕.๑๓ UN (สามล้านสองแสนสองพันบาท',
  ];
  const scan = (page: number, lines: string[]) => [lines, { page, scanned: true }] as const;
  const read = () => {
    const c = new ProjectDetailsCollector();
    c.addPage(...scan(1, scannedContract));
    c.addPage(...scan(2, paymentPage));
    return c;
  };

  test('takes the project, client, site and budget from the sentences', () => {
    expect(read().details).toEqual({
      name: 'ปรับปรุงอาคารสำนักงานเทศบาลเมืองตัวอย่างเป็นศูนย์บริการประชาชน',
      clientName: 'เทศบาลเมืองตัวอย่าง',
      location: 'สำนักงานเทศบาลเมืองตัวอย่าง ตำบลในเมือง อำเภอเมือง จังหวัดตัวอย่าง',
      budget: '48954000.00',
    });
  });

  test('a sentence that begins with the word for the hirer is not a client', () => {
    expect(collect(['ผู้ว่าจ้าง ตกลงจ่าย และผู้รับจ้างตกลงรับเงินค่าจ้างจำนวน']).details).toEqual({});
    expect(collect(['ผู้ว่าจ้าง มีสิทธิบอกเลิกสัญญาได้']).details).toEqual({});
    expect(collect(['ลูกค้า ชำระเงินภายใน 30 วัน']).details).toEqual({});
    expect(collect(['ผู้ว่าจ้าง: ตกลงเอง']).details.clientName).toBe('ตกลงเอง');
    expect(collect(['ผู้ว่าจ้าง บริษัท ตัวอย่าง จำกัด']).details.clientName).toBe('บริษัท ตัวอย่าง จำกัด');
  });

  test('the contractor is not taken as the client when the hirer is named second', () => {
    const c = collect(['ระหว่าง บริษัท ผู้รับเหมา จำกัด โดย นายเอ ซึ่งต่อไปเรียกว่า "ผู้รับจ้าง" ฝ่ายหนึ่ง กับ เทศบาล ซึ่งต่อไปเรียกว่า "ผู้ว่าจ้าง" อีกฝ่ายหนึ่ง']);
    expect(c.details.clientName).toBeUndefined();
  });

  test('a page whose only value is settled by the amount in words is not read again', () => {
    const c = new ProjectDetailsCollector();
    c.addPage(...scan(2, paymentPage));
    expect(c.details).toEqual({ budget: '48954000.00' });
    expect(c.scannedSourcePages).toEqual([]);
    expect(read().scannedSourcePages).toEqual([1]);
  });

  test('when wording differs, the reading that lost no letters is kept whichever came first', () => {
    const one = (name: string) => {
      const c = new ProjectDetailsCollector();
      c.addPage([`ชื่อโครงการ: ${name}`], { page: 1, scanned: true });
      return c;
    };
    const whole = 'อาคารจังหวัดตัวอย่าง';
    const damaged = 'อาคารงหวัดตัวอย่าง';
    expect(reconcileReadings(one(whole), one(damaged)).details.name).toBe(whole);
    expect(reconcileReadings(one(damaged), one(whole)).details.name).toBe(whole);
  });

  test('the budget from words is confirmed even though the digits are wrong on both readings', () => {
    const r = reconcileReadings(read(), read());
    expect(r.details.budget).toBe('48954000.00');
    expect(r.confirmed).toContain('budget');
  });

  test('scanned Thai digits are never trusted, even when both readings agree', () => {
    const lines = ['วันเริ่มสัญญา ๑๕ กันยายน ๒๕๒๕', 'วันสิ้นสุดสัญญา ๑๕ กันยายน ๒๕๒๖', 'งบประมาณ ๑๕,๐๐๐.๐๐', 'รหัสโครงการ: ๑๕-๐๐๑'];
    const reading = () => {
      const c = new ProjectDetailsCollector();
      c.addPage(lines, { page: 1, scanned: true });
      return c;
    };
    const r = reconcileReadings(reading(), reading());
    expect(r.details).toEqual({});
    expect(r.refused.map((f) => [f.field, f.thaiDigits])).toEqual([['code', true], ['startDate', true], ['endDate', true], ['budget', true]]);
    expect(r.refused.every((f) => f.readings.length === 0)).toBe(true);
  });

  test('Thai digits typed into a real text PDF are exact, and arabic digits in a scan still compare as before', () => {
    const c = new ProjectDetailsCollector();
    c.addPage(['วันเริ่มสัญญา ๑๔ กันยายน ๒๕๖๙'], { page: 1, scanned: false });
    expect(reconcileReadings(c, null)).toMatchObject({ details: { startDate: '2026-09-14' }, confirmed: ['startDate'] });
    const scanned = () => {
      const s = new ProjectDetailsCollector();
      s.addPage(['วันเริ่มสัญญา 14/09/2026'], { page: 1, scanned: true });
      return s;
    };
    expect(reconcileReadings(scanned(), scanned()).confirmed).toEqual(['startDate']);
  });

  test('the standard clause on when work starts and ends gives both dates', () => {
    const c = collect(['ผู้รับจ้างต้องเริ่มทำงานที่รับจ้างภายในวันที่ 1 ตุลาคม 2569 และจะต้องทำงานให้แล้วเสร็จบริบูรณ์ภายในวันที่ 30 พฤศจิกายน 2570']);
    expect(c.details).toMatchObject({ startDate: '2026-10-01', endDate: '2027-11-30' });
  });
});

describe('amounts written in Thai words', () => {
  test.each([
    ['สี่สิบแปดล้านเก้าแสนห้าหมื่นสี่พันบาทถ้วน', '48954000.00'],
    ['สองล้านสี่แสนสี่หมื่นเจ็ดพันเจ็ดร้อยบาทถ้วน', '2447700.00'],
    ['สามล้านสองแสนสองพันห้าร้อยเก้าสิบแปดบาทสิบสามสตางค์', '3202598.13'],
    ['หนึ่งร้อยเอ็ดบาทถ้วน', '101.00'],
    ['ยี่สิบเอ็ดบาทถ้วน', '21.00'],
    ['สิบบาทถ้วน', '10.00'],
    ['หนึ่งร้อยล้านบาทถ้วน', '100000000.00'],
    ['สีสิบแปดล้าน เก้าแสนห้าหมืนสีพันบาทถ้วน', '48954000.00'],
  ])('%s', (words, amount) => {
    expect(parseThaiAmount(words)).toBe(amount);
  });

  test('a misread word gives nothing rather than a wrong amount', () => {
    expect(parseThaiAmount('สีสิบแปดลถ้านบาทถ้วน')).toBeNull();
    expect(parseThaiAmount('ไม่ทราบบาทถ้วน')).toBeNull();
    expect(parseThaiAmount('สี่สิบแปดล้าน')).toBeNull();
    expect(parseThaiAmount('สองสามบาทถ้วน')).toBeNull();
    expect(parseThaiAmount('ร้อยบาทถ้วน')).toBeNull();
    expect(parseThaiAmount('')).toBeNull();
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
