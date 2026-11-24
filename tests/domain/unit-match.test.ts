import { describe, expect, it } from 'vitest';
import { alignBoqUnits, boqUnitStatus, registerUnitFor, sameUnit, type UnitReference } from '@/domain/unit-match';

const ref: UnitReference = {
  units: ['กก.', 'คิว', 'ชิ้น', 'ตร.ม.', 'ตัน', 'ม.', 'เส้น'],
  itemUnits: { 'กระเบื้อง 60x60': 'ตร.ม.', 'เหล็ก db12': 'เส้น' },
};

describe('unit matching', () => {
  it('matches spellings of the same unit only', () => {
    expect(sameUnit('ตารางเมตร', 'ตร.ม.')).toBe(true);
    expect(sameUnit('m2', 'ตร.ม.')).toBe(true);
    expect(sameUnit('ตัน', 'กก.')).toBe(false);
  });

  it('finds the register spelling', () => {
    expect(registerUnitFor('ลบ.ม.', ref.units)).toBe('คิว');
    expect(registerUnitFor('เมตร', ref.units)).toBe('ม.');
    expect(registerUnitFor(' ตร.ม. ', ref.units)).toBe('ตร.ม.');
    expect(registerUnitFor('ถาด', ref.units)).toBeNull();
  });

  it('reports a row naming a register item counted in another unit', () => {
    expect(boqUnitStatus({ description: 'เหล็ก DB12', unit: 'กก.' }, ref)).toEqual({ kind: 'item-differs', itemUnit: 'เส้น' });
    expect(boqUnitStatus({ description: 'กระเบื้อง 60x60', unit: 'ตารางเมตร' }, ref)).toEqual({ kind: 'respell', to: 'ตร.ม.' });
    expect(boqUnitStatus({ description: 'หมวด 1', unit: '', isCategory: true }, ref)).toEqual({ kind: 'ok' });
  });

  it('respells units without touching quantities', () => {
    const rows = [
      { description: 'คอนกรีต', unit: 'ลบ.ม.', qty: 10 },
      { description: 'เหล็ก DB12', unit: 'กก.', qty: 500 },
      { description: 'ของแปลก', unit: 'ถาด', qty: 2 },
      { description: 'สายไฟ', unit: 'ม.', qty: 30 },
    ];
    const r = alignBoqUnits(rows, ref);
    expect(r.rows.map((x) => x.unit)).toEqual(['คิว', 'กก.', 'ถาด', 'ม.']);
    expect(r.rows.map((x) => x.qty)).toEqual([10, 500, 2, 30]);
    expect([r.changed, r.itemDiffers, r.unknown]).toEqual([1, 1, 1]);
  });
});
