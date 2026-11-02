import { describe, expect, test } from 'vitest';
import { formatThaiDate, docPeriod, toBangkok } from '@/domain/thai';

describe('thai helpers', () => {
  test('thai date + period', () => {
    const d = new Date('2026-11-01T18:30:00Z'); // 2026-11-02 01:30 Bangkok
    expect(formatThaiDate(d)).toBe('2 พ.ย. 2569');
    expect(docPeriod(d)).toBe('6911');
    expect(toBangkok(d).getUTCDate()).toBe(2);
  });
});
