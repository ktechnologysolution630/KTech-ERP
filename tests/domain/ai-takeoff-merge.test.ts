import { describe, expect, it } from 'vitest';
import { mergeAcrossPages, type PagedAiItem } from '@/domain/ai-takeoff-merge';

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
