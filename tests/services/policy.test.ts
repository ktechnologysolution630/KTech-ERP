import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import type { Role, SessionUser } from '@/db/schema';
import { can, assertCan, isSiteScopedOnly } from '@/server/policy';
import { D } from '@/domain/money';
import { DomainError } from '@/domain/errors';

const PROJECT = '00000000-0000-0000-0000-000000000001';
const OTHER_PROJECT = '00000000-0000-0000-0000-000000000002';
const person = (role: Role, projectIds: string[] = []): SessionUser => ({ id: `u-${role}`, email: `${role}@ktec.local`, name: role, roles: [role], projectIds, hiddenMenus: [] });

describe('project architect', () => {
  const architect = person('ARCHITECT', [PROJECT]);

  test('works like an engineer on their own projects', () => {
    for (const action of ['project.view', 'boq.manage', 'task.manage', 'task.progress', 'pr.create', 'receipt.create', 'prv.create', 'stock.move', 'asset.inspect'] as const) {
      expect(can(architect, action, { projectId: PROJECT }), action).toBe(can(person('ENGINEER', [PROJECT]), action, { projectId: PROJECT }));
      expect(can(architect, action, { projectId: PROJECT }), action).toBe(true);
    }
  });

  test('sees nothing of other projects, and no money or approvals', () => {
    expect(can(architect, 'project.view', { projectId: OTHER_PROJECT })).toBe(false);
    expect(can(architect, 'boq.manage', { projectId: OTHER_PROJECT })).toBe(false);
    expect(isSiteScopedOnly(architect)).toBe(true);
    for (const action of ['project.finance', 'project.manage', 'pr.approve', 'prv.verify', 'export.view', 'project.delete'] as const) {
      expect(can(architect, action, { projectId: PROJECT }), action).toBe(false);
    }
  });
});

describe('project clerk', () => {
  const clerk = person('PROJECT_CLERK', [PROJECT]);

  test('does the paperwork of their own projects', () => {
    for (const action of ['project.view', 'task.progress', 'pr.create', 'receipt.create', 'prv.create', 'stock.move', 'asset.inspect'] as const) {
      expect(can(clerk, action, { projectId: PROJECT }), action).toBe(true);
      expect(can(clerk, action, { projectId: OTHER_PROJECT }), action).toBe(false);
    }
    expect(isSiteScopedOnly(clerk)).toBe(true);
  });

  test('does not change the plan or the BOQ, see the money, or approve', () => {
    for (const action of ['boq.manage', 'task.manage', 'project.manage', 'project.finance', 'pr.approve', 'prv.verify', 'milestone.manage', 'po.manage', 'export.view', 'project.delete', 'asset.delete'] as const) {
      expect(can(clerk, action, { projectId: PROJECT }), action).toBe(false);
    }
  });
});

describe('general manager', () => {
  const manager = person('GENERAL_MANAGER');

  test('runs every project without being a member', () => {
    expect(isSiteScopedOnly(manager)).toBe(false);
    for (const action of ['project.view', 'project.finance', 'project.manage', 'boq.manage', 'task.manage', 'task.progress', 'milestone.manage', 'vo.manage', 'pr.approve', 'prv.verify', 'master.manage', 'export.view', 'stock.approveAdjust', 'advance.approve', 'milestone.approve'] as const) {
      expect(can(manager, action, { projectId: PROJECT }), action).toBe(true);
    }
  });

  test('approves a PO under the limit only, and never their own', () => {
    const limit = { gross: D('49999.99'), poApprovalLimit: D(50000), createdBy: 'someone' };
    expect(can(manager, 'po.approve', limit)).toBe(true);
    expect(can(manager, 'po.approve', { ...limit, gross: D(50000) })).toBe(false);
    expect(can(manager, 'po.approve', { ...limit, createdBy: manager.id })).toBe(false);
  });

  test('leaves payment, commercial decisions, deleting and users to others', () => {
    for (const action of ['pv.approve', 'pv.pay', 'prv.approve', 'milestone.pay', 'advance.pay', 'vo.approve', 'boqOverrun.approve', 'closeShort.approve', 'project.delete', 'asset.delete', 'users.manage', 'settings.manage', 'pv.manage', 'invoice.manage', 'ar.manage', 'po.manage'] as const) {
      expect(can(manager, action, { projectId: PROJECT }), action).toBe(false);
    }
  });
});

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
