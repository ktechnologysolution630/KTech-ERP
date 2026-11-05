/**
 * Sidebar entries an administrator can hide per user. Portal and settings are not listed: they stay, so nobody
 * loses their way home. A section with children is shown while any child is.
 */
export const MENU_TREE = [
  { key: 'DASHBOARD', label: 'Dashboard' },
  { key: 'APPROVALS', label: 'K Tec Approve' },
  { key: 'PROJECTS', label: 'โครงการ' },
  { key: 'TIMELINE', label: 'Timeline โครงการ' },
  {
    key: 'STOCK',
    label: 'สต็อก',
    children: [
      { key: 'STOCK_OVERVIEW', label: 'ภาพรวมสต็อก' },
      { key: 'STOCK_MOVEMENTS', label: 'รายการเคลื่อนไหวล่าสุด' },
      { key: 'STOCK_LOW', label: 'แจ้งเตือนวัสดุใกล้หมด' },
      { key: 'STOCK_ISSUES', label: 'รายงานความเคลื่อนไหวสินค้า' },
      { key: 'STOCK_USAGE', label: 'บันทึกการใช้วัสดุ' },
      { key: 'STOCK_ALL', label: 'สต็อกทั้งหมด' },
    ],
  },
  {
    key: 'PURCHASING',
    label: 'จัดซื้อ / สั่งซื้อ',
    children: [
      { key: 'PUR_OVERVIEW', label: 'ภาพรวมจัดซื้อ' },
      { key: 'PUR_PR', label: 'ใบขอซื้อ PR' },
      { key: 'PUR_PO', label: 'ใบสั่งซื้อ PO' },
      { key: 'PUR_APPROVE', label: 'อนุมัติจัดซื้อ' },
      { key: 'PUR_AP', label: 'ใบ AP' },
      { key: 'PUR_VENDORS', label: 'ซัพพลายเออร์' },
      { key: 'PUR_RECEIVE', label: 'รอรับสินค้า' },
    ],
  },
  {
    key: 'LABOR',
    label: 'ค่าแรง / งวดงาน',
    children: [
      { key: 'LABOR_PAY', label: 'แผนงวดงานจ่าย' },
      { key: 'LABOR_RECEIVE', label: 'แผนงวดงานรับ' },
      { key: 'LABOR_REPORT', label: 'รายงานงวดงาน' },
      { key: 'LABOR_CONTRACTORS', label: 'ผู้รับเหมาและทีมงาน' },
      { key: 'LABOR_PRV', label: 'ใบสั่งจ่ายเงิน (PRV)' },
      { key: 'LABOR_PAYABLES', label: 'คิวตั้งจ่าย' },
    ],
  },
  {
    key: 'FINANCE',
    label: 'บัญชี / การเงิน',
    children: [
      { key: 'FIN_CUSTOMERS', label: 'ลูกค้า' },
      { key: 'FIN_AR_INVOICES', label: 'ใบแจ้งหนี้/วางบิล (ลูกค้า)' },
      { key: 'FIN_RECEIVABLES', label: 'ลูกหนี้' },
      { key: 'FIN_OUTPUT_VAT', label: 'ภาษีขาย' },
      { key: 'FIN_ADVANCES', label: 'เงินทดรองจ่าย' },
      { key: 'FIN_RECEIPT_SUBSTITUTES', label: 'ใบรับรองแทนใบเสร็จ' },
      { key: 'FIN_AP_INVOICES', label: 'ใบแจ้งหนี้ผู้ขาย (AP)' },
      { key: 'FIN_PV', label: 'ใบสำคัญจ่าย (PV)' },
      { key: 'FIN_EXPORTS', label: 'รายงาน/50 ทวิ' },
      { key: 'FIN_ASSETS', label: 'ตรวจเช็คทรัพย์สิน' },
    ],
  },
  {
    key: 'AFTER_SERVICE',
    label: 'บริการหลังก่อสร้าง',
    children: [
      { key: 'AS_HANDOVER', label: 'ส่งมอบโครงการ' },
      { key: 'AS_WARRANTY', label: 'ใบรับประกันผลงาน' },
    ],
  },
] as const;

type MenuNode = (typeof MENU_TREE)[number];
type SectionWithChildren = Extract<MenuNode, { children: unknown }>;
export type MenuKey = MenuNode['key'] | SectionWithChildren['children'][number]['key'];

const childrenOf = (node: MenuNode): readonly { key: MenuKey; label: string }[] => ('children' in node ? node.children : []);

export const MENU_KEYS = MENU_TREE.flatMap((node) => [node.key, ...childrenOf(node).map((c) => c.key)]) as [MenuKey, ...MenuKey[]];

export const MENU_LABELS = Object.fromEntries(MENU_TREE.flatMap((node) => [[node.key, node.label], ...childrenOf(node).map((c) => [c.key, c.label])])) as Record<MenuKey, string>;

const CHILDREN_BY_SECTION = new Map<MenuKey, MenuKey[]>(MENU_TREE.map((node) => [node.key, childrenOf(node).map((c) => c.key)]));

export const isMenuKey = (value: unknown): value is MenuKey => MENU_KEYS.includes(value as MenuKey);

