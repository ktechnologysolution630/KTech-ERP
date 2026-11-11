import { describe, expect, test } from 'vitest';
import { findDate, parseBillText } from '@/domain/bill-scan';

describe('reading a bill', () => {
  test('dates in Buddhist era, numeric or worded, and Thai digits', () => {
    expect(findDate('วันที่ 10/11/2569')).toBe('2026-11-10');
    expect(findDate('Date: 05-01-2026')).toBe('2026-01-05');
    expect(findDate('วันที่ 3 พ.ย. 2569')).toBe('2026-11-03');
    expect(findDate('๑๕ มกราคม ๒๕๖๙')).toBe('2026-01-15');
    expect(findDate('31/02/2569')).toBe('');
    expect(findDate('ไม่มีวันที่')).toBe('');
  });

  test('a tax invoice: vendor, tax id, number, date and the three amounts', () => {
    const f = parseBillText(
      [
        'บริษัท เค เทค เอ็นจิเนียริ่ง จำกัด',
        'บริษัท วัสดุก่อสร้างไทย จำกัด (สำนักงานใหญ่)',
        'เลขประจำตัวผู้เสียภาษี 0-1055-12345-67-8',
        'ผู้ซื้อ เลขประจำตัวผู้เสียภาษี 0105500000000',
        'ใบกำกับภาษี / ใบเสร็จรับเงิน',
        'เลขที่ IV-6911/0042   วันที่ 10/11/2569',
        'ปูนซีเมนต์ 10 ถุง 150.00 1,500.00',
        'รวมเงิน 1,500.00',
        'ภาษีมูลค่าเพิ่ม 7% 105.00',
        'รวมทั้งสิ้น 1,605.00',
      ],
      { ownTaxId: '0105500000000', ownName: 'บริษัท เค เทค เอ็นจิเนียริ่ง จำกัด' },
    );
    expect(f).toEqual({
      vendorName: 'บริษัท วัสดุก่อสร้างไทย จำกัด (สำนักงานใหญ่)',
      taxIds: ['0105512345678'],
      invoiceNo: 'IV-6911/0042',
      date: '2026-11-10',
      total: 1605,
      vat: 105,
      beforeVat: 1500,
    });
  });

  test('sara am read as two marks is put back, so names and labels match what people type', () => {
    // The recogniser writes ำ as ํ + า, with a tone mark on either side of the ํ
    const am = 'ํา';
    const f = parseBillText([`บริษัท วัสดุก่อสร้างไทย จ${am}กัด`, `เลขที่ใบก${am}กับภาษี: TX-001`, `ค่าน้${am}มัน 500.00`, `ยอดช${am}ระ 500.00`, 'รับเงิน 1,000.00']);
    expect(f).toMatchObject({ vendorName: 'บริษัท วัสดุก่อสร้างไทย จำกัด', invoiceNo: 'TX-001', total: 500 });
    expect(parseBillText([`ร้านนํ้าทิพย์`]).vendorName).toBe('ร้านน้ำทิพย์');
  });

  test('a plain receipt without VAT, and unreadable text', () => {
    const f = parseBillText(['ร้านสมชายการช่าง', 'บิลเงินสด No. 00123', '12 ธ.ค. 69', 'ค่าแรง 2,000.00', 'ยอดสุทธิ 2,000.00']);
    expect(f).toMatchObject({ vendorName: 'ร้านสมชายการช่าง', invoiceNo: '00123', date: '2026-12-12', total: 2000, vat: null, beforeVat: 2000 });
    expect(parseBillText(['###', '~~'])).toEqual({ vendorName: '', taxIds: [], invoiceNo: '', date: '', total: null, vat: null, beforeVat: null });
  });
});
