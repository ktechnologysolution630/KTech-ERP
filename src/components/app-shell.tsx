'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Briefcase,
  LayoutGrid,
  Folder,
  Calendar,
  Package,
  ShoppingCart,
  Wrench,
  Receipt,
  ShieldCheck,
  Users,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Building2,
  Bell,
  Menu,
  X,
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  BarChart2,
  ClipboardCheck,
  Layers,
} from 'lucide-react';
import type { SessionUser } from '@/db/schema';
import { isMenuVisible, type MenuKey } from '@/domain/menu';
import { logoutAction } from '@/app/login/actions';

interface AppShellProps {
  user: SessionUser;
  unreadCount?: number;
  /** From Settings; shown in the top bar */
  companyName: string;
  /** Documents waiting on this user; null hides the menu from users who approve nothing */
  pendingApprovalCount?: number | null;
  canManageUsers?: boolean;
  canManageSettings?: boolean;
  children: React.ReactNode;
}

/** Receivables (ฝั่งขาย) pages in the finance menu */
const AR_LINKS: { href: string; label: string; menu: MenuKey }[] = [
  { href: '/ar/customers', label: 'ลูกค้า', menu: 'FIN_CUSTOMERS' },
  { href: '/ar/invoices', label: 'ใบแจ้งหนี้/วางบิล (ลูกค้า)', menu: 'FIN_AR_INVOICES' },
  { href: '/ar/receivables', label: 'ลูกหนี้', menu: 'FIN_RECEIVABLES' },
  { href: '/ar/output-vat', label: 'ภาษีขาย', menu: 'FIN_OUTPUT_VAT' },
  { href: '/advances', label: 'เงินทดรองจ่าย', menu: 'FIN_ADVANCES' },
  { href: '/receipt-substitutes', label: 'ใบรับรองแทนใบเสร็จ', menu: 'FIN_RECEIPT_SUBSTITUTES' },
];

