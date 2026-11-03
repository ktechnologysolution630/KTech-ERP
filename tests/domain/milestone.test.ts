import { describe, expect, test } from 'vitest';
import {
  computeMilestoneAmounts,
  milestonesFromBoq,
  summarizeMilestones,
  type BoqSheetForMilestones,
} from '@/domain/milestone';
import { sum } from '@/domain/money';

const boq: BoqSheetForMilestones = {
  overheadPercent: 10,
  discountAmount: 0,
  vatPercent: 7,
  lines: [
    { isCategory: false, description: 'ป้ายโครงการ', qty: 1, materialRate: 1000, laborRate: 0 },
    { isCategory: true, description: 'งานฐานราก', qty: '', materialRate: '', laborRate: '' },
    { isCategory: false, description: 'เสาเข็ม', qty: 10, materialRate: 2000, laborRate: 1000 },
    { isCategory: true, description: 'งานว่าง', qty: '', materialRate: '', laborRate: '' },
    { isCategory: true, description: 'งานโครงสร้าง', qty: '', materialRate: '', laborRate: '' },
    { isCategory: false, description: 'คอนกรีต', qty: 3, materialRate: 3000, laborRate: 333.33 },
  ],
};

describe('milestone maths', () => {
  test('retention rounds to satang and net is the remainder', () => {
    const r = computeMilestoneAmounts(123_456.78, 5);
    expect(r.retention.toFixed(2)).toBe('6172.84');
    expect(r.net.toFixed(2)).toBe('117283.94');
  });

  test('PAY drafts use each category direct cost and skip empty categories', () => {
    const drafts = milestonesFromBoq(boq, 'PAY');
    expect(drafts.map((d) => [d.title, d.amount.toFixed(2)])).toEqual([
      ['งานทั่วไป', '1000.00'],
      ['งานฐานราก', '30000.00'],
      ['งานโครงสร้าง', '9999.99'],
    ]);
  });

  test('RECEIVE drafts add up exactly to the BOQ grand total', () => {
    const drafts = milestonesFromBoq(boq, 'RECEIVE');
    // direct 40,999.99 → +10% 4,100.00 → 45,099.99 → +7% 3,157.00 → 48,256.99
    expect(sum(drafts.map((d) => d.amount)).toFixed(2)).toBe('48256.99');
    expect(drafts).toHaveLength(3);
  });

  test('summary ignores cancelled rows and counts paid net of retention', () => {
    const s = summarizeMilestones(100_000, [
      { amount: 40_000, retentionAmount: 2_000, status: 'PAID' },
      { amount: 30_000, retentionAmount: 1_500, status: 'APPROVED' },
      { amount: 20_000, retentionAmount: 0, status: 'PLANNED' },
      { amount: 99_999, retentionAmount: 0, status: 'CANCELLED' },
    ]);
    expect(s.planned.toNumber()).toBe(90_000);
    expect(s.unplanned.toNumber()).toBe(10_000);
    expect(s.approvedOrPaid.toNumber()).toBe(70_000);
    expect(s.paidNet.toNumber()).toBe(38_000);
    expect(s.retentionHeld.toNumber()).toBe(2_000);
    expect(s.plannedPercent).toBe(90);
  });
});
