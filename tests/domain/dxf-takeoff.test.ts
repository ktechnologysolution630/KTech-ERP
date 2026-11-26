import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeDxf, dxfGroups, guessDxfUnit, isNoteLayer, readDxf, suggestDxfName } from '@/domain/dxf-takeoff';
import { extractTextItems } from '@/domain/text-takeoff';

const load = (name: string) => {
  const buf = readFileSync(`tests/fixtures/dxf/${name}`);
  return readDxf(decodeDxf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
};
const byName = (groups: ReturnType<typeof dxfGroups>, type: string, name: string) => groups.find((g) => g.type === type && g.name === name);

describe('DXF take-off', () => {
  const read = load('sample-plan-mm.dxf');
  const groups = dxfGroups(read, guessDxfUnit(read));

  it('reads the drawing unit from the header', () => {
    expect(read.declaredUnit).toBe('mm');
  });

  it('adds up lines and arcs per layer in metres', () => {
    // 10 + 8 + 10 + 8 m of walls and a quarter circle of radius 2 m
    expect(byName(groups, 'layer-length', 'A-WALL')!.qty).toBeCloseTo(36 + Math.PI, 3);
  });

  it('measures closed polylines with arcs as areas', () => {
    // 10 × 8 m slab, and a 4 × 2 m slab ending in a half circle of radius 1 m
    const slab = byName(groups, 'layer-area', 'S-SLAB')!;
    expect(slab.qty).toBeCloseTo(80 + 8 + Math.PI / 2, 2);
    expect(slab.perimeter).toBeCloseTo(36 + 4 + 4 + 2 + Math.PI, 2);
  });

  it('takes islands out of a hatch and reads arc edges', () => {
    // 5 × 4 m less a 1 × 1 m hole, and a circle of radius 1 m
    expect(byName(groups, 'layer-area', 'A-FLOOR')!.qty).toBeCloseTo(19 + Math.PI, 1);
  });

  it('counts blocks, arrays as rows × columns', () => {
    expect(byName(groups, 'block', 'DOOR-90')!.qty).toBe(5);
    expect(byName(groups, 'block', 'LIGHT')!.qty).toBe(6 + 6);
  });

  it('keeps the text so the written quantities can be read', () => {
    const items = extractTextItems(read.texts.map((text) => ({ page: 1, text })));
    expect(items.map((i) => [i.unit, i.qty])).toEqual(expect.arrayContaining([['ม.', 120], ['บ่อ', 12], ['ตร.ม.', 450]]));
  });

  it('suggests Thai names and spots annotation layers', () => {
    expect(suggestDxfName({ name: 'DOOR-90', layer: 'A-DOOR', type: 'block' })).toBe('ประตู (DOOR-90)');
    expect(suggestDxfName({ name: 'A-WALL', layer: 'A-WALL', type: 'layer-length' })).toBe('ผนังก่ออิฐ (A-WALL)');
    expect(isNoteLayer('DIM')).toBe(true);
    expect(isNoteLayer('A-WALL')).toBe(false);
  });

  it('reads old R12 polylines and guesses metres when the file does not say', () => {
    const r12 = load('r12-metres.dxf');
    expect(r12.declaredUnit).toBeNull();
    const unit = guessDxfUnit(r12);
    expect(unit).toBe('m');
    const g = dxfGroups(r12, unit);
    expect(byName(g, 'layer-area', 'ROOM')!.qty).toBeCloseTo(24, 6);
    expect(byName(g, 'layer-length', 'PIPE')!.qty).toBeCloseTo(8, 6);
  });

  it('turns Thai escapes back into letters and refuses binary DXF', () => {
    const enc = new TextEncoder();
    expect(decodeDxf(enc.encode('0\nSECTION\n1\n\\U+0E16\\U+0E19\\U+0E19\n').buffer)).toContain('ถนน');
    expect(() => decodeDxf(enc.encode('AutoCAD Binary DXF\r\n\x1a\x00').buffer)).toThrow('BINARY_DXF');
  });
});
