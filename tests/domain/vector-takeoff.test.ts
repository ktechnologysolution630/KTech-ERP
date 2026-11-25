import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { emptyTakeoffData, itemQuantity, scaleFromRatio, takeoffDataSchema, type Point, type TakeoffItem } from '@/domain/boq-takeoff';
import {
  chainSegments,
  colorName,
  groupQuantity,
  groupToMeasurements,
  groupVectors,
  isTag,
  measurementCountOf,
  scaleFromText,
  suggestNames,
  withoutLegend,
} from '@/domain/vector-takeoff';
import { extractPageVectors } from '@/lib/pdf-vectors';

describe('vector take-off helpers', () => {
  test('segments that meet become one polyline; a segment drawn twice counts once', () => {
    const segs: [Point, Point][] = [
      [[0, 0], [10, 0]],
      [[10, 0], [10, 10]],
      [[10, 10], [10, 0]],
      [[20, 20], [30, 20]],
    ];
    const lines = chainSegments(segs);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.length).sort()).toEqual([2, 3]);
  });

  test('tags, scale text and colour names', () => {
    expect(['D1', 'W2', 'SW-1', 'C1A', 'FL01'].every(isTag)).toBe(true);
    expect(['10.00', 'FLOOR PLAN 1', 'ห้องนอน', '1:100'].some(isTag)).toBe(false);
    expect(scaleFromText([{ str: 'SCALE 1:100', at: [0, 0] }, { str: 'DETAIL 1:20', at: [0, 0] }, { str: 'มาตราส่วน 1 : 100', at: [0, 0] }])).toBe(100);
    expect(scaleFromText([{ str: 'ไม่มีสเกล', at: [0, 0] }])).toBeNull();
    expect(colorName('#e3261f')).toBe('แดง');
    expect(colorName('#000000')).toBe('ดำ');
  });
});

describe('reading a CAD PDF', () => {
  test('sample A3 plan at 1:100: walls, lights, doors and the scale are found', async () => {
    const file = path.join(__dirname, '../fixtures/sample-plan-A3-1-100.pdf');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push(await extractPageVectors(await doc.getPage(p), p, pdfjs.OPS as unknown as Record<string, number>));
    expect(scaleFromText(pages[0]!.texts)).toBe(100);

    const groups = groupVectors(pages);
    const scales = { '1': scaleFromRatio(100), '2': scaleFromRatio(100) };
    const walls = groups.find((g) => g.type === 'line' && g.label.includes('0.53'))!;
    // 10 × 6 m outline + one 6 m partition, on each of the 2 pages
    expect(groupQuantity(walls, scales).qty).toBeCloseTo(76, 1);
    expect(groupQuantity(walls, { '1': scaleFromRatio(100) }).unscaledPages).toEqual([2]);
    const lights = groups.find((g) => g.type === 'symbol' && g.count === 12)!;
    expect(lights.pages.get(1)).toHaveLength(6);

    // Turned into take-off measurements, the item gives the same quantity and the data still saves
    const item: TakeoffItem = { id: 'w', category: '', description: 'ผนัง', kind: 'length', unit: 'ตร.ม.', factor: 3, wastePercent: 0, materialRate: '', laborRate: '', color: '#e11d48', note: '' };
    const lightItem: TakeoffItem = { ...item, id: 'l', kind: 'count', unit: 'จุด', factor: 1 };
    let n = 0;
    const id = () => `m${n++}`;
    const data = {
      ...emptyTakeoffData(),
      scales,
      items: [item, lightItem],
      measurements: [...groupToMeasurements(walls, 'w', id), ...groupToMeasurements(lights, 'l', id)],
    };
    expect(data.measurements).toHaveLength(measurementCountOf(walls) + measurementCountOf(lights));
    expect(itemQuantity(item, data).qty).toBeCloseTo(228, 1);
    expect(itemQuantity(lightItem, data).qty).toBe(12);
    expect(takeoffDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('name suggestions', () => {
  test('tags by prefix, symbols from their legend text, thickest long lines as walls', async () => {
    const file = path.join(__dirname, '../fixtures/plan-tags-legend-1-100.pdf');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
    const pages = [await extractPageVectors(await doc.getPage(1), 1, pdfjs.OPS as unknown as Record<string, number>)];
    expect(scaleFromText(pages[0]!.texts)).toBe(100);
    const groups = groupVectors(pages);
    const names = suggestNames(groups, pages);
    const byLabel = (label: string) => groups.find((g) => g.label === label)!;
    expect(names.get(byLabel('ป้าย “D1”').key)).toMatchObject({ description: 'ประตู D1', unit: 'ชุด' });
    expect(names.get(byLabel('ป้าย “W1”').key)).toMatchObject({ description: 'หน้าต่าง W1' });
    expect(names.get(byLabel('ป้าย “C1”').key)).toMatchObject({ description: 'เสา C1', unit: 'ต้น' });
    expect(byLabel('ป้าย “D1”').count).toBe(3);

    // 6 lights in the room + 1 in the legend; the legend text names them
    const lights = groups.find((g) => g.type === 'symbol' && g.count === 7)!;
    expect(names.get(lights.key)?.description).toBe('โคมดาวน์ไลท์ LED 12W');
    expect(withoutLegend(lights, names.get(lights.key)).count).toBe(6);

    const walls = groups.find((g) => names.get(g.key)?.description === 'ผนัง')!;
    expect(walls.label).toContain('แดง');
    // 12 × 8 m outline + 8 m partition
    expect(groupQuantity(walls, { '1': scaleFromRatio(100) }).qty).toBeCloseTo(48, 1);
  });
});
