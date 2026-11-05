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
