import { describe, expect, it } from 'vitest';
import { itemQuantity, takeoffDataSchema, toBoqLines, type Measurement, type TakeoffData, type TakeoffItem } from '@/domain/boq-takeoff';
import { buildElementItems, cleanParams, elementTemplate } from '@/domain/takeoff-elements';

// 1 unit = 1 cm in the building
const CM = { metersPerUnit: 0.01, label: 'test' };

function build(key: Parameters<typeof elementTemplate>[0], params: Record<string, number>, measurements: Omit<Measurement, 'itemId' | 'id' | 'page'>[]) {
  let n = 0;
  const items = buildElementItems(elementTemplate(key), params, { name: 'ทดสอบ', category: 'หมวด', newId: () => `id${n++}`, colorOf: () => '#e11d48' });
  const data: TakeoffData = {
    version: 1,
    scales: { '1': CM },
    items,
    measurements: measurements.map((m, i) => ({ ...m, id: `m${i}`, itemId: items[0]!.id, page: 1 })),
  };
  const qty = (i: number) => itemQuantity(items[i]!, data).qty;
  return { items, data, qty };
}

const SQUARE_4M: Omit<Measurement, 'itemId' | 'id' | 'page'> = { points: [[0, 0], [400, 0], [400, 400], [0, 400]] };

describe('element take-off', () => {
  it('gives a 10 m wall its area, both plaster faces and volume, less the openings', () => {
    const { items, qty } = build('wall', { height: 3, thickness: 0.1, openings: 4, sides: 2 }, [{ points: [[0, 0], [1000, 0]] }]);
    expect(items.map((i) => i.description)).toEqual(['ทดสอบ', 'ฉาบปูน ทดสอบ', 'ทาสี ทดสอบ', 'ปริมาตร ทดสอบ']);
    expect(qty(0)).toBe(26); // 10 × 3 − 4
    expect(qty(1)).toBe(52); // (30 − 4) × 2
    expect(qty(2)).toBe(52);
    expect(qty(3)).toBe(2.6); // 26 × 0.1
    expect(items.slice(1).every((i) => i.sourceItemId === items[0]!.id)).toBe(true);
  });

  it('gives a 4 × 4 m slab its concrete, soffit and edge formwork', () => {
    const { qty } = build('slab', { thickness: 0.15 }, [SQUARE_4M]);
    expect(qty(0)).toBe(2.4); // 16 × 0.15
    expect(qty(1)).toBe(16);
    expect(qty(2)).toBe(2.4); // perimeter 16 × 0.15
  });

  it('leaves an opening cut out of a slab off its edge but not off its area', () => {
    const { qty } = build('slab', { thickness: 0.1 }, [SQUARE_4M, { points: [[0, 0], [100, 0], [100, 100], [0, 100]], deduct: true }]);
    expect(qty(0)).toBe(1.5); // (16 − 1) × 0.1
    expect(qty(2)).toBe(1.6); // outer perimeter only
  });

  it('gives counted columns their concrete and formwork', () => {
    const { qty } = build('column', { width: 0.2, depth: 0.3, height: 3 }, [{ points: [[0, 0], [10, 10], [20, 20]] }]);
    expect(qty(0)).toBe(0.54); // 3 × 0.2 × 0.3 × 3
    expect(qty(1)).toBe(9); // 3 × 2 × 0.5 × 3
    expect(qty(2)).toBe(3);
  });

  it('gives a beam its concrete and three formwork faces', () => {
    const { qty } = build('beam', { width: 0.2, depth: 0.5 }, [{ points: [[0, 0], [600, 0]] }]);
    expect(qty(0)).toBe(0.6);
    expect(qty(1)).toBe(7.2); // 6 × (0.2 + 1.0)
  });

  it('gives a room its floor, ceiling, skirting and wall faces', () => {
    const { qty } = build('room', { height: 2.5, openings: 3 }, [SQUARE_4M]);
    expect([qty(0), qty(1), qty(2), qty(3)]).toEqual([16, 16, 16, 37]); // 16 × 2.5 − 3
  });

  it('turns a roof plan area into its sloped area', () => {
    const { qty } = build('roof', { slope: 60 }, [SQUARE_4M]);
    expect(qty(0)).toBe(32);
    expect(qty(1)).toBe(16);
  });

  it('counts a quantity typed on the main line in the lines that follow it', () => {
    const { items, data } = build('wall', { height: 3, thickness: 0, openings: 0, sides: 1 }, []);
    items[0]!.fixedQty = 5;
    expect(itemQuantity(items[1]!, data).qty).toBe(15);
  });

  it('puts every line in the BOQ and passes the saved-data check', () => {
    const { data } = build('slab', { thickness: 0.1 }, [SQUARE_4M]);
    expect(takeoffDataSchema.safeParse(data).success).toBe(true);
    expect(toBoqLines(data).filter((l) => !l.isCategory).map((l) => l.qty)).toEqual([1.6, 16, 1.6]);
  });

  it('puts out-of-range dimensions back within limits', () => {
    expect(cleanParams(elementTemplate('wall'), { height: -1, thickness: Number.NaN, sides: 5 })).toEqual({ height: 0.01, thickness: 0.075, openings: 0, sides: 2 });
  });

  it('ignores a source that is itself derived', () => {
    const base: TakeoffItem = { id: 'a', category: '', description: 'x', kind: 'length', unit: 'ม.', factor: 1, wastePercent: 0, materialRate: '', laborRate: '', color: '#e11d48', note: '', sourceItemId: 'b' };
    const data: TakeoffData = { version: 1, scales: {}, items: [base, { ...base, id: 'b', sourceItemId: 'a', fixedQty: 3 }], measurements: [] };
    expect(itemQuantity(data.items[1]!, data).qty).toBe(3);
  });
});
