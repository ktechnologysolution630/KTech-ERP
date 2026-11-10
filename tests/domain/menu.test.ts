import { readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { blockedMenuFor, expandHiddenMenus, isMenuKey, isMenuVisible, landingPathFor, MENU_KEYS, MENU_LABELS, menuKeysForPath, MENU_TREE, type MenuKey } from '@/domain/menu';

describe('which menu entry a URL belongs to', () => {
  test.each([
    ['/dashboard', 'DASHBOARD'],
    ['/approvals', 'APPROVALS'],
    ['/projects', 'PROJECTS'],
    ['/projects/abc/boq', 'PROJECTS'],
    ['/timeline', 'TIMELINE'],
    ['/purchasing', 'PUR_OVERVIEW'],
    ['/purchasing/approve', 'PUR_APPROVE'],
    ['/purchasing/ap', 'PUR_AP'],
    ['/purchasing/vendors', 'PUR_VENDORS'],
    ['/purchasing/vendors/abc', 'PUR_VENDORS'],
    ['/pr', 'PUR_PR'],
    ['/pr/new', 'PUR_PR'],
    ['/po/abc/edit', 'PUR_PO'],
    ['/receive/abc', 'PUR_RECEIVE'],
    ['/labor-payments/contractors', 'LABOR_CONTRACTORS'],
    ['/prv/new', 'LABOR_PRV'],
    ['/payables', 'LABOR_PAYABLES'],
    ['/ar/customers', 'FIN_CUSTOMERS'],
    ['/ar/invoices/new', 'FIN_AR_INVOICES'],
    ['/ar/receivables', 'FIN_RECEIVABLES'],
    ['/ar/output-vat', 'FIN_OUTPUT_VAT'],
    ['/advances/abc', 'FIN_ADVANCES'],
    ['/receipt-substitutes', 'FIN_RECEIPT_SUBSTITUTES'],
    ['/invoices/new', 'FIN_AP_INVOICES'],
    ['/pv/abc', 'FIN_PV'],
    ['/exports', 'FIN_EXPORTS'],
    ['/assets', 'FIN_ASSETS'],
    ['/handover', 'AS_HANDOVER'],
    ['/warranty', 'AS_WARRANTY'],
    ['/api/pdf/po/abc', 'PUR_PO'],
    ['/api/pdf/pr/abc', 'PUR_PR'],
    ['/api/pdf/pv/abc', 'FIN_PV'],
    ['/api/export/wht', 'FIN_EXPORTS'],
  ])('%s is %s', (path, key) => {
    expect(menuKeysForPath(path)).toEqual([key]);
  });

  test('a shorter path does not swallow a longer one', () => {
    expect(menuKeysForPath('/prv')).toEqual(['LABOR_PRV']);
    expect(menuKeysForPath('/pv-something')).toEqual([]);
    expect(menuKeysForPath('/arx')).toEqual([]);
  });

  test.each([
    ['/stock', null, 'STOCK_OVERVIEW'],
    ['/stock', 'overview', 'STOCK_OVERVIEW'],
    ['/stock', 'movements', 'STOCK_MOVEMENTS'],
    ['/stock', 'low-stock', 'STOCK_LOW'],
    ['/stock', 'issues', 'STOCK_ISSUES'],
    ['/stock', 'material-usage', 'STOCK_USAGE'],
    ['/stock', 'all-stock', 'STOCK_ALL'],
    ['/stock', 'document-history', 'STOCK_ADJUST'],
    ['/stock', 'stock-count', 'STOCK_COUNT'],
    ['/stock', 'stock-adjust', 'STOCK_ADJUST'],
    ['/stock', 'made-up', 'STOCK_OVERVIEW'],
    ['/labor-payments', null, 'LABOR_PAY'],
    ['/labor-payments', 'payment-milestones', 'LABOR_PAY'],
    ['/labor-payments', 'receive-milestones', 'LABOR_RECEIVE'],
    ['/labor-payments', 'milestones', 'LABOR_REPORT'],
  ])('%s?tab=%s is %s, one page with several views', (path, tab, key) => {
    expect(menuKeysForPath(path, tab)).toEqual([key]);
  });

  test('pages everyone needs are never blocked, including the check itself', () => {
    for (const path of ['/', '/inbox', '/no-access', '/settings', '/master/users', '/master/items', '/login', '/api/upload', '/api/session/hidden-menus']) {
      expect(menuKeysForPath(path)).toEqual([]);
    }
  });
});

describe('hiding', () => {
  test('hiding one sub-menu blocks only that one', () => {
    const hidden: MenuKey[] = ['PUR_PO'];
    expect(blockedMenuFor(hidden, '/po')).toBe('PUR_PO');
    expect(blockedMenuFor(hidden, '/po/abc/edit')).toBe('PUR_PO');
    expect(blockedMenuFor(hidden, '/api/pdf/po/abc')).toBe('PUR_PO');
    expect(blockedMenuFor(hidden, '/pr')).toBeNull();
    expect(blockedMenuFor(hidden, '/purchasing')).toBeNull();
  });

  test('a tab is blocked on its own while the rest of the page stays open', () => {
    const hidden: MenuKey[] = ['STOCK_MOVEMENTS'];
    expect(blockedMenuFor(hidden, '/stock', 'movements')).toBe('STOCK_MOVEMENTS');
    expect(blockedMenuFor(hidden, '/stock', 'all-stock')).toBeNull();
    expect(blockedMenuFor(hidden, '/stock')).toBeNull();
  });

  test('a page shared by several sub-menus closes only when all of them are hidden', () => {
    expect(blockedMenuFor(['FIN_PV'], '/api/pdf/wht/abc')).toBeNull();
    expect(blockedMenuFor(['FIN_EXPORTS'], '/api/pdf/wht/abc')).toBeNull();
    expect(blockedMenuFor(['FIN_PV', 'FIN_EXPORTS'], '/api/pdf/wht/abc')).toBe('FIN_PV');
    expect(blockedMenuFor(['LABOR_PAY'], '/labor-payments/abc')).toBeNull();
    expect(blockedMenuFor(['LABOR_PAY', 'LABOR_RECEIVE', 'LABOR_REPORT'], '/labor-payments/abc')).toBe('LABOR_PAY');
    expect(blockedMenuFor(['FIN_CUSTOMERS', 'FIN_AR_INVOICES', 'FIN_RECEIVABLES', 'FIN_OUTPUT_VAT'], '/ar')).toBe('FIN_CUSTOMERS');
    expect(blockedMenuFor(['FIN_CUSTOMERS'], '/ar')).toBeNull();
  });

  test('a section saved as hidden hides everything in it', () => {
    expect(blockedMenuFor(['STOCK'], '/stock', 'all-stock')).toBe('STOCK_ALL');
    expect(blockedMenuFor(['FINANCE'], '/assets')).toBe('FIN_ASSETS');
    expect(expandHiddenMenus(['AFTER_SERVICE', 'DASHBOARD'])).toEqual(['AS_HANDOVER', 'AS_WARRANTY', 'DASHBOARD']);
    expect(expandHiddenMenus(['AS_HANDOVER', 'AFTER_SERVICE'])).toEqual(['AS_HANDOVER', 'AS_WARRANTY']);
  });

  test('a section shows while any of its sub-menus does', () => {
    expect(isMenuVisible([], 'STOCK')).toBe(true);
    expect(isMenuVisible(['AS_HANDOVER'], 'AFTER_SERVICE')).toBe(true);
    expect(isMenuVisible(['AS_HANDOVER', 'AS_WARRANTY'], 'AFTER_SERVICE')).toBe(false);
    expect(isMenuVisible(['AS_HANDOVER'], 'AS_HANDOVER')).toBe(false);
    expect(isMenuVisible(['AS_HANDOVER'], 'AS_WARRANTY')).toBe(true);
    expect(isMenuVisible(['DASHBOARD'], 'DASHBOARD')).toBe(false);
  });

  test('nothing hidden blocks nothing', () => {
    for (const path of ['/stock', '/po', '/ar/invoices', '/projects']) expect(blockedMenuFor([], path)).toBeNull();
  });
});

describe('every page and entry is accounted for', () => {
  /** Reachable by everyone on purpose. A new top-level page must be added here or given an entry. */
  const ALWAYS_OPEN = ['inbox', 'master', 'no-access', 'settings'];

  test('a new page cannot slip past the block unnoticed', () => {
    const pages = readdirSync(join(process.cwd(), 'src/app/(app)'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(pages.length).toBeGreaterThan(20);
    const unaccounted = pages.filter((p) => !ALWAYS_OPEN.includes(p) && menuKeysForPath(`/${p}`).length === 0);
    expect(unaccounted).toEqual([]);
  });

  test('every tickable entry actually controls a page', () => {
    const urls: [string, string?][] = [
      ['/dashboard'], ['/approvals'], ['/projects'], ['/timeline'],
      ['/stock', 'overview'], ['/stock', 'movements'], ['/stock', 'low-stock'], ['/stock', 'issues'], ['/stock', 'material-usage'], ['/stock', 'all-stock'], ['/stock', 'stock-count'], ['/stock', 'stock-adjust'],
      ['/purchasing'], ['/purchasing/project-report'], ['/pr'], ['/po'], ['/purchasing/approve'], ['/purchasing/ap'], ['/purchasing/vendors'], ['/receive'],
      ['/labor-payments', 'payment-milestones'], ['/labor-payments', 'receive-milestones'], ['/labor-payments', 'milestones'], ['/labor-payments/contractors'], ['/prv'], ['/payables'],
      ['/ar/customers'], ['/ar/invoices'], ['/ar/receivables'], ['/ar/output-vat'], ['/advances'], ['/receipt-substitutes'], ['/invoices'], ['/pv'], ['/cheques'], ['/exports'], ['/assets'],
      ['/handover'], ['/warranty'],
    ];
    const controlled = new Set(urls.flatMap(([path, tab]) => menuKeysForPath(path, tab ?? null)));
    const leaves = MENU_TREE.flatMap((node) => ('children' in node ? node.children.map((c) => c.key) : [node.key]));
    expect(leaves.filter((k) => !controlled.has(k))).toEqual([]);
  });

  test('every entry has a label', () => {
    for (const key of MENU_KEYS) expect(MENU_LABELS[key]).toBeTruthy();
    expect(new Set(MENU_KEYS).size).toBe(MENU_KEYS.length);
  });
});

describe('where to land after logging in', () => {
  test('goes to stock as before, unless its overview is hidden', () => {
    expect(landingPathFor([])).toBe('/stock');
    expect(landingPathFor(['FINANCE'])).toBe('/stock');
    expect(landingPathFor(['STOCK_ALL'])).toBe('/stock');
    expect(landingPathFor(['STOCK'])).toBe('/inbox');
    expect(landingPathFor(['STOCK_OVERVIEW'])).toBe('/inbox');
  });
});

describe('names from outside', () => {
  test('only known entries pass', () => {
    expect(isMenuKey('STOCK')).toBe(true);
    expect(isMenuKey('PUR_PO')).toBe(true);
    expect(isMenuKey('NOPE')).toBe(false);
    expect(isMenuKey(undefined)).toBe(false);
  });
});
