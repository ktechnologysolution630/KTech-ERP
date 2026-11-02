import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { can, assertCan } from '@/server/policy';
import { D } from '@/domain/money';
import { DomainError } from '@/domain/errors';

describe('policy', () => {
  test('foreman can receive only in own project', async () => {
    const db = await createTestDb();
    const s = await seedBasics(db);
    const f = s.users;
    expect(can(f.foreman, 'receipt.create', { projectId: s.projectA })).toBe(true);
    expect(can(f.foreman, 'receipt.create', { projectId: s.projectB })).toBe(false);
    expect(can(f.foreman, 'receipt.create', { projectId: null })).toBe(false);
    expect(can(f.buyer, 'receipt.create', { projectId: null })).toBe(true);
    expect(() =>
      assertCan(f.foreman, 'receipt.create', { projectId: s.projectB }),
    ).toThrow(DomainError);
  });

  test('po approval routes by limit', async () => {
    const db = await createTestDb();
    const s = await seedBasics(db);
    const f = s.users;
    const lim = D(50000);
    expect(
      can(f.buyerHead, 'po.approve', {
        gross: D('49999.99'),
        poApprovalLimit: lim,
        createdBy: f.buyer.id,
      }),
    ).toBe(true);
    expect(
      can(f.buyerHead, 'po.approve', {
        gross: D(50000),
        poApprovalLimit: lim,
        createdBy: f.buyer.id,
      }),
    ).toBe(false);
    expect(
      can(f.owner, 'po.approve', {
        gross: D(900000),
        poApprovalLimit: lim,
        createdBy: f.owner.id,
      }),
    ).toBe(true);
    expect(
      can(f.buyerHead, 'po.approve', {
        gross: D(10),
        poApprovalLimit: lim,
        createdBy: f.buyerHead.id,
      }),
    ).toBe(false);
  });

  test('only owner approves pv', async () => {
    const db = await createTestDb();
    const s = await seedBasics(db);
    const f = s.users;
    expect(can(f.owner, 'pv.approve')).toBe(true);
    expect(can(f.finance, 'pv.approve')).toBe(false);
    expect(can(f.finance, 'pv.pay')).toBe(true);
    expect(can(f.owner, 'pv.pay')).toBe(true);
  });
});
