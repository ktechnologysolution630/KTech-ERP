import { describe, expect, test } from 'vitest';
import { stockCategoryOfBoq } from '@/domain/pr-boq';

describe('stockCategoryOfBoq', () => {
  // Category headings as they come in a government estimate (ปร.4)
  test.each([
    ['งานวิศวกรรมโครงสร้าง', 'งานโครงสร้าง'],
    ['งานฐานราก', 'งานโครงสร้าง'],
    ['งานสถาปัตยกรรม', 'งานสถาปัตยกรรม'],
    ['งานระบบไฟฟ้า ,ระบบสื่อสาร และระบบป้องกันอัคคีภัย', 'งานระบบไฟฟ้าและสื่อสาร'],
    ['งานระบบภาพเสียง ห้องประชุม', 'งานระบบไฟฟ้าและสื่อสาร'],
    ['งานสุขาภิบาล', 'งานสุขาภิบาล'],
    ['ระบบปรับอากาศและระบายอากาศ', 'งานระบบปรับอากาศ'],
    ['ครุภัณฑ์จัดซื้อ', 'ครุภัณฑ์'],
  ])('%s → %s', (name, category) => {
    expect(stockCategoryOfBoq(name)).toBe(category);
  });

  test('a heading that names no category is left open', () => {
    expect(stockCategoryOfBoq('ค่าใช้จ่ายพิเศษตามข้อกำหนด')).toBeNull();
  });
});
