import { describe, expect, test } from 'vitest';
import { dateFieldProblem, formatDateText, maskDateText, parseDateText } from '@/domain/thai';

describe('date text', () => {
  test('shows an ISO date as day/month/year', () => {
    expect(formatDateText('2026-11-04')).toBe('04/11/2026');
    expect(formatDateText('')).toBe('');
    expect(formatDateText(null)).toBe('');
  });

  test('reads day first, in either calendar, refusing impossible dates and years', () => {
    expect(parseDateText('2026-11-04')).toBe('2026-11-04');
    expect(parseDateText('4/11/2026')).toBe('2026-11-04');
    expect(parseDateText('04/11/2569')).toBe('2026-11-04');
    expect(parseDateText('29/02/2024')).toBe('2024-02-29');
    expect(parseDateText('29/02/2026')).toBeNull();
    expect(parseDateText('31/2/2026')).toBeNull();
    expect(parseDateText('11/13/2026')).toBeNull();
    expect(parseDateText('01/01/0026')).toBeNull();
    expect(parseDateText('พฤศจิกายน')).toBeNull();
  });

  test('shapes typing without getting in the way of deleting', () => {
    expect(maskDateText('0')).toBe('0');
    expect(maskDateText('04')).toBe('04');
    expect(maskDateText('041')).toBe('04/1');
    expect(maskDateText('04112026')).toBe('04/11/2026');
    expect(maskDateText('04/11/20269')).toBe('04/11/2026');
    expect(maskDateText('4/')).toBe('04');
    expect(maskDateText('4/11/2026')).toBe('04/11/2026');
    expect(maskDateText('04/1')).toBe('04/1');
    expect(maskDateText('ab04.11')).toBe('04/11');
    expect(maskDateText('')).toBe('');
  });

  test('takes a pasted ISO date as it is', () => {
    expect(maskDateText('2026-11-04')).toBe('04/11/2026');
  });

  test('explains what is wrong with the field, with limits written day first', () => {
    const ok = { text: '04/11/2026', iso: '2026-11-04' };
    expect(dateFieldProblem(ok)).toBeNull();
    expect(dateFieldProblem({ text: '', iso: '' })).toBeNull();
    expect(dateFieldProblem({ text: '', iso: '', required: true })).toBe('กรุณาระบุวันที่');
    expect(dateFieldProblem({ text: '31/02/2026', iso: '' })).toContain('วว/ดด/ปปปป');
    expect(dateFieldProblem({ ...ok, min: '2026-12-01' })).toBe('วันที่ต้องไม่ก่อน 01/12/2026');
    expect(dateFieldProblem({ ...ok, max: '2026-03-29' })).toBe('วันที่ต้องไม่เกิน 29/03/2026');
    expect(dateFieldProblem({ ...ok, min: '2026-11-04', max: '2026-11-04' })).toBeNull();
  });
});
