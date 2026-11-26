import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { decodeStepString, parseStep, readIfc } from '@/domain/ifc-takeoff';

// A small house as Archicad writes it: millimetres, Thai names in \X2\, base quantities and materials
const IFC = readFileSync(path.join(__dirname, '../fixtures/small-house.ifc'), 'utf8');

describe('decodeStepString', () => {
  it('reads Thai written as UTF-16 hex', () => {
    expect(decodeStepString('\\X2\\0E1B0E230E300E150E39\\X0\\ D1')).toBe('ประตู D1');
  });
});

describe('parseStep', () => {
  it('reads entities, quotes and references', () => {
    const ents = parseStep(IFC);
    expect(ents.get(12)!.args[2]).toBe("W-03; it's");
    expect(ents.get(43)!.args[4]).toEqual([{ ref: 40 }, { ref: 41 }]);
  });
});

describe('readIfc', () => {
  it('adds up quantities into BOQ lines', () => {
    const r = readIfc(IFC);
    const line = (d: string) => r.rows.find((x) => x.description === d);
    expect(line('ผนัง อิฐมวลเบา')).toMatchObject({ qty: 50.75, unit: 'ตร.ม.', kind: 'area', category: 'งานผนัง' });
    // Length in millimetres becomes metres
    expect(line('ความยาวผนัง อิฐมวลเบา')).toMatchObject({ qty: 17, unit: 'ม.', kind: 'length' });
    expect(line('คอนกรีตพื้น')).toMatchObject({ qty: 14.4, unit: 'ลบ.ม.' });
    expect(line('ผิวพื้น Concrete')).toMatchObject({ qty: 96 });
    // The roof slab is a roof, not a floor; the IfcRoof made of it is not counted twice
    expect(line('หลังคา Concrete')).toMatchObject({ qty: 110 });
    expect(r.rows.filter((x) => x.description.startsWith('หลังคา'))).toHaveLength(1);
    expect(line('คอนกรีตเสา')).toMatchObject({ qty: 0.72 });
    expect(line('ประตู D1')).toMatchObject({ qty: 2, unit: 'ชุด', kind: 'count' });
    expect(line('พื้นที่ ห้องนอน')).toMatchObject({ qty: 4.5 });
  });

  it('warns about elements without quantities', () => {
    const r = readIfc(IFC);
    expect(r.warnings.some((w) => w.includes('1 ชิ้น'))).toBe(true);
    expect(r.found).toContainEqual({ label: 'ผนัง', count: 3 });
  });

  it('rejects a file that is not IFC', () => {
    expect(() => readIfc('hello')).toThrow();
  });
});
