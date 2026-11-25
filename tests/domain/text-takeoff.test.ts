import { describe, expect, it } from 'vitest';
import { extractTextItems, fixOcrThai, normalizeThai } from '@/domain/text-takeoff';

// Lines as OCR read them off a scanned Thai road drawing (tone marks lost, ส read as ล, ำ as ํ+า)
const sheet14 = [
  'ทิคเหนือ',
  'ปรับปรุงประตูเหล็กดัดอิตาลี (ดูแบบขยายแผ่นที่ 127)',
  'ก่อลร้างปรับปรุงถนนลาดยางแอสฟัลท์ติกคอนกรีต',
  'บริเวณภายในลวนสมเด็จพระครีนครินทร์',
  'กวางประมาณ 5.00 เมตร ยาวประมาณ 1,800.00 เมตร หนา 0.05 เมตร',
  'พนทประมาณ 9,000.00 ตารางเมตร (ไมรวมพื้นทีบอพัก คลัล.)',
  '(ดูแบบขยายแผนที 37)',
  'ทอระบายนํา HDPE AN. 0.40 ม. ชั้นคุณภาพไมตํากวา รม 4 ฝั่งเดียว',
  'บอพัก คลล.ขนาด 0.90x1.50 ม.จํานวน 90 บอฝังเดียว (ดูแบบขยายแผนที่ 59)',
];

describe('quantities written on the drawing', () => {
  it('puts back what OCR drops', () => {
    expect(normalizeThai('จํานวน')).toBe('จำนวน');
    expect(fixOcrThai('ก่อลร้างปรับปรุง')).toBe('ก่อสร้างปรับปรุง');
    expect(fixOcrThai('บอพัก คลล.ขนาด')).toBe('บ่อพัก คสล.ขนาด');
  });

  it('reads lengths, areas and counts with the work they belong to', () => {
    const items = extractTextItems(sheet14.map((text) => ({ page: 14, text })));
    const road = items.find((i) => i.unit === 'ม.')!;
    expect(road).toMatchObject({ kind: 'length', qty: 1800, description: 'ก่อสร้างปรับปรุงถนนลาดยางแอสฟัลท์ติกคอนกรีต' });
    const area = items.find((i) => i.unit === 'ตร.ม.')!;
    expect(area).toMatchObject({ kind: 'area', qty: 9000, description: 'ก่อสร้างปรับปรุงถนนลาดยางแอสฟัลท์ติกคอนกรีต' });
    const pits = items.find((i) => i.unit === 'บ่อ')!;
    expect(pits.qty).toBe(90);
    expect(pits.kind).toBe('count');
    expect(pits.description).toContain('บ่อพัก คสล.');
    expect(items).toHaveLength(3);
  });

  it('counts the same note on several sheets once, and keeps different quantities apart', () => {
    const lines = [
      ...sheet14.map((text) => ({ page: 14, text })),
      ...sheet14.map((text) => ({ page: 16, text: text.replace('บอพัก', 'ปอพัก') })),
      { page: 38, text: 'ทาลีพืนทางจักรยาน พื้นที่ประมาณ 2,700 ตารางเมตร' },
      { page: 38, text: 'ทาลีลัญลักษณจักรยานและคนวิงทุกระยะ 100 เมตร' },
      { page: 38, text: 'จำนวน 36 จุด (ดูแบบขยายแผนที่ 56)' },
      { page: 39, text: 'ความยาวรวมประมาณ 1.2 กม.' },
      { page: 40, text: 'เสาเข็ม คอร. ขนาด 0.18x0.18 ม. ยาว 6.00 ม./ต้น' },
    ];
    const items = extractTextItems(lines);
    expect(items.find((i) => i.qty === 1800)!.pages).toEqual([14, 16]);
    expect(items.find((i) => i.unit === 'บ่อ')!.pages).toEqual([14, 16]);
    expect(items.find((i) => i.qty === 2700)).toMatchObject({ unit: 'ตร.ม.', description: 'ทาสีพืนทางจักรยาน' });
    expect(items.find((i) => i.qty === 36)).toMatchObject({ unit: 'จุด', description: 'ทาสีสัญลักษณ์จักรยานและคนวิ่งทุกระยะ 100 เมตร' });
    // A per-piece size is not a quantity
    expect(items.find((i) => i.qty === 6)).toBeUndefined();
    // A length with no named work above it on its sheet is left out rather than guessed
    expect(items.find((i) => i.qty === 1200)).toBeUndefined();
  });

  it('joins a quantity read under a garbled name with the same quantity named on other sheets', () => {
    const note = 'พื้นที่รวมประมาณ 1,020.00 ตารางเมตร (ดูแบบขยายแผ่นที่ 65)';
    const items = extractTextItems([
      { page: 15, text: 'งานพื้นสี TEXTURE ครีบคอนกรีตทางเดินรอบสวน' },
      { page: 15, text: note },
      { page: 17, text: 'งานพื้นสี TEXTURE ครีบคอนกรีตทางเดินรอบสวน' },
      { page: 17, text: note },
      { page: 20, text: 'ปรับปรุงราวกันตกเดิม' },
      { page: 20, text: note },
      { page: 22, text: 'วัน / เดือน / ปี' },
      { page: 22, text: note },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qty: 1020, unit: 'ตร.ม.', description: 'งานพื้นสี TEXTURE ครีบคอนกรีตทางเดินรอบสวน', pages: [15, 17, 20, 22] });
  });

  it('folds a digit misread on one sheet into the reading seen on the others', () => {
    const kerb = (page: number, qty: string) => [
      { page, text: 'แนวก่อสร้างคันหิน คสล.รูปแบบที่ 1/คันหิน คสล.รูปแบบที่ 2' },
      { page, text: `ความยาวรวมประมาณ ${qty} เมตร (ดูแบบขยายแผ่นที่ 61)` },
    ];
    const items = extractTextItems([...kerb(38, '3,600.00'), ...kerb(40, '3,600.00'), ...kerb(48, '3,800.00'), { page: 50, text: 'ก่อสร้างท่อระบายน้ำ ยาวประมาณ 1,800.00 เมตร' }, ...[1, 2, 3, 4].map((page) => ({ page, text: 'แบบขยาย' }))]);
    expect(items.find((i) => i.qty === 3600)!.pages).toEqual([38, 40, 48]);
    expect(items.find((i) => i.qty === 3800)).toBeUndefined();
    // Different work is not folded, even one digit apart
    expect(items.find((i) => i.qty === 1800)).toBeDefined();
  });
});
