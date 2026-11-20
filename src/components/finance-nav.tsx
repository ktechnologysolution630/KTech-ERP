'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart2,
  BookOpen,
  CalendarClock,
  Car,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Landmark,
  MapPin,
  ShoppingBag,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { MenuKey } from '@/domain/menu';

interface FinanceLink {
  href: string;
  label: string;
  menu: MenuKey;
  icon?: LucideIcon;
}

interface FinanceGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  links: FinanceLink[];
}

/**
 * The บัญชี / การเงิน menu, grouped the way Express groups its menus (ขาย, ซื้อ, การเงิน, บัญชี, รายงาน)
 * so a long flat list reads as a few related sets. Each link keeps its own menu permission key.
 */
export const FINANCE_GROUPS: FinanceGroup[] = [
  {
    key: 'sales',
    label: 'ขาย / ลูกหนี้',
    icon: ShoppingBag,
    links: [
      { href: '/ar/customers', label: 'ลูกค้า', menu: 'FIN_CUSTOMERS' },
      { href: '/sales/quotations', label: 'ใบเสนอราคา', menu: 'FIN_QUOTATIONS' },
      { href: '/sales/sales-orders', label: 'ใบสั่งขาย (SO)', menu: 'FIN_SALES_ORDERS' },
      { href: '/ar/invoices', label: 'ใบแจ้งหนี้/วางบิล (ลูกค้า)', menu: 'FIN_AR_INVOICES' },
      { href: '/sales/tax-invoices', label: 'ใบกำกับภาษี', menu: 'FIN_TAX_INVOICES' },
      { href: '/sales/abbreviated-tax-invoices', label: 'ใบกำกับภาษีอย่างย่อ', menu: 'FIN_SHORT_TAX_INVOICES' },
      { href: '/sales/receipts', label: 'ใบเสร็จรับเงิน', menu: 'FIN_RECEIPTS' },
      { href: '/ar/credit-notes', label: 'ใบลดหนี้', menu: 'FIN_CREDIT_NOTES' },
      { href: '/sales/debit-notes', label: 'ใบเพิ่มหนี้', menu: 'FIN_DEBIT_NOTES' },
      { href: '/ar/receivables', label: 'ลูกหนี้', menu: 'FIN_RECEIVABLES' },
    ],
  },
  {
    key: 'purchase',
    label: 'ซื้อ / เจ้าหนี้',
    icon: ShoppingCart,
    links: [
      { href: '/invoices', label: 'ใบแจ้งหนี้ผู้ขาย (AP)', menu: 'FIN_AP_INVOICES' },
      { href: '/pv', label: 'ใบสำคัญจ่าย (PV)', menu: 'FIN_PV' },
      { href: '/cheques', label: 'ตารางจ่ายเช็ค', menu: 'FIN_CHEQUES', icon: CalendarClock },
    ],
  },
  {
    key: 'cash',
    label: 'การเงิน',
    icon: Wallet,
    links: [
      { href: '/cash-bank', label: 'เงินสด / ธนาคาร', menu: 'FIN_CASH_BANK' },
      { href: '/accounting/gl/bank-rec', label: 'กระทบยอดธนาคาร', menu: 'FIN_GL' },
      { href: '/sales/income', label: 'รายรับ', menu: 'FIN_INCOME' },
      { href: '/sales/expense', label: 'รายจ่าย', menu: 'FIN_EXPENSE' },
      { href: '/accounting/bill-scan', label: 'สแกนบิล', menu: 'FIN_BILL_SCAN' },
      { href: '/advances', label: 'เงินทดรองจ่าย', menu: 'FIN_ADVANCES' },
      { href: '/receipt-substitutes', label: 'ใบรับรองแทนใบเสร็จ', menu: 'FIN_RECEIPT_SUBSTITUTES' },
    ],
  },
  {
    key: 'ledger',
    label: 'บัญชี / ภาษี',
    icon: BookOpen,
    links: [
      { href: '/accounting', label: 'ภาพรวมบัญชี', menu: 'FIN_ACCOUNTING_OVERVIEW' },
      { href: '/accounting/gl', label: 'สมุดรายวัน / ผังบัญชี', menu: 'FIN_GL' },
      { href: '/accounting/gl/opening', label: 'ยอดยกมา', menu: 'FIN_GL' },
      { href: '/accounting/gl/close', label: 'ปิดงวด / ปิดบัญชีสิ้นปี', menu: 'FIN_GL' },
      { href: '/accounting/input-vat', label: 'ภาษีซื้อ', menu: 'FIN_INPUT_VAT' },
      { href: '/ar/output-vat', label: 'ภาษีขาย', menu: 'FIN_OUTPUT_VAT' },
      { href: '/accounting/wht', label: 'หัก ณ ที่จ่าย', menu: 'FIN_WHT' },
      { href: '/accounting/settings', label: 'ตั้งค่าบัญชีและภาษี', menu: 'FIN_ACCOUNTING_SETTINGS' },
    ],
  },
  {
    key: 'reports',
    label: 'รายงาน',
    icon: BarChart2,
    links: [
      { href: '/accounting/reports', label: 'รายงานบัญชี', menu: 'FIN_ACCOUNTING_REPORTS' },
      { href: '/accounting/wht-report', label: 'รายงานภาษีหัก ณ ที่จ่าย', menu: 'FIN_WHT_REPORT' },
      { href: '/exports', label: 'รายงาน/50 ทวิ', menu: 'FIN_EXPORTS' },
      { href: '/accounting/project-budget-report', label: 'รายงานงบประมาณโครงการ', menu: 'FIN_PROJECT_BUDGET' },
    ],
  },
  {
    key: 'assets',
    label: 'ทรัพย์สิน / การใช้รถ',
    icon: Landmark,
    links: [
      { href: '/assets', label: 'ตรวจเช็คทรัพย์สิน', menu: 'FIN_ASSETS', icon: ClipboardCheck },
      // In the order the work happens: register the vehicle, use it, watch it, report on it
      { href: '/vehicles/fleet', label: '1. ทะเบียนรถ', menu: 'VEH_FLEET', icon: ClipboardList },
      { href: '/vehicles', label: '2. ขอใช้รถ / รับรถ / คืนรถ', menu: 'VEH_TRIPS', icon: Car },
      { href: '/vehicles/live', label: '3. ติดตามรถ Realtime', menu: 'VEH_LIVE', icon: MapPin },
      { href: '/vehicles/report', label: '4. รายงานการใช้รถ', menu: 'VEH_REPORT', icon: FileText },
    ],
  },
];

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** True when the page belongs to one of the finance menu's links, so the top-level accordion opens on it */
export function isFinancePath(pathname: string): boolean {
  return FINANCE_GROUPS.some((g) => g.links.some((l) => l.href !== '/accounting' && matches(pathname, l.href))) || pathname === '/accounting';
}

