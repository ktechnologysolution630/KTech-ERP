import { describe, expect, test } from 'vitest';
import { boqTaskOutline, type BoqOutlineRow } from '@/domain/task-groups';

const row = (no: string, description: string, opts: Partial<BoqOutlineRow> = {}): BoqOutlineRow => ({
  isCategory: false,
  no,
  description,
  qty: null,
  materialRate: null,
  laborRate: null,
  ...opts,
});

describe('boqTaskOutline', () => {
  test('sections become groups and their unpriced sub-headings become หมวดงาน', () => {
    const outline = boqTaskOutline([
      row('1', 'งานวิศวกรรมโครงสร้าง', { isCategory: true }),
      row('1.1', 'งานฐานราก'),
      row('1.1.1', 'เสาเข็ม', { qty: '10', materialRate: '2000' }),
      row('', '- ต่อจากบรรทัดบน'),
      row('1.11', 'งานโครงหลังคา'),
      row('2', 'งานสถาปัตยกรรม', { isCategory: true }),
      row('2.1', 'งานผนัง'),
      // A section the import did not flag: whole number, no price
      row('4', 'งานระบบสุขาภิบาล'),
      row('4.1', 'งานท่อน้ำดี'),
      row('4.1.1', 'ท่อ PVC', { qty: '5', laborRate: '50' }),
    ]);
    expect(outline).toEqual([
      {
        label: '1 งานวิศวกรรมโครงสร้าง',
        title: 'งานวิศวกรรมโครงสร้าง',
        categories: [
          { label: '1.1 งานฐานราก', title: 'งานฐานราก' },
          { label: '1.11 งานโครงหลังคา', title: 'งานโครงหลังคา' },
        ],
      },
      { label: '2 งานสถาปัตยกรรม', title: 'งานสถาปัตยกรรม', categories: [{ label: '2.1 งานผนัง', title: 'งานผนัง' }] },
      {
        label: '4 งานระบบสุขาภิบาล',
        title: 'งานระบบสุขาภิบาล',
        categories: [{ label: '4.1 งานท่อน้ำดี', title: 'งานท่อน้ำดี' }],
      },
    ]);
  });

  test('a priced row numbered with a whole number is an item, not a section', () => {
    const outline = boqTaskOutline([
      row('1', 'งานโครงสร้าง', { isCategory: true }),
      row('2', 'ค่าดำเนินการ', { qty: '1', materialRate: '5000' }),
    ]);
    expect(outline.map((g) => g.title)).toEqual(['งานโครงสร้าง']);
  });
});
