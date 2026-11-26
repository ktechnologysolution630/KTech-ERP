import { describe, expect, it } from 'vitest';
import { kindOfUnit, parseArchicadRows } from '@/domain/archicad-takeoff';
import { parseCsvText } from '@/lib/spreadsheet';

// What scripts/boq_from_archicad.py writes (header, then a heading row and its items)
const CSV = [
  '﻿ลำดับ,รายการ,จำนวน,หน่วย,ราคาต่อหน่วยวัสดุ,จำนวนเงินวัสดุ,ราคาต่อหน่วยค่าแรง,จำนวนเงินค่าแรง,รวมเป็นเงิน,หมายเหตุ',
  '"1","งานโครงสร้าง","","",0,"0.00",0,"0.00","0.00",""',
  '"1.1","คอนกรีตเสา",12.5,"ลบ.ม.",0,"0.00",0,"0.00","0.00","ปริมาณจากโมเดล Archicad: Column 4 ชิ้น (General_NetVolume)"',
  '"2","งานผนัง","","",0,"0.00",0,"0.00","0.00",""',
  '"2.1","ผนัง อิฐมอญ",1250.75,"ตร.ม.",0,"0.00",0,"0.00","0.00","Wall, 2 ชิ้น"',
  '"2.2","ราวกันตก",0,"ม.",0,"0.00",0,"0.00","0.00",""',
  '"3","งานประตู-หน้าต่าง","","",0,"0.00",0,"0.00","0.00",""',
  '"3.1","ประตู ประตูบานเปิด 0.9",3,"ชุด",0,"0.00",0,"0.00","0.00",""',
].join('\r\n');

describe('Archicad CSV', () => {
  it('reads items under their category headings', () => {
    const { rows, skipped } = parseArchicadRows(parseCsvText(CSV));
    expect(rows).toEqual([
      { category: 'งานโครงสร้าง', description: 'คอนกรีตเสา', kind: 'area', unit: 'ลบ.ม.', qty: 12.5, note: 'ปริมาณจากโมเดล Archicad: Column 4 ชิ้น (General_NetVolume)' },
      { category: 'งานผนัง', description: 'ผนัง อิฐมอญ', kind: 'area', unit: 'ตร.ม.', qty: 1250.75, note: 'Wall, 2 ชิ้น' },
      { category: 'งานประตู-หน้าต่าง', description: 'ประตู ประตูบานเปิด 0.9', kind: 'count', unit: 'ชุด', qty: 3, note: '' },
    ]);
    expect(skipped).toEqual(['2.2']);
  });

  it('reads a BOQ export with quantities written with thousands separators', () => {
    const csv = 'ลำดับ,รายการ,จำนวน,หน่วย,หมายเหตุ\n1,ไม่ระบุหมวด,,,\n1.1,ถนนลาดยาง,"1,800",ม.,';
    expect(parseArchicadRows(parseCsvText(csv)).rows).toEqual([{ category: 'ไม่ระบุหมวด', description: 'ถนนลาดยาง', kind: 'length', unit: 'ม.', qty: 1800, note: '' }]);
  });

  it('gives items without a heading a placeholder category', () => {
    const { rows } = parseArchicadRows(parseCsvText('ลำดับ,รายการ,จำนวน,หน่วย\n1.1,เสาเข็ม,24,ต้น'));
    expect(rows[0]).toMatchObject({ category: 'ไม่ระบุหมวด', kind: 'count' });
  });

  it('maps units to the way they are measured', () => {
    expect(kindOfUnit('ม.')).toBe('length');
    expect(kindOfUnit('เมตร')).toBe('length');
    expect(kindOfUnit('ตร.ม.')).toBe('area');
    expect(kindOfUnit('ลบ.ม.')).toBe('area');
    expect(kindOfUnit('บ่อ')).toBe('count');
    expect(kindOfUnit('ชุด')).toBe('count');
  });
});