export function AppShell({ user, unreadCount = 0, companyName, pendingApprovalCount = null, canManageUsers = false, canManageSettings = false, children }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'overview';

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Accordion open states
  const [openStock, setOpenStock] = useState<boolean>(true);
  const [openPurchasing, setOpenPurchasing] = useState<boolean>(
    pathname.startsWith('/pr') || pathname.startsWith('/po') || pathname.startsWith('/receive'),
  );
  const [openLabor, setOpenLabor] = useState<boolean>(
    pathname.startsWith('/labor-payments') || pathname.startsWith('/prv') || pathname.startsWith('/payables'),
  );
  const [openFinance, setOpenFinance] = useState<boolean>(
    pathname.startsWith('/invoices') || pathname.startsWith('/pv') || pathname.startsWith('/exports') || pathname.startsWith('/assets'),
  );
  const [openAfterService, setOpenAfterService] = useState<boolean>(
    pathname.startsWith('/handover') || pathname.startsWith('/warranty'),
  );

  const isStockActive = (tabKey: string) => {
    return pathname === '/stock' && currentTab === tabKey;
  };

  const isLaborActive = (tabKey: string) => {
    return pathname === '/labor-payments' && (currentTab === tabKey || (!searchParams.get('tab') && tabKey === 'payment-milestones'));
  };

  const canSee = (key: MenuKey) => isMenuVisible(user.hiddenMenus, key);

  const displayName = user.name;
  const displayEmail = user.email;
  const initials = displayName ? displayName.slice(0, 2) : 'อผ';

  return (
    <div className="min-h-screen flex bg-[#f8fafc] text-slate-800 font-sans antialiased">
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed md:sticky top-0 z-50 h-screen bg-white border-r border-slate-200 flex flex-col transition-all duration-300 ease-in-out ${
          collapsed ? 'md:w-16' : 'w-64'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Brand / Logo Header */}
        <div className="h-14 border-b border-slate-200 px-3.5 flex items-center justify-between shrink-0">
          <Link href={canSee('DASHBOARD') ? '/dashboard' : '/inbox'} prefetch={false} className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-[#2453d4] flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm shadow-blue-500/20">
              KT
            </div>
            {!collapsed && (
              <div className="leading-tight">
                <span className="font-bold text-slate-900 text-sm tracking-tight">K Tec ERP</span>
                <span className="block text-[8px] font-bold text-slate-400 tracking-wider uppercase">
                  CONSTRUCTION MANAGEMENT
                </span>
              </div>
            )}
          </Link>

          {/* Collapse Button */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
            title={collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>

          {/* Mobile Close Button */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Nav Items */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 text-xs select-none scrollbar-thin">
          {/* Section: WORKSPACE */}
          <div>
            {!collapsed && (
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold text-slate-400 tracking-wider uppercase">
                WORKSPACE
              </div>
            )}
            <div className="space-y-0.5">
              <Link
                href="/inbox"
                prefetch={false}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                  pathname === '/inbox'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title="พอร์ทัลของฉัน"
              >
                <div className="flex items-center gap-2.5">
                  <Briefcase className="w-4 h-4 text-slate-500 shrink-0" />
                  {!collapsed && <span>พอร์ทัลของฉัน</span>}
                </div>
                {!collapsed && <span className="text-[10px] text-slate-400">My Portal</span>}
              </Link>

              {canSee('DASHBOARD') && (
              <Link
                href="/dashboard"
                prefetch={false}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                  pathname === '/dashboard'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title="Dashboard"
              >
                <div className="flex items-center gap-2.5">
                  <LayoutGrid className="w-4 h-4 text-slate-500 shrink-0" />
                  {!collapsed && <span>Dashboard</span>}
                </div>
                {!collapsed && <span className="text-[10px] text-slate-400">Dashboard</span>}
              </Link>
              )}

              {pendingApprovalCount !== null && canSee('APPROVALS') && (
                <Link
                  href="/approvals"
                  prefetch={false}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                    pathname === '/approvals'
                      ? 'bg-emerald-50 text-emerald-800 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                  title="K Tec Approve"
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    {!collapsed && <span>K Tec Approve</span>}
                  </div>
                  {!collapsed && pendingApprovalCount > 0 && (
                    <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">{pendingApprovalCount}</span>
                  )}
                </Link>
              )}
            </div>
          </div>

          {/* Section: Operations */}
          <div>
            {!collapsed && (
              <div className="px-2.5 mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 tracking-wider">
                <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-100" />
                <span className="text-emerald-700 font-bold uppercase">Operations</span>
              </div>
            )}

            <div className="space-y-0.5">
              {/* โครงการ (Projects) */}
              {canSee('PROJECTS') && (
              <Link
                href="/projects"
                prefetch={false}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                  pathname === '/projects'
                    ? 'bg-blue-50 text-[#2453d4] font-semibold border-l-2 border-[#2453d4]'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title="โครงการ"
              >
                <div className="flex items-center gap-2.5">
                  <Folder className="w-4 h-4 text-slate-500 shrink-0" />
                  {!collapsed && <span>โครงการ</span>}
                </div>
                {!collapsed && <span className="text-[10px] text-slate-400">Projects</span>}
              </Link>
              )}

              {/* Timeline โครงการ */}
              {canSee('TIMELINE') && (
              <Link
                href="/timeline"
                prefetch={false}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                  pathname === '/timeline'
                    ? 'bg-blue-50 text-[#2453d4] font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title="Timeline โครงการ"
              >
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
                  {!collapsed && <span>Timeline โครงการ</span>}
                </div>
              </Link>
              )}

              {/* สต็อก (Accordion) */}
              {canSee('STOCK') && (
              <div>
                <button
                  type="button"
                  onClick={() => setOpenStock(!openStock)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                    pathname.startsWith('/stock')
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Package className="w-4 h-4 text-slate-600 shrink-0" />
                    {!collapsed && <span>สต็อก</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        openStock ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>

                {openStock && !collapsed && (
                  <div className="ml-4 pl-3 border-l border-slate-200 mt-1 space-y-0.5">
                    {canSee('STOCK_OVERVIEW') && (
                    <Link
                      href="/stock?tab=overview"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isStockActive('overview')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                      <span>ภาพรวมสต็อก</span>
                    </Link>
                    )}

                    {canSee('STOCK_MOVEMENTS') && (
                    <Link
                      href="/stock?tab=movements"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isStockActive('movements')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>รายการเคลื่อนไหวล่าสุด</span>
                    </Link>
                    )}

                    {canSee('STOCK_LOW') && (
                    <Link
                      href="/stock?tab=low-stock"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isStockActive('low-stock')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                      <span>แจ้งเตือนวัสดุใกล้หมด</span>
                    </Link>
                    )}

                    {canSee('STOCK_ISSUES') && (
                    <Link
                      href="/stock?tab=issues"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isStockActive('issues')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                      <span>รายงานความเคลื่อนไหวสินค้า</span>
                    </Link>
                    )}

                    {canSee('STOCK_USAGE') && (
                    <Link
                      href="/stock?tab=material-usage"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isStockActive('material-usage')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>บันทึกการใช้วัสดุ</span>
                    </Link>
                    )}

                    {canSee('STOCK_ALL') && (
                    <Link
                      href="/stock?tab=all-stock"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isStockActive('all-stock')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 shrink-0" />
                      <span>สต็อกทั้งหมด</span>
                    </Link>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* จัดซื้อ / สั่งซื้อ (Accordion) */}
              {canSee('PURCHASING') && (
              <div>
                <button
                  type="button"
                  onClick={() => setOpenPurchasing(!openPurchasing)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                    pathname.startsWith('/pr') || pathname.startsWith('/po') || pathname.startsWith('/receive')
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ShoppingCart className="w-4 h-4 text-slate-600 shrink-0" />
                    {!collapsed && <span>จัดซื้อ / สั่งซื้อ</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        openPurchasing ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>

                {openPurchasing && !collapsed && (
                  <div className="ml-4 pl-3 border-l border-slate-200 mt-1 space-y-0.5">
                    {canSee('PUR_OVERVIEW') && (
                    <Link
                      href="/purchasing"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname === '/purchasing'
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                      <span>ภาพรวมจัดซื้อ</span>
                    </Link>
                    )}
                    {canSee('PUR_PR') && (
                    <Link
                      href="/pr"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/pr') && !pathname.startsWith('/prv')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>ใบขอซื้อ PR</span>
                    </Link>
                    )}
                    {canSee('PUR_PO') && (
                    <Link
                      href="/po"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/po')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>ใบสั่งซื้อ PO</span>
                    </Link>
                    )}
                    {canSee('PUR_APPROVE') && (
                    <Link
                      href="/purchasing/approve"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname === '/purchasing/approve'
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>อนุมัติจัดซื้อ</span>
                    </Link>
                    )}
                    {canSee('PUR_AP') && (
                    <Link
                      href="/purchasing/ap"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname === '/purchasing/ap'
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Receipt className="w-3.5 h-3.5 shrink-0" />
                      <span>ใบ AP</span>
                    </Link>
                    )}
                    {canSee('PUR_VENDORS') && (
                    <Link
                      href="/purchasing/vendors"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname === '/purchasing/vendors' || pathname.startsWith('/master/vendors')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>ซัพพลายเออร์</span>
                    </Link>
                    )}
                    {canSee('PUR_RECEIVE') && (
                    <Link
                      href="/receive"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/receive')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Package className="w-3.5 h-3.5 shrink-0" />
                      <span>รอรับสินค้า</span>
                    </Link>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* ค่าแรง / งวดงาน (Accordion) */}
              {canSee('LABOR') && (
              <div>
                <button
                  type="button"
                  onClick={() => setOpenLabor(!openLabor)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                    pathname.startsWith('/labor-payments') || pathname.startsWith('/prv') || pathname.startsWith('/payables')
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Wrench className="w-4 h-4 text-slate-600 shrink-0" />
                    {!collapsed && <span>ค่าแรง / งวดงาน</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        openLabor ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>

                {openLabor && !collapsed && (
                  <div className="ml-4 pl-3 border-l border-slate-200 mt-1 space-y-0.5">
                    {canSee('LABOR_PAY') && (
                    <Link
                      href="/labor-payments?tab=payment-milestones"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isLaborActive('payment-milestones')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                      <span>แผนงวดงานจ่าย</span>
                    </Link>
                    )}

                    {canSee('LABOR_RECEIVE') && (
                    <Link
                      href="/labor-payments?tab=receive-milestones"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isLaborActive('receive-milestones')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                      <span>แผนงวดงานรับ</span>
                    </Link>
                    )}

                    {canSee('LABOR_REPORT') && (
                    <Link
                      href="/labor-payments?tab=milestones"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isLaborActive('milestones')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>รายงาน</span>
                    </Link>
                    )}

                    {canSee('LABOR_CONTRACTORS') && (
                    <Link
                      href="/labor-payments/contractors"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/labor-payments/contractors')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>ผู้รับเหมาและทีมงาน</span>
                    </Link>
                    )}

                    {canSee('LABOR_PRV') && (
                    <Link
                      href="/prv"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/prv')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>ใบสั่งจ่ายเงิน (PRV)</span>
                    </Link>
                    )}

                    {canSee('LABOR_PAYABLES') && (
                    <Link
                      href="/payables"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/payables')
                          ? 'bg-blue-50 text-[#2453d4] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Receipt className="w-3.5 h-3.5 shrink-0" />
                      <span>คิวตั้งจ่าย</span>
                    </Link>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* บัญชี / การเงิน (Accordion) */}
              {canSee('FINANCE') && (
              <div>
                <button
                  type="button"
                  onClick={() => setOpenFinance(!openFinance)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                    pathname.startsWith('/invoices') ||
                    pathname.startsWith('/pv') ||
                    pathname.startsWith('/exports') ||
                    pathname.startsWith('/assets') ||
                    pathname.startsWith('/ar') ||
                    pathname.startsWith('/advances') ||
                    pathname.startsWith('/receipt-substitutes')
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Receipt className="w-4 h-4 text-slate-600 shrink-0" />
                    {!collapsed && <span>บัญชี / การเงิน</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        openFinance ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>

                {openFinance && !collapsed && (
                  <div className="ml-4 pl-3 border-l border-slate-200 mt-1 space-y-0.5">
                    {AR_LINKS.filter((l) => canSee(l.menu)).map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        prefetch={false}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                          pathname.startsWith(l.href)
                            ? 'bg-blue-50 text-blue-700 font-semibold'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span>{l.label}</span>
                      </Link>
                    ))}
                    {canSee('FIN_AP_INVOICES') && (
                    <Link
                      href="/invoices"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/invoices')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>ใบแจ้งหนี้ผู้ขาย (AP)</span>
                    </Link>
                    )}
                    {canSee('FIN_PV') && (
                    <Link
                      href="/pv"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/pv')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>ใบสำคัญจ่าย (PV)</span>
                    </Link>
                    )}
                    {canSee('FIN_EXPORTS') && (
                    <Link
                      href="/exports"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/exports')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                      <span>รายงาน/50 ทวิ</span>
                    </Link>
                    )}
                    {canSee('FIN_ASSETS') && (
                    <Link
                      href="/assets"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/assets')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>ตรวจเช็คทรัพย์สิน</span>
                    </Link>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* บริการหลังก่อสร้าง (Accordion) */}
              {canSee('AFTER_SERVICE') && (
              <div>
                <button
                  type="button"
                  onClick={() => setOpenAfterService(!openAfterService)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                    pathname.startsWith('/handover') || pathname.startsWith('/warranty')
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-slate-600 shrink-0" />
                    {!collapsed && <span>บริการหลังก่อสร้าง</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        openAfterService ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>

                {openAfterService && !collapsed && (
                  <div className="ml-4 pl-3 border-l border-slate-200 mt-1 space-y-0.5">
                    {canSee('AS_HANDOVER') && (
                    <Link
                      href="/handover"
                      prefetch={false}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>ส่งมอบโครงการ</span>
                    </Link>
                    )}
                    {canSee('AS_WARRANTY') && (
                    <Link
                      href="/warranty"
                      prefetch={false}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>ใบรับประกันผลงาน</span>
                    </Link>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* Master Data & Admin */}
              {canManageUsers && (
              <Link
                href="/master/users"
                prefetch={false}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                  pathname.startsWith('/master/users')
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title="ผู้ใช้งาน"
              >
                <div className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 text-slate-500 shrink-0" />
                  {!collapsed && <span>ผู้ใช้งาน</span>}
                </div>
                {!collapsed && <span className="text-[10px] text-slate-400">Users</span>}
              </Link>
              )}

              {canManageSettings && (
              <Link
                href="/settings"
                prefetch={false}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                  pathname.startsWith('/settings')
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title="ตั้งค่า"
              >
                <div className="flex items-center gap-2.5">
                  <SettingsIcon className="w-4 h-4 text-slate-500 shrink-0" />
                  {!collapsed && <span>ตั้งค่า</span>}
                </div>
                {!collapsed && <span className="text-[10px] text-slate-400">Settings</span>}
              </Link>
              )}

            </div>
          </div>
        </div>

        {/* Bottom Profile in Sidebar (Images 2-5) */}
        <div className="p-3 border-t border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#2453d4] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm">
              {initials}
            </div>
            {!collapsed && (
              <div className="overflow-hidden leading-tight min-w-0">
                <div className="text-xs font-semibold text-slate-800 truncate">{displayName}</div>
                <div className="text-[10px] text-slate-400 truncate">{displayEmail}</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar (Images 2-5) */}
        <header className="h-14 border-b border-slate-200 bg-white px-4 md:px-6 flex items-center justify-between shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Current Project / Organization Indicator */}
            <div className="flex items-center gap-2.5 text-slate-700">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                <Building2 className="w-4 h-4" />
              </div>
              <div className="leading-tight">
                <div className="text-xs font-bold text-slate-900 tracking-tight">{companyName}</div>
                <div className="text-[10px] text-slate-500">{displayName}</div>
              </div>
            </div>
          </div>

          {/* Right Header: Notification, Avatar & Exit */}
          <div className="flex items-center gap-3">
            <Link
              href="/inbox"
              className="relative p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
              title="การแจ้งเตือน"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" />
              )}
            </Link>

            {/* User Avatar Circle */}
            <div className="w-8 h-8 rounded-full bg-emerald-600 ring-2 ring-emerald-100 overflow-hidden flex items-center justify-center text-white text-xs font-semibold shadow-sm">
              <span>{initials}</span>
            </div>

            {/* Logout Exit Button */}
            <form action={logoutAction}>
              <button
                type="submit"
                title="ออกจากระบบ (Sign Out)"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </form>
          </div>
        </header>

        {/* Page Content Body */}
        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}