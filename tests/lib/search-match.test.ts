import { describe, expect, it } from 'vitest';
import { filterBySearch, matchesSearch, similarBySearch, similarity } from '@/lib/search-match';

describe('search matching', () => {
  it('matches Thai names partially and word by word', () => {
    expect(matchesSearch('AA01 ปูนซีเมนต์ ตราช้าง 50 กก.', 'ปูน')).toBe(true);
    expect(matchesSearch('AA01 ปูนซีเมนต์ ตราช้าง 50 กก.', 'ช้าง 50')).toBe(true);
    expect(matchesSearch('AA01 ปูนซีเมนต์ ตราช้าง 50 กก.', 'ช้าง 60')).toBe(false);
  });

  it('ignores case and code separators', () => {
    expect(matchesSearch('PRJ-2026-001 อาคารสำนักงาน', 'prj2026')).toBe(true);
    expect(matchesSearch('AA-01 ทราย', 'aa01')).toBe(true);
    expect(matchesSearch('anything', '   ')).toBe(true);
  });

  it('puts entries starting with the query first', () => {
    const list = ['B01 เหล็กเส้น AA', 'AA02 ทราย', 'C03 AA หิน'];
    expect(filterBySearch(list, 'aa', (s) => s)).toEqual(['AA02 ทราย', 'B01 เหล็กเส้น AA', 'C03 AA หิน']);
  });
});

describe('close matches', () => {
  const list = ['สังกะสีลอนใหญ่ 0.35 มม.', 'กระเบื้องลอนคู่', 'ปูนซีเมนต์', 'สังกะสีแผ่นเรียบ', 'ท่อ PVC 4 หุน'];
  it('offers names that look like what was typed but do not contain it', () => {
    const near = similarBySearch(list, 'สังกะสีลอนเล็ก', (s) => s);
    expect(near[0]).toBe('สังกะสีลอนใหญ่ 0.35 มม.');
    expect(near).toContain('สังกะสีแผ่นเรียบ');
    expect(near).not.toContain('ปูนซีเมนต์');
  });
  it('forgives a wrong tone mark and spacing', () => {
    expect(similarity('ปูนซีเมนต์', 'ปูนซีเมนต')).toBeGreaterThan(0.8);
    expect(similarity('ท่อ PVC 4 หุน', 'ท่อpvc')).toBe(1);
  });
});
