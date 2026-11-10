import type { Role } from '@/db/schema';
import { expandHiddenMenus, MENU_KEYS, type MenuKey } from './menu';

/** Menus with nothing in them the role can use lead to an error page or a redirect, so a preset leaves them out. */
const EVERYONE: MenuKey[] = ['PROJECTS', 'TIMELINE', 'FIN_ADVANCES', 'FIN_RECEIPT_SUBSTITUTES'];
const STOCK: MenuKey[] = ['STOCK_OVERVIEW', 'STOCK_MOVEMENTS', 'STOCK_LOW', 'STOCK_ISSUES', 'STOCK_USAGE', 'STOCK_ALL', 'STOCK_COUNT', 'STOCK_ADJUST'];
const FOREMAN: MenuKey[] = [...EVERYONE, ...STOCK, 'PUR_PR', 'PUR_RECEIVE', 'LABOR_PRV', 'FIN_ASSETS', 'AS_WARRANTY'];
const ENGINEER: MenuKey[] = [...FOREMAN, 'LABOR_REPORT'];
const PURCHASING: MenuKey[] = [...EVERYONE, ...STOCK, 'PUR_OVERVIEW', 'PUR_PROJECT_REPORT', 'PUR_PR', 'PUR_PO', 'PUR_AP', 'PUR_VENDORS', 'PUR_RECEIVE', 'LABOR_PRV', 'LABOR_CONTRACTORS'];

const VISIBLE: Partial<Record<Role, MenuKey[]>> = {
  FOREMAN,
  ENGINEER,
  ARCHITECT: ENGINEER,
  PROJECT_CLERK: ENGINEER,
  PM: [...ENGINEER, 'APPROVALS', 'PUR_OVERVIEW', 'PUR_PROJECT_REPORT', 'PUR_PO', 'PUR_APPROVE', 'LABOR_PAY', 'LABOR_RECEIVE', 'LABOR_CONTRACTORS', 'AS_HANDOVER'],
  PURCHASING,
  PURCHASING_HEAD: [...PURCHASING, 'APPROVALS', 'PUR_APPROVE', 'FIN_ASSETS'],
  FINANCE: [
    ...EVERYONE,
    'DASHBOARD',
    'APPROVALS',
    // Supplier bills are entered from the PO
    'PUR_PO',
    'PUR_VENDORS',
    'LABOR_PAY',
    'LABOR_RECEIVE',
    'LABOR_REPORT',
    'LABOR_CONTRACTORS',
    'LABOR_PRV',
    'LABOR_PAYABLES',
    'FIN_CUSTOMERS',
    'FIN_AR_INVOICES',
    'FIN_RECEIVABLES',
    'FIN_OUTPUT_VAT',
    'FIN_AP_INVOICES',
    'FIN_PV',
    'FIN_EXPORTS',
    'FIN_ASSETS',
  ],
  GENERAL_MANAGER: [
    ...EVERYONE,
    ...STOCK,
    'DASHBOARD',
    'APPROVALS',
    'PUR_OVERVIEW', 'PUR_PROJECT_REPORT',
    'PUR_PR',
    'PUR_PO',
    'PUR_APPROVE',
    'PUR_AP',
    'PUR_VENDORS',
    'PUR_RECEIVE',
    'LABOR_PAY',
    'LABOR_RECEIVE',
    'LABOR_REPORT',
    'LABOR_CONTRACTORS',
    'LABOR_PRV',
    'FIN_EXPORTS',
    'FIN_ASSETS',
    'AS_HANDOVER',
    'AS_WARRANTY',
  ],
  // Owner and admin keep every menu
};

const ALL_ENTRIES = expandHiddenMenus(MENU_KEYS);

/** What to hide for someone whose only job is this role. */
export function hiddenMenusForRole(role: Role): MenuKey[] {
  const visible = VISIBLE[role];
  return visible ? ALL_ENTRIES.filter((key) => !visible.includes(key)) : [];
}

export const ROLE_PRESETS: { role: Role; summary: string }[] = [
  { role: 'FOREMAN', summary: 'ขอซื้อ รับของ เบิกใช้วัสดุ ขอเบิกเงิน เงินทดรอง และเช็คทรัพย์สินหน้างาน เฉพาะโครงการที่สังกัด' },
  { role: 'ENGINEER', summary: 'เหมือนโฟร์แมน และดูรายงานงวดงานได้ เฉพาะโครงการที่สังกัด' },
  { role: 'ARCHITECT', summary: 'เหมือนวิศวกร แก้ BOQ และจัดการงานได้ เฉพาะโครงการที่สังกัด' },
  { role: 'PROJECT_CLERK', summary: 'ทำเอกสารหน้างาน ขอซื้อ รับของ บันทึกเบิกวัสดุ ขอเบิกเงิน และอัปเดตความคืบหน้า เฉพาะโครงการที่สังกัด แต่แก้ BOQ แผนงาน และอนุมัติไม่ได้' },
  { role: 'PM', summary: 'ดูแลโครงการที่สังกัด อนุมัติ PR ยืนยันใบขอเบิก จัดงวดงาน และส่งมอบงาน' },
  { role: 'PURCHASING', summary: 'ทำ PO จัดการซัพพลายเออร์และสต็อก เห็นทุกโครงการ แต่อนุมัติไม่ได้' },
  { role: 'PURCHASING_HEAD', summary: 'เหมือนจัดซื้อ และอนุมัติ PO ได้ไม่เกินวงเงิน ซึ่งต้องไม่ใช่ใบที่ตัวเองสร้าง' },
  { role: 'FINANCE', summary: 'บันทึกใบแจ้งหนี้ ทำใบสำคัญจ่าย จ่ายเงิน รับเงินจากลูกค้า และรายงานภาษี เห็นทุกโครงการ' },
  { role: 'GENERAL_MANAGER', summary: 'ดูแลทุกโครงการ เห็นตัวเลขการเงิน อนุมัติ PR ยืนยันใบขอเบิก และอนุมัติ PO ไม่เกินวงเงิน แต่อนุมัติจ่ายเงิน จ่ายเงิน และลบข้อมูลไม่ได้' },
  { role: 'OWNER', summary: 'เห็นทุกเมนู อนุมัติและจ่ายเงินได้ ลบโครงการได้ แต่จัดการผู้ใช้งานไม่ได้' },
  { role: 'ADMIN', summary: 'เห็นทุกเมนู จัดการผู้ใช้งาน ลบโครงการได้ แต่อนุมัติ PO และจ่ายเงินไม่ได้' },
];
