import { describe, expect, it } from 'vitest';
import { convertRow, estimateSteelWeight } from '@/domain/unit-convert';
import { itemNameKey } from '@/domain/unit-match';

describe('unit conversion', () => {
  it('estimates standard steel weights', () => {
    // 100×50×2.3 box ≈ 5.25 kg/m
    expect(estimateSteelWeight('- เหล็กกล่อง 100x50x2.3 มม.')?.kgPerUnit).toBeCloseTo(31.5, 0);
    // H 150×150×7×10: table 31.5 kg/m
    expect(estimateSteelWeight('- เหล็ก H 150x150x7x10 มม.')?.kgPerUnit).toBeCloseTo(189, -1);
    expect(estimateSteelWeight('- PLATE 9 มม. Thk.')).toMatchObject({ unit: 'แผ่น' });
    expect(estimateSteelWeight('- SD 40 Dia 12 มม.')?.kgPerUnit).toBeCloseTo(8.89, 1);
    expect(estimateSteelWeight('ทาสีกันสนิม')).toBeNull();
  });

  it('keeps the money of a converted row', () => {
    const row = { qty: 1600, unit: 'กก.', matRate: 25.52, labRate: 14 };
    const out = convertRow(row, 'เส้น', 32);
    expect(out).toEqual({ qty: 50, unit: 'เส้น', matRate: 816.64, labRate: 448 });
    expect(out.qty * out.matRate).toBeCloseTo(1600 * 25.52, 2);
  });

  it('ignores list markers when matching item names', () => {
    expect(itemNameKey('- เหล็กกล่อง 100x50x2.3 มม.')).toBe(itemNameKey('เหล็กกล่อง 100x50x2.3 มม.'));
  });
});
