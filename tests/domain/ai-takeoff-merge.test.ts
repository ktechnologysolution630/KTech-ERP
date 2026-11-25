import { describe, expect, it } from 'vitest';
import { checkAgainstDrawing, mergeAcrossPages, type PagedAiItem, type WrittenQty } from '@/domain/ai-takeoff-merge';

const item = (page: number, description: string, qty: number, unit = 'ม.', kind: PagedAiItem['kind'] = 'length', confidence: PagedAiItem['confidence'] = 'high'): PagedAiItem => ({
  page,
  category: 'งานถนน',
  description,
  kind,
  unit,
  qty,
  basis: '',
  confidence,
});

describe('AI items read on several sheets', () => {
  it('counts a note repeated on each plan sheet once', () => {
    const merged = mergeAcrossPages([
      item(14, 'ก่อสร้างถนนลาดยางแอสฟัลท์ติกคอนกรีต', 1800),
      item(14, 'บ่อพัก คสล. 0.90x1.50 ม.', 90, 'บ่อ', 'count'),
      item(16, 'ถนนลาดยางแอสฟัลท์ติกคอนกรีต หนา 5 ซม.', 1800, 'ม'),
      item(16, 'บ่อพัก คสล. ขนาด 0.90x1.50 ม.', 90, 'บ่อ', 'count', 'medium'),
      item(18, 'ก่อสร้างถนนลาดยางแอสฟัลท์ติกคอนกรีต', 1800),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ qty: 1800, pages: [14, 16, 18] });
    expect(merged[1]).toMatchObject({ qty: 90, pages: [14, 16], description: 'บ่อพัก คสล. 0.90x1.50 ม.' });
  });

  it('keeps different work, different quantities and two items on one sheet apart', () => {
    const merged = mergeAcrossPages([
      item(20, 'ท่อระบายน้ำ HDPE 0.40 ม.', 120),
      item(21, 'ท่อระบายน้ำ HDPE 0.40 ม.', 80),
      item(21, 'ทาสีพื้นทางจักรยาน', 120, 'ม.'),
      item(22, 'ทางเท้าพิมพ์ลาย', 5140, 'ตร.ม.', 'area'),
      item(22, 'ทางเท้าพิมพ์ลาย', 5140, 'ตร.ม.', 'area'),
      item(23, 'Kerb', 40),
      item(24, 'kerb', 40),
    ]);
    expect(merged.map((m) => m.pages)).toEqual([[20], [21], [21], [22], [22], [23, 24]]);
  });
});

describe('merging as sheets arrive', () => {
  it('joins a new sheet to a row merged earlier and keeps what the row carries', () => {
    const first = mergeAcrossPages([{ ...item(14, 'ถนนลาดยาง', 1800), key: 'a', picked: false }]);
    first[0]!.description = 'ถนนลาดยาง (แก้ชื่อแล้ว)';
    const next = mergeAcrossPages([...first, { ...item(16, 'ก่อสร้างถนนลาดยางหนา 5 ซม.', 1800), key: 'b', picked: true }]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ key: 'a', picked: false, pages: [14, 16], page: 14, description: 'ถนนลาดยาง (แก้ชื่อแล้ว)' });
  });
});

describe('checking AI rows against what the drawing says', () => {
  const written: WrittenQty[] = [
    { description: 'ก่อสร้างปรับปรุงถนนลาดยางแอสฟัลท์ติกคอนกรีต', kind: 'area', unit: 'ตร.ม.', qty: 9000, pages: [14, 15], source: 'พื้นที่ประมาณ 9,000.00 ตารางเมตร' },
    { description: 'ทาลิพืนทางจักรยาน', kind: 'area', unit: 'ตร.ม.', qty: 2700, pages: [38], source: '' },
    { description: 'บ่อพัก คสล.ขนาด', kind: 'count', unit: 'บ่อ', qty: 90, pages: [15, 16], source: '' },
    { description: 'ช่องจอดรถ', kind: 'count', unit: 'ช่อง', qty: 7, pages: [52], source: '' },
  ];
  it('marks agreement, shows the drawing figure where the AI differs, and hands back totals it left out', () => {
    const { checks, missing } = checkAgainstDrawing(
      [
        { description: 'ก่อสร้างปรับปรุงผิวถนนลาดยางแอสฟัลท์ติกคอนกรีต หนา 0.05 ม.', kind: 'area', unit: 'ตร.ม', qty: 9000 },
        { description: 'ทาสีพื้นทางจักรยาน (ช่องกว้าง 1.20 ม.)', kind: 'area', unit: 'ตร.ม.', qty: 2700 },
        { description: 'บ่อพัก คสล. 0.90×1.50 ม.', kind: 'count', unit: 'บ่อ', qty: 4, scope: 'this_sheet' },
        { description: 'พื้นบ่อพัก คสล.', kind: 'count', unit: 'บ่อ', qty: 1, scope: 'per_unit' },
        { description: 'ท่อระบายน้ำ HDPE', kind: 'length', unit: 'ม.', qty: 1800 },
      ],
      written,
    );
    expect(checks.map((c) => c?.status ?? null)).toEqual(['match', 'match', 'part', null, null]);
    expect(checks[2]).toMatchObject({ written: { qty: 90 } });
    expect(missing.map((m) => m.qty)).toEqual([90, 7]);
  });
});
