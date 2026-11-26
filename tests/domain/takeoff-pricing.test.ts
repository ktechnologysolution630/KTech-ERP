import { describe, expect, it } from 'vitest';
import { nameScore, sizesOf, suggestFromHistory, type PriceRef } from '@/domain/takeoff-pricing';

const ref = (p: Partial<PriceRef> & Pick<PriceRef, 'description' | 'unit'>): PriceRef => ({ source: 'boq', materialRate: null, laborRate: null, ref: 'BOQ-1', date: '2026-01-01', ...p });

describe('take-off pricing from history', () => {
  it('reads sizes in any unit as the same size', () => {
    expect(sizesOf('พื้น คสล. หนา 10 ซม.')).toEqual(sizesOf('พื้น คสล. หนา 0.10 ม.'));
  });

  it('never prices one size as another', () => {
    expect(nameScore('พื้น คสล. หนา 10 ซม.', 'พื้น คสล. หนา 15 ซม.')).toBeLessThan(0.62);
    expect(nameScore('พื้น คสล. หนา 10 ซม.', 'งานพื้นคอนกรีตเสริมเหล็ก คสล. หนา 0.10 ม.')).toBeGreaterThan(0.62);
  });

  it('takes both rates from an earlier BOQ line in the same unit', () => {
    const s = suggestFromHistory({ description: 'ผนังก่ออิฐมวลเบา หนา 7.5 ซม.', unit: 'ตร.ม.' }, [
      ref({ description: 'ผนังก่ออิฐมวลเบา หนา 7.5 ซม.', unit: 'ม.', materialRate: 1, laborRate: 1 }),
      ref({ description: 'ก่อผนังอิฐมวลเบา หนา 7.5 ซม.', unit: 'ตารางเมตร', materialRate: 260, laborRate: 90, ref: 'BOQ-2' }),
    ]);
    expect([s.materialRate, s.laborRate]).toEqual([260, 90]);
    expect(s.materialFrom?.label).toContain('BOQ-2');
  });

  it('takes material from the last PO when no BOQ has it, and leaves labour for the AI', () => {
    const s = suggestFromHistory({ description: 'ท่อ PVC 4" ชั้น 8.5', unit: 'ท่อน' }, [ref({ source: 'po', description: 'ท่อ PVC 4 นิ้ว ชั้น 8.5', unit: 'เส้น', materialRate: 455, ref: 'PO-1' })]);
    expect(s.materialRate).toBe(455);
    expect(s.materialFrom?.source).toBe('po');
    expect(s.laborRate).toBeNull();
  });

  it('prefers the newer price when two lines match equally', () => {
    const s = suggestFromHistory({ description: 'ทาสีน้ำอะครีลิค', unit: 'ตร.ม.' }, [
      ref({ description: 'ทาสีน้ำอะครีลิค', unit: 'ตร.ม.', materialRate: 50, laborRate: 30, date: '2025-01-01' }),
      ref({ description: 'ทาสีน้ำอะครีลิค', unit: 'ตร.ม.', materialRate: 60, laborRate: 35, date: '2026-05-01' }),
    ]);
    expect(s.materialRate).toBe(60);
  });
});

describe('the same work in two units', () => {
  it('keeps the area of a road and points its length at it', async () => {
    const { findSameWork } = await import('@/domain/takeoff-pricing');
    const items = [
      { key: 'len', description: 'ก่อสร้างปรับปรุงถนนลาดยางแอสฟัลท์ติกคอนกรีต', unit: 'ม.' },
      { key: 'area', description: 'ก่อสร้างปรับปรุงถนนลาดยางแอสฟัลท์ติกคอนกรีต', unit: 'ตร.ม.' },
      { key: 'pit', description: 'บ่อพัก คสล.', unit: 'บ่อ' },
      { key: 'kerb', description: 'คันหิน คสล.', unit: 'ม.' },
    ];
    expect([...findSameWork(items, () => false)]).toEqual([['len', 'area']]);
    // The one with a price on record wins
    expect([...findSameWork(items, (k) => k === 'len')]).toEqual([['area', 'len']]);
  });
});
