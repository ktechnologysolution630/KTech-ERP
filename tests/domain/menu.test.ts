import { readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { isMenuSection, landingPathFor, menuSectionForPath } from '@/domain/menu';

describe('which menu section a URL belongs to', () => {
  test.each([
    ['/dashboard', 'DASHBOARD'],
    ['/approvals', 'APPROVALS'],
    ['/projects', 'PROJECTS'],
    ['/projects/abc/boq', 'PROJECTS'],
    ['/timeline', 'TIMELINE'],
    ['/stock', 'STOCK'],
    ['/purchasing/vendors', 'PURCHASING'],
    ['/pr', 'PURCHASING'],
    ['/pr/new', 'PURCHASING'],
    ['/po/abc/edit', 'PURCHASING'],
    ['/receive/abc', 'PURCHASING'],
    ['/labor-payments/contractors', 'LABOR'],
    ['/prv/new', 'LABOR'],
    ['/payables', 'LABOR'],
    ['/ar/invoices/new', 'FINANCE'],
    ['/advances/abc', 'FINANCE'],
    ['/receipt-substitutes', 'FINANCE'],
    ['/invoices/new', 'FINANCE'],
    ['/pv/abc', 'FINANCE'],
    ['/exports', 'FINANCE'],
    ['/assets', 'FINANCE'],
    ['/handover', 'AFTER_SERVICE'],
    ['/warranty', 'AFTER_SERVICE'],
  ])('%s is %s', (path, section) => {
    expect(menuSectionForPath(path)).toBe(section);
  });

  test('documents and exports follow the section whose data they hold', () => {
    expect(menuSectionForPath('/api/pdf/po/abc')).toBe('PURCHASING');
    expect(menuSectionForPath('/api/pdf/pr/abc')).toBe('PURCHASING');
    expect(menuSectionForPath('/api/pdf/pv/abc')).toBe('FINANCE');
    expect(menuSectionForPath('/api/pdf/wht/abc')).toBe('FINANCE');
    expect(menuSectionForPath('/api/export/wht')).toBe('FINANCE');
  });

  test('a shorter path does not swallow a longer one', () => {
    expect(menuSectionForPath('/prv')).toBe('LABOR');
    expect(menuSectionForPath('/projects')).toBe('PROJECTS');
    expect(menuSectionForPath('/pv-something')).toBeNull();
    expect(menuSectionForPath('/arx')).toBeNull();
  });

  test('pages everyone needs are never blocked, including the check itself', () => {
    for (const path of ['/', '/inbox', '/no-access', '/settings', '/master/users', '/master/items', '/login', '/api/upload', '/api/session/hidden-menus']) {
      expect(menuSectionForPath(path)).toBeNull();
    }
  });
});

describe('every page is accounted for', () => {
  /** Reachable by everyone on purpose. A new top-level page must be added here or given a section. */
  const ALWAYS_OPEN = ['inbox', 'master', 'no-access', 'settings'];

  test('a new page cannot slip past the block unnoticed', () => {
    const pages = readdirSync(join(process.cwd(), 'src/app/(app)'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(pages.length).toBeGreaterThan(20);
    const unaccounted = pages.filter((p) => !ALWAYS_OPEN.includes(p) && menuSectionForPath(`/${p}`) === null);
    expect(unaccounted).toEqual([]);
  });
});

describe('where to land after logging in', () => {
  test('goes to stock as before, unless stock is hidden', () => {
    expect(landingPathFor([])).toBe('/stock');
    expect(landingPathFor(['FINANCE'])).toBe('/stock');
    expect(landingPathFor(['STOCK'])).toBe('/inbox');
  });
});

describe('section names from outside', () => {
  test('only known sections pass', () => {
    expect(isMenuSection('STOCK')).toBe(true);
    expect(isMenuSection('NOPE')).toBe(false);
    expect(isMenuSection(undefined)).toBe(false);
  });
});
