import { describe, expect, it } from 'vitest';
import { bridgeStatusSchema, bridgeTakeoffSchema, kindOfUnit, readBridgeRows } from '@/domain/archicad-bridge';

describe('kindOfUnit', () => {
  it('measures by the BOQ unit', () => {
    expect(kindOfUnit('ม.')).toBe('length');
    expect(kindOfUnit('ตร.ม.')).toBe('area');
    expect(kindOfUnit('ลบ.ม.')).toBe('area');
    expect(kindOfUnit('ชุด')).toBe('count');
    expect(kindOfUnit('บาน')).toBe('count');
  });
});

describe('readBridgeRows', () => {
  it('keeps good rows and drops broken or empty ones', () => {
    const { rows, dropped } = readBridgeRows([
      { category: 'งานผนัง', description: 'ผนัง อิฐมวลเบา', qty: 120.4567, unit: 'ตร.ม.', elementType: 'Wall', count: 12, note: 'Archicad: Wall 12 ชิ้น' },
      { category: 'งานประตู-หน้าต่าง', description: 'ประตู D1', qty: 4, unit: 'ชุด' },
      { description: 'ว่าง', qty: 0, unit: 'ม.' },
      { description: '', qty: 3, unit: 'ม.' },
      { description: 'qty เป็นข้อความ', qty: '3', unit: 'ม.' },
      null,
    ]);
    expect(dropped).toBe(4);
    expect(rows).toEqual([
      { category: 'งานผนัง', description: 'ผนัง อิฐมวลเบา', kind: 'area', unit: 'ตร.ม.', qty: 120.457, note: 'Archicad: Wall 12 ชิ้น' },
      { category: 'งานประตู-หน้าต่าง', description: 'ประตู D1', kind: 'count', unit: 'ชุด', qty: 4, note: 'ปริมาณจากโมเดล Archicad' },
    ]);
  });
});

describe('bridge responses', () => {
  it('reads a status with Archicad closed', () => {
    expect(bridgeStatusSchema.parse({ ok: true, bridge: '1.0', archicad: null }).archicad).toBeNull();
  });
  it('reads a take-off reply', () => {
    const r = bridgeTakeoffSchema.parse({ ok: true, rows: [{ description: 'x', qty: 1 }], warnings: ['w'], archicad: { port: 19723, version: 'Archicad 30', project: '' } });
    expect(r.rows).toHaveLength(1);
    expect(r.warnings).toEqual(['w']);
  });
  it('reads an error reply', () => {
    expect(bridgeTakeoffSchema.parse({ ok: false, error: 'ไม่พบ Archicad' }).error).toBe('ไม่พบ Archicad');
  });
});
