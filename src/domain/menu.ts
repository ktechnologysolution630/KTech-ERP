/**
 * Sidebar sections an administrator can hide per user. Portal, users and settings are always shown, so nobody
 * loses their way home or the means to undo this.
 */
export const MENU_SECTIONS = ['DASHBOARD', 'APPROVALS', 'PROJECTS', 'TIMELINE', 'STOCK', 'PURCHASING', 'LABOR', 'FINANCE', 'AFTER_SERVICE'] as const;
export type MenuSection = (typeof MENU_SECTIONS)[number];

export const MENU_SECTION_LABELS: Record<MenuSection, string> = {
  DASHBOARD: 'Dashboard',
  APPROVALS: 'K Tec Approve',
  PROJECTS: 'โครงการ',
  TIMELINE: 'Timeline โครงการ',
  STOCK: 'สต็อก',
  PURCHASING: 'จัดซื้อ / สั่งซื้อ',
  LABOR: 'ค่าแรง / งวดงาน',
  FINANCE: 'บัญชี / การเงิน',
  AFTER_SERVICE: 'บริการหลังก่อสร้าง',
};

/** Where each section lives. Documents and exports count too, since they open the same data as the pages. */
const SECTION_PATHS: Record<MenuSection, string[]> = {
  DASHBOARD: ['/dashboard'],
  APPROVALS: ['/approvals'],
  PROJECTS: ['/projects'],
  TIMELINE: ['/timeline'],
  STOCK: ['/stock'],
  PURCHASING: ['/purchasing', '/pr', '/po', '/receive', '/api/pdf/pr', '/api/pdf/po'],
  LABOR: ['/labor-payments', '/prv', '/payables'],
  FINANCE: ['/ar', '/advances', '/receipt-substitutes', '/invoices', '/pv', '/exports', '/assets', '/api/export', '/api/pdf/pv', '/api/pdf/wht'],
  AFTER_SERVICE: ['/handover', '/warranty'],
};

const PATH_SECTIONS = (Object.entries(SECTION_PATHS) as [MenuSection, string[]][]).flatMap(([section, paths]) => paths.map((path) => ({ path, section })));

/** Which section a URL belongs to. Whole path segments only: /pr is not /prv or /projects. */
export function menuSectionForPath(pathname: string): MenuSection | null {
  return PATH_SECTIONS.find(({ path }) => pathname === path || pathname.startsWith(`${path}/`))?.section ?? null;
}

/** Where someone goes after logging in without a page to return to. */
export const landingPathFor = (hiddenMenus: readonly MenuSection[]): string => (hiddenMenus.includes('STOCK') ? '/inbox' : '/stock');

export const isMenuSection = (value: unknown): value is MenuSection => MENU_SECTIONS.includes(value as MenuSection);
