import { describe, expect, test } from 'vitest';
import { ROLES, type Role, type SessionUser } from '@/db/schema';
import { expandHiddenMenus, isMenuVisible, MENU_KEYS, type MenuKey } from '@/domain/menu';
import { hiddenMenusForRole, ROLE_PRESETS } from '@/domain/role-presets';
import { can, type Action } from '@/server/policy';

const PROJECT = '00000000-0000-0000-0000-000000000001';
const person = (role: Role): SessionUser => ({
  id: 'u',
  email: 'u@ktec.local',
  name: 'ทดสอบ',
  roles: [role],
  projectIds: [PROJECT],
  hiddenMenus: hiddenMenusForRole(role),
});

/** Where each permission is used; a preset that hides it would take away something the role is meant to do. */
const NEEDS: [Action, MenuKey[]][] = [
  ['advance.request', ['FIN_ADVANCES', 'FIN_RECEIPT_SUBSTITUTES']],
  ['project.view', ['PROJECTS', 'TIMELINE']],
  ['master.manage', ['PROJECTS', 'PUR_VENDORS', 'LABOR_CONTRACTORS']],
  ['export.view', ['DASHBOARD', 'FIN_EXPORTS']],
  ['pr.create', ['PUR_PR']],
  ['pr.approve', ['APPROVALS', 'PUR_APPROVE']],
  ['po.manage', ['PUR_PO']],
  ['receipt.create', ['PUR_RECEIVE']],
  ['invoice.manage', ['PUR_PO', 'FIN_AP_INVOICES', 'LABOR_PAYABLES']],
  ['pv.manage', ['FIN_PV']],
  ['pv.pay', ['FIN_PV']],
  ['ar.manage', ['FIN_CUSTOMERS', 'FIN_AR_INVOICES', 'FIN_RECEIVABLES', 'FIN_OUTPUT_VAT']],
  ['prv.create', ['LABOR_PRV']],
  ['milestone.manage', ['LABOR_PAY', 'LABOR_RECEIVE']],
  ['milestone.pay', ['LABOR_PAY', 'LABOR_RECEIVE']],
  ['stock.move', ['STOCK_USAGE']],
  ['asset.inspect', ['FIN_ASSETS']],
  ['project.manage', ['AS_HANDOVER']],
];

/** Pages that refuse or redirect anyone without the permission, so showing the menu would only lead to an error. */
const REFUSES: [MenuKey, Action][] = [
  ['DASHBOARD', 'export.view'],
  ['FIN_EXPORTS', 'export.view'],
  ['FIN_PV', 'pv.manage'],
  ['FIN_AP_INVOICES', 'invoice.manage'],
  ['LABOR_PAYABLES', 'invoice.manage'],
  ['FIN_CUSTOMERS', 'ar.manage'],
  ['FIN_AR_INVOICES', 'ar.manage'],
  ['FIN_RECEIVABLES', 'ar.manage'],
  ['FIN_OUTPUT_VAT', 'ar.manage'],
];

describe('menu presets per role', () => {
  test('there is one for every role, using known entries only', () => {
    expect(ROLE_PRESETS.map((p) => p.role).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      const hidden = hiddenMenusForRole(role);
      expect(new Set(hidden).size).toBe(hidden.length);
      expect(hidden.every((key) => MENU_KEYS.includes(key))).toBe(true);
      // Stored the way the form keeps them, so choosing a preset can be recognised again
      expect(expandHiddenMenus(hidden)).toEqual(hidden);
    }
  });

  test('owner and admin keep every menu', () => {
    expect(hiddenMenusForRole('OWNER')).toEqual([]);
    expect(hiddenMenusForRole('ADMIN')).toEqual([]);
  });

  test.each(ROLES)('%s keeps every menu its permissions are for', (role) => {
    const u = person(role);
    for (const [action, menus] of NEEDS) {
      if (!can(u, action, { projectId: PROJECT })) continue;
      for (const menu of menus) expect(isMenuVisible(u.hiddenMenus, menu), `${role} ${action} ${menu}`).toBe(true);
    }
  });

  test.each(ROLES)('%s is not shown pages that would refuse it', (role) => {
    const u = person(role);
    for (const [menu, action] of REFUSES) {
      if (!can(u, action, { projectId: PROJECT })) expect(isMenuVisible(u.hiddenMenus, menu), `${role} ${menu}`).toBe(false);
    }
  });

  test('site roles keep what they do on site, without the office money pages', () => {
    for (const role of ['FOREMAN', 'ENGINEER'] as const) {
      const { hiddenMenus } = person(role);
      for (const menu of ['PUR_PR', 'PUR_RECEIVE', 'STOCK_USAGE', 'LABOR_PRV', 'FIN_ADVANCES', 'FIN_ASSETS'] as const) expect(isMenuVisible(hiddenMenus, menu)).toBe(true);
      for (const menu of ['DASHBOARD', 'PUR_PO', 'PUR_VENDORS', 'LABOR_RECEIVE', 'FIN_PV'] as const) expect(isMenuVisible(hiddenMenus, menu)).toBe(false);
    }
  });
});
