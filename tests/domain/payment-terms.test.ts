import { describe, expect, test } from 'vitest';
import { computeDueDate, describeSchedule, nextOnSchedule, nextWorkingDay, normaliseSchedule, parseSchedule } from '@/domain/payment-terms';

describe('payment terms', () => {
  test('schedules parse and normalise', () => {
    expect(parseSchedule('')).toEqual({ kind: 'ANY' });
    expect(parseSchedule('M:20,5,5')).toEqual({ kind: 'MONTH_DAYS', days: [5, 20] });
    expect(parseSchedule('W:5,1')).toEqual({ kind: 'WEEKDAYS', days: [1, 5] });
    expect(normaliseSchedule(' M:25 ')).toBe('M:25');
    expect(normaliseSchedule('')).toBe('');
    expect(() => normaliseSchedule('M:40')).toThrow();
    expect(describeSchedule('M:5,20')).toBe('ทุกวันที่ 5, 20 ของเดือน');
    expect(describeSchedule('W:5')).toBe('ทุกวันศุกร์');
  });

  test('next day on a schedule', () => {
    expect(nextOnSchedule('2026-11-10', '')).toBe('2026-11-10');
    expect(nextOnSchedule('2026-11-10', 'M:25')).toBe('2026-11-25');
    expect(nextOnSchedule('2026-11-25', 'M:25')).toBe('2026-11-25');
    expect(nextOnSchedule('2026-11-26', 'M:25')).toBe('2026-12-25');
    expect(nextOnSchedule('2026-12-26', 'M:5,20')).toBe('2027-01-05');
    // 31 means the month's last day
    expect(nextOnSchedule('2027-02-10', 'M:31')).toBe('2027-02-28');
    // 2026-11-10 is a Tuesday; next Friday is the 13th
    expect(nextOnSchedule('2026-11-10', 'W:5')).toBe('2026-11-13');
  });

  test('weekends move to Monday', () => {
    expect(nextWorkingDay('2026-11-14')).toBe('2026-11-16');
    expect(nextWorkingDay('2026-11-15')).toBe('2026-11-16');
    expect(nextWorkingDay('2026-11-16')).toBe('2026-11-16');
  });

  test('worked example: bill 10 Nov, billing on the 25th, 30 days from billing, cheques on the 5th and 20th', () => {
    expect(
      computeDueDate({
        invoiceDate: '2026-11-10',
        receivedDate: '2026-11-08',
        terms: { billingSchedule: 'M:25', creditBasis: 'BILLING', creditDays: 30, chequeSchedule: 'M:5,20' },
      }),
    ).toEqual({ billingDate: '2026-11-25', dueDate: '2027-01-05' });
  });

  test('billing waits for the goods; credit can count from the invoice or the delivery', () => {
    const terms = { billingSchedule: '', creditDays: 30, chequeSchedule: '' };
    expect(computeDueDate({ invoiceDate: '2026-11-02', receivedDate: '2026-11-04', terms: { ...terms, creditBasis: 'BILLING' } })).toEqual({ billingDate: '2026-11-04', dueDate: '2026-12-04' });
    expect(computeDueDate({ invoiceDate: '2026-11-02', receivedDate: '2026-11-04', terms: { ...terms, creditBasis: 'INVOICE' } }).dueDate).toBe('2026-12-02');
    expect(computeDueDate({ invoiceDate: '2026-11-02', receivedDate: '2026-11-04', terms: { ...terms, creditBasis: 'RECEIPT' } }).dueDate).toBe('2026-12-04');
    // 2026-11-02 + 33 = 2026-12-05, a Saturday
    expect(computeDueDate({ invoiceDate: '2026-11-02', receivedDate: null, terms: { ...terms, creditDays: 33, creditBasis: 'INVOICE' } }).dueDate).toBe('2026-12-07');
  });
});
