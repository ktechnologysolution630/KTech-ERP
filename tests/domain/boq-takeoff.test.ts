import { describe, expect, test } from 'vitest';
import {
  emptyTakeoffData,
  itemQuantity,
  PAPER_METERS_PER_UNIT,
  polygonArea,
  polylineLength,
  scaleFromCalibration,
  scaleFromRatio,
  takeoffDataSchema,
  toBoqLines,
  type TakeoffData,
  type TakeoffItem,
} from '@/domain/boq-takeoff';

const item = (over: Partial<TakeoffItem>): TakeoffItem => ({
  id: 'i1',
  category: 'งานสถาปัตยกรรม',
  description: 'ผนังก่ออิฐมวลเบา',
  kind: 'length',
  unit: 'ตร.ม.',
  factor: 1,
  wastePercent: 0,
  materialRate: '',
  laborRate: '',
  color: '#e11d48',
  note: '',
  ...over,
});

// 1 unit = 1 cm in the building, so 100 units = 1 m
const CM = { metersPerUnit: 0.01, label: 'test' };

describe('take-off geometry', () => {
  test('lengths and areas in page units', () => {
    expect(polylineLength([[0, 0], [300, 0], [300, 400]])).toBe(700);
    expect(polygonArea([[0, 0], [200, 0], [200, 100], [0, 100]])).toBe(20000);
    expect(polygonArea([[0, 0], [10, 10]])).toBe(0);
  });

  test('a 1:100 drawing printed true to scale: 1 inch on paper is 2.54 m', () => {
    const s = scaleFromRatio(100);
    expect(72 * s.metersPerUnit).toBeCloseTo(2.54, 10);
    expect(s.label).toBe('1:100');
    expect(PAPER_METERS_PER_UNIT * 72).toBeCloseTo(0.0254, 10);
  });

  test('calibrating from a line of known length', () => {
    const s = scaleFromCalibration([10, 10], [10, 210], 5)!;
    expect(s.metersPerUnit).toBeCloseTo(0.025, 10);
    expect(scaleFromCalibration([1, 1], [1, 1], 5)).toBeNull();
    expect(scaleFromCalibration([0, 0], [1, 0], 0)).toBeNull();
  });
});

describe('item quantities', () => {
  test('a quantity read off the drawing counts with measurements, then factor and waste', () => {
    const item = { id: 'ai', category: '', description: 'ประตู', kind: 'count' as const, unit: 'ชุด', factor: 2, wastePercent: 10, materialRate: '' as const, laborRate: '' as const, color: '#e11d48', note: '', fixedQty: 4 };
    const data: TakeoffData = { ...emptyTakeoffData(), items: [item], measurements: [{ id: 'm', itemId: 'ai', page: 1, points: [[0, 0]] }] };
    expect(itemQuantity(item, data)).toMatchObject({ measured: 5, qty: 11, measurementCount: 1 });
    expect(takeoffDataSchema.safeParse(data).success).toBe(true);
  });

  test('wall length × height + waste, only on pages with a scale', () => {
    const data: TakeoffData = {
      ...emptyTakeoffData(),
      scales: { '1': CM },
      items: [item({ factor: 3, wastePercent: 5 })],
      measurements: [
        { id: 'm1', itemId: 'i1', page: 1, points: [[0, 0], [400, 0], [400, 600]] },
        { id: 'm2', itemId: 'i1', page: 2, points: [[0, 0], [100, 0]] },
      ],
    };
    const q = itemQuantity(data.items[0]!, data);
    expect(q.measured).toBeCloseTo(10);
    // 10 m × 3 m high × 1.05
    expect(q.qty).toBe(31.5);
    expect(q.measurementCount).toBe(2);
    expect(q.unscaled).toBe(1);
  });

  test('areas minus openings', () => {
    const data: TakeoffData = {
      ...emptyTakeoffData(),
      scales: { '1': CM },
      items: [item({ kind: 'area', unit: 'ตร.ม.' })],
      measurements: [
        { id: 'a', itemId: 'i1', page: 1, points: [[0, 0], [500, 0], [500, 400], [0, 400]] },
        { id: 'door', itemId: 'i1', page: 1, points: [[0, 0], [100, 0], [100, 200], [0, 200]], deduct: true },
      ],
    };
    expect(itemQuantity(data.items[0]!, data).qty).toBe(18);
  });

  test('counting needs no scale', () => {
    const data: TakeoffData = {
      ...emptyTakeoffData(),
      items: [item({ kind: 'count', unit: 'ชุด', factor: 2 })],
      measurements: [{ id: 'c', itemId: 'i1', page: 4, points: [[1, 1], [2, 2], [3, 3]] }],
    };
    expect(itemQuantity(data.items[0]!, data)).toMatchObject({ qty: 6, unscaled: 0 });
  });
});

describe('BOQ rows from a take-off', () => {
  test('a heading per category, items numbered under it, continuing after existing categories', () => {
    const data: TakeoffData = {
      ...emptyTakeoffData(),
      scales: { '1': CM },
      items: [
        item({ id: 'w', materialRate: 350.555, laborRate: 120, note: 'ชั้น 1' }),
        item({ id: 'l', category: 'งานระบบไฟฟ้าและสื่อสาร', description: 'โคมดาวน์ไลท์', kind: 'count', unit: 'ชุด' }),
        item({ id: 'f', description: 'พื้นกระเบื้อง', kind: 'area', unit: 'ตร.ม.' }),
      ],
      measurements: [
        { id: 'm1', itemId: 'w', page: 1, points: [[0, 0], [250, 0]] },
        { id: 'm2', itemId: 'l', page: 1, points: [[0, 0], [5, 5]] },
      ],
    };
    const rows = toBoqLines(data, { firstCategoryNo: 3, note: 'ถอดแบบ TO-1' });
    expect(rows.map((r) => [r.no, r.description, r.qty, r.unit])).toEqual([
      ['3', 'งานสถาปัตยกรรม', '', ''],
      ['3.1', 'ผนังก่ออิฐมวลเบา', 2.5, 'ตร.ม.'],
      ['3.2', 'พื้นกระเบื้อง', 0, 'ตร.ม.'],
      ['4', 'งานระบบไฟฟ้าและสื่อสาร', '', ''],
      ['4.1', 'โคมดาวน์ไลท์', 2, 'ชุด'],
    ]);
    expect(rows[1]).toMatchObject({ materialRate: 350.56, laborRate: 120, note: 'ชั้น 1 · ถอดแบบ TO-1', isCategory: false });
    expect(rows[0]).toMatchObject({ isCategory: true, isBold: true });
  });
});

describe('saved data check', () => {
  test('accepts a take-off and refuses a bad colour or empty name', () => {
    const ok: TakeoffData = { ...emptyTakeoffData(), items: [item({})], measurements: [{ id: 'm', itemId: 'i1', page: 1, points: [[1, 2]] }] };
    expect(takeoffDataSchema.safeParse(ok).success).toBe(true);
    expect(takeoffDataSchema.safeParse({ ...ok, items: [item({ color: 'red' })] }).success).toBe(false);
    expect(takeoffDataSchema.safeParse({ ...ok, items: [item({ description: '  ' })] }).success).toBe(false);
  });
});
