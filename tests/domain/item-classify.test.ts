import { describe, expect, it } from 'vitest';
import { detectItemType } from '@/domain/item-classify';

describe('detecting an item type from its name', () => {
  it.each([
    ['สังกะสีลอนเล็ก 0.3 มม.', 'งานสถาปัตยกรรม', 'งานหลังคา'],
    ['ปูนซีเมนต์ ตราช้าง 50 กก.', 'งานโครงสร้าง', 'ปูนซีเมนต์และคอนกรีต'],
    ['เหล็กข้ออ้อย DB12', 'งานโครงสร้าง', 'เหล็กเสริม'],
    ['เหล็กกล่อง 2x4', 'งานโครงสร้าง', 'เหล็กรูปพรรณ'],
    ['ท่อร้อยสาย EMT 1/2"', 'งานระบบไฟฟ้าและสื่อสาร', 'ท่อร้อยสายและรางสาย'],
    ['ท่อ PVC 4 หุน ชั้น 13.5', 'งานสุขาภิบาล', 'ท่อและข้อต่อน้ำดี'],
    ['สาย THW 1x2.5', 'งานระบบไฟฟ้าและสื่อสาร', 'สายไฟฟ้า'],
    ['หลอด LED 18W', 'งานระบบไฟฟ้าและสื่อสาร', 'ดวงโคมและหลอดไฟ'],
    ['แอร์ Daikin 18000 BTU', 'งานระบบปรับอากาศ', 'เครื่องปรับอากาศ'],
    ['หมวกนิรภัย สีขาว', 'อื่น', 'อุปกรณ์ป้องกันอันตรายส่วนบุคคล (PPE)'],
    ['สีทาภายนอก TOA', 'งานสถาปัตยกรรม', 'งานสีและเคลือบผิว'],
    ['กระดาษทรายเบอร์ 80', 'อื่น', 'วัสดุสิ้นเปลืองหน้างาน'],
  ])('%s → %s › %s', (text, category, group) => {
    expect(detectItemType(text)).toMatchObject({ category, group, source: 'keyword' });
  });

  it('does not fire on short words inside other words or on nothing', () => {
    expect(detectItemType('เครื่องเสียง')).toBeNull();
    expect(detectItemType('plan')).toBeNull();
    expect(detectItemType('x')).toBeNull();
  });

  it('follows the register first', () => {
    const register = [{ code: 'MAT-9', name: 'แผ่นพิเศษ XYZ', category: 'งานเตรียมการ' }];
    expect(detectItemType('แผ่นพิเศษ', register)).toMatchObject({ category: 'งานเตรียมการ', source: 'register' });
    const coded = [{ code: '20-05-001', name: 'แผ่นมุงพิเศษ', category: null }];
    expect(detectItemType('แผ่นมุงพิเศษ', coded)).toMatchObject({ category: 'งานสถาปัตยกรรม', group: 'งานหลังคา' });
  });
});