/** The link the page belongs to: the longest href that matches, so /accounting/gl/close lights ปิดงวด, not สมุดรายวัน */
function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const g of FINANCE_GROUPS) {
    for (const l of g.links) {
      if (matches(pathname, l.href) && (!best || l.href.length > best.length)) best = l.href;
    }
  }
  return best;
}

export function FinanceNav({ pathname, canSee }: { pathname: string; canSee: (key: MenuKey) => boolean }) {
  const active = activeHref(pathname);
  // Only groups the person has opened or closed are stored; the rest follow the page (its group open)
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  return (
    <>
      {FINANCE_GROUPS.map((g) => {
        const links = g.links.filter((l) => canSee(l.menu));
        if (links.length === 0) return null;
        const hasActive = links.some((l) => l.href === active);
        const open = toggled[g.key] ?? hasActive;
        const GroupIcon = g.icon;
        return (
          <div key={g.key} className="pt-0.5">
            <button
              type="button"
              onClick={() => setToggled((t) => ({ ...t, [g.key]: !open }))}
              aria-expanded={open}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11.5px] font-semibold transition ${
                hasActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <ChevronRight className={`w-3 h-3 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
              <GroupIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-left">{g.label}</span>
              {!open && <span className="text-[10px] font-normal text-slate-400">{links.length}</span>}
            </button>
            {open && (
              <div className="ml-3 pl-2 border-l border-slate-100 space-y-0.5">
                {links.map((l) => {
                  const Icon = l.icon ?? FileText;
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        l.href === active
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{l.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