/** Hiding a whole section means hiding each thing in it. */
export function expandHiddenMenus(hidden: readonly MenuKey[]): MenuKey[] {
  const expanded = hidden.flatMap((key) => {
    const children = CHILDREN_BY_SECTION.get(key) ?? [];
    return children.length > 0 ? children : [key];
  });
  return [...new Set(expanded)];
}

export function isMenuVisible(hidden: readonly MenuKey[], key: MenuKey): boolean {
  const all = expandHiddenMenus(hidden);
  const children = CHILDREN_BY_SECTION.get(key) ?? [];
  return children.length > 0 ? children.some((c) => !all.includes(c)) : !all.includes(key);
}

/** Pages that are one URL with several views, told apart by ?tab=. */
const TABBED_PATHS: Record<string, { fallback: MenuKey; tabs: Record<string, MenuKey> }> = {
  '/stock': {
    fallback: 'STOCK_OVERVIEW',
    tabs: {
      overview: 'STOCK_OVERVIEW',
      movements: 'STOCK_MOVEMENTS',
      'low-stock': 'STOCK_LOW',
      issues: 'STOCK_ISSUES',
      'material-usage': 'STOCK_USAGE',
      'all-stock': 'STOCK_ALL',
      'document-history': 'STOCK_ALL',
    },
  },
  '/labor-payments': {
    fallback: 'LABOR_PAY',
    tabs: { 'payment-milestones': 'LABOR_PAY', 'receive-milestones': 'LABOR_RECEIVE', milestones: 'LABOR_REPORT' },
  },
};

const AR_KEYS: MenuKey[] = ['FIN_CUSTOMERS', 'FIN_AR_INVOICES', 'FIN_RECEIVABLES', 'FIN_OUTPUT_VAT'];

/**
 * Which entries open each URL, including sub-pages. Where several do, the page stays open while any of them is
 * shown: a withholding tax certificate is reached from both the payment voucher and the reports.
 */
const PATHS: [string, MenuKey[]][] = [
  ['/dashboard', ['DASHBOARD']],
  ['/approvals', ['APPROVALS']],
  ['/projects', ['PROJECTS']],
  ['/timeline', ['TIMELINE']],
  ['/stock', ['STOCK_OVERVIEW', 'STOCK_MOVEMENTS', 'STOCK_LOW', 'STOCK_ISSUES', 'STOCK_USAGE', 'STOCK_ALL']],
  ['/purchasing', ['PUR_OVERVIEW']],
  ['/purchasing/approve', ['PUR_APPROVE']],
  ['/purchasing/ap', ['PUR_AP']],
  ['/purchasing/vendors', ['PUR_VENDORS']],
  ['/pr', ['PUR_PR']],
  ['/po', ['PUR_PO']],
  ['/receive', ['PUR_RECEIVE']],
  ['/api/pdf/pr', ['PUR_PR']],
  ['/api/pdf/po', ['PUR_PO']],
  // A project's milestone sheet is reached from any of the three milestone views
  ['/labor-payments', ['LABOR_PAY', 'LABOR_RECEIVE', 'LABOR_REPORT']],
  ['/labor-payments/contractors', ['LABOR_CONTRACTORS']],
  ['/prv', ['LABOR_PRV']],
  ['/payables', ['LABOR_PAYABLES']],
  ['/ar', AR_KEYS],
  ['/ar/customers', ['FIN_CUSTOMERS']],
  ['/ar/invoices', ['FIN_AR_INVOICES']],
  ['/ar/receivables', ['FIN_RECEIVABLES']],
  ['/ar/output-vat', ['FIN_OUTPUT_VAT']],
  ['/advances', ['FIN_ADVANCES']],
  ['/receipt-substitutes', ['FIN_RECEIPT_SUBSTITUTES']],
  ['/invoices', ['FIN_AP_INVOICES']],
  ['/pv', ['FIN_PV']],
  ['/exports', ['FIN_EXPORTS']],
  ['/assets', ['FIN_ASSETS']],
  ['/api/export', ['FIN_EXPORTS']],
  ['/api/pdf/pv', ['FIN_PV']],
  ['/api/pdf/wht', ['FIN_PV', 'FIN_EXPORTS']],
  ['/handover', ['AS_HANDOVER']],
  ['/warranty', ['AS_WARRANTY']],
];

/** The entries that open this URL; none means it is open to everyone. Whole path segments only: /pr is not /prv or /projects. */
export function menuKeysForPath(pathname: string, tab: string | null = null): MenuKey[] {
  const tabbed = TABBED_PATHS[pathname];
  if (tabbed) return [(tab && tabbed.tabs[tab]) || tabbed.fallback];
  const matches = PATHS.filter(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  // The most specific path decides: /purchasing/vendors is not the purchasing overview
  return matches.sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? [];
}

/** The entry to name when this URL is refused, or null when the user may open it. */
export function blockedMenuFor(hidden: readonly MenuKey[], pathname: string, tab: string | null = null): MenuKey | null {
  const keys = menuKeysForPath(pathname, tab);
  return keys.length > 0 && keys.every((key) => !isMenuVisible(hidden, key)) ? keys[0]! : null;
}

/** Where someone goes after logging in without a page to return to. */
export const landingPathFor = (hidden: readonly MenuKey[]): string => (isMenuVisible(hidden, 'STOCK_OVERVIEW') ? '/stock' : '/inbox');
