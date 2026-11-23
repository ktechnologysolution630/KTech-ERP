'use client';

import React, { Suspense, use, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LOGO_URL, shortCompanyName } from '@/domain/brand';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  Menu,
  X,
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  BarChart2,
  ClipboardCheck,
  ClipboardList,
  Layers,
  PenLine,
  Hash,
  FileCog,
  BookOpen,
  Ruler,
} from 'lucide-react';
import type { SessionUser } from '@/db/schema';
import { isMenuVisible, type MenuKey } from '@/domain/menu';
import { logoutAction } from '@/app/login/actions';
import { ViewOnlyNotice } from '@/components/view-only-notice';
import { KeepServerAwake } from '@/components/keep-server-awake';
import {
  listMyNotificationsAction,
  markAllMyNotificationsReadAction,
  markMyNotificationReadAction,
} from '@/app/(app)/notification-actions';
import { NotificationBell } from './notification-bell';
import { FinanceNav, isFinancePath } from './finance-nav';
import { PageTransition, useShellMotion } from './motion';

interface AppShellProps {
  user: SessionUser;
  unreadCount?: number;
  /** From Settings; shown in the top bar */
  companyName: string;
  /** English company name from the form letterhead settings, shown as the sidebar brand */
  companyNameEn: string;
  /** The company logo from settings, else the shipped one */
  logoUrl: string;
  /**
   * Documents waiting on this user, still being counted when the page is sent so the page does not wait
   * for it; null hides the menu from users who approve nothing
   */
  pendingApprovalCount?: Promise<number> | null;
  canManageUsers?: boolean;
  canManageSettings?: boolean;
  children: React.ReactNode;
}

/** The number on the K Tec Approve menu, shown once the server has counted it */
function PendingBadge({ count }: { count: Promise<number> }) {
  const n = use(count);
  return n > 0 ? <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">{n}</span> : null;
}

export function AppShell({ user, unreadCount = 0, companyName, companyNameEn, logoUrl, pendingApprovalCount = null, canManageUsers = false, canManageSettings = false, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'overview';

  useShellMotion();
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
    isFinancePath(pathname),
  );
  const [openAfterService, setOpenAfterService] = useState<boolean>(
    pathname.startsWith('/handover') || pathname.startsWith('/warranty'),
  );

  const isSettingsSection =
    pathname.startsWith('/settings') || pathname.startsWith('/master/users') || pathname.startsWith('/profile');
  const [openSettings, setOpenSettings] = useState<boolean>(isSettingsSection);

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
    <div className="min-h-screen flex bg-slate-50 text-slate-800 font-sans antialiased">
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed md:sticky top-0 z-50 h-screen apple-glass border-r border-black/[0.06] flex flex-col transition-[width,transform] duration-300 ease-out ${
          collapsed ? 'md:w-16' : 'w-64'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Brand / Logo Header */}
        <div className={`h-14 border-b border-black/[0.05] flex items-center justify-between shrink-0 ${collapsed ? 'px-1.5 gap-0.5' : 'px-3.5 gap-2'}`}>
          <Link href={canSee('DASHBOARD') ? '/dashboard' : '/inbox'} prefetch={false} className="flex items-center gap-2.5 overflow-hidden min-w-0">
            {logoUrl === LOGO_URL ? (
              <Image src={LOGO_URL} alt={companyNameEn} width={36} height={33} priority className={`${collapsed ? 'h-7' : 'h-9'} w-auto shrink-0 object-contain`} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a logo set in settings can be any URL
              <img src={logoUrl} alt={companyNameEn} className={`${collapsed ? 'h-7 w-7' : 'h-9 w-9'} shrink-0 object-contain`} />
            )}
            {!collapsed && (
              <span
                className="min-w-0 line-clamp-2 font-bold text-brand text-[11px] leading-[14px] tracking-tight uppercase"
                title={`${companyNameEn} · ${companyName}`}
              >
                {shortCompanyName(companyNameEn)}
              </span>
            )}
          </Link>

          {/* Collapse Button */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className={`hidden md:flex items-center justify-center shrink-0 ${collapsed ? 'w-5' : 'w-6'} h-6 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition`}
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
                  {!collapsed && (
                    <Suspense fallback={null}>
                      <PendingBadge count={pendingApprovalCount} />
                    </Suspense>
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
                    ? 'bg-blue-50 text-brand font-semibold border-l-2 border-brand'
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
                    ? 'bg-blue-50 text-brand font-semibold'
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

              {/* ถอดแบบ BOQ จากไฟล์ PDF ของแบบ CAD */}
              {canSee('BOQ_TAKEOFF') && (
              <Link
                href="/boq-takeoff"
                prefetch={false}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                  pathname.startsWith('/boq-takeoff')
                    ? 'bg-blue-50 text-brand font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title="ถอดแบบ BOQ จาก PDF"
              >
                <div className="flex items-center gap-2.5">
                  <Ruler className="w-4 h-4 text-slate-500 shrink-0" />
                  {!collapsed && <span>ถอดแบบ BOQ (PDF)</span>}
                </div>
                {!collapsed && <span className="text-[10px] text-slate-400">Take-off</span>}
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 shrink-0" />
                      <span>สต็อกทั้งหมด</span>
                    </Link>
                    )}

                    {canSee('STOCK_COUNT') && (
                    <Link
                      href="/stock?tab=stock-count"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isStockActive('stock-count')
                          ? 'bg-blue-50 text-brand font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>นับสต็อก</span>
                    </Link>
                    )}

                    {canSee('STOCK_ADJUST') && (
                    <Link
                      href="/stock?tab=stock-adjust"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        isStockActive('stock-adjust') || isStockActive('document-history')
                          ? 'bg-blue-50 text-brand font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                      <span>ปรับปรุงยอดสต็อก</span>
                    </Link>
                    )}

                    {canSee('STOCK_CARD') && (
                    <Link
                      href="/stock/card"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname === '/stock/card'
                          ? 'bg-blue-50 text-brand font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                      <span>สมุดคุมสต็อก (Stock Card)</span>
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
                    {canSee('PUR_PROJECT_REPORT') && (
                    <Link
                      href="/purchasing/project-report"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname === '/purchasing/project-report'
                          ? 'bg-blue-50 text-brand font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                      <span>รายงานสรุปการจัดซื้อประจำโครงการ</span>
                    </Link>
                    )}
                    {canSee('PUR_OVERVIEW') && (
                    <Link
                      href="/purchasing"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname === '/purchasing'
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>ซัพพลายเออร์</span>
                    </Link>
                    )}
                    {canSee('PUR_ITEMS') && (
                    <Link
                      href="/purchasing/items"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/purchasing/items') || pathname.startsWith('/master/items')
                          ? 'bg-blue-50 text-brand font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Package className="w-3.5 h-3.5 shrink-0" />
                      <span>ทะเบียนสินค้า</span>
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                          ? 'bg-blue-50 text-brand font-semibold'
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
                    isFinancePath(pathname)
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
                    <FinanceNav pathname={pathname} canSee={canSee} />
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

              {/* Settings: company settings, users, doc numbers, forms and profile in one group.
                  Everyone sees the group, because everyone has a profile (their signature). */}
              <div>
                <button
                  type="button"
                  onClick={() => (collapsed ? setCollapsed(false) : setOpenSettings(!openSettings))}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg font-medium transition ${
                    isSettingsSection
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                  title="ตั้งค่า"
                >
                  <div className="flex items-center gap-2.5">
                    <SettingsIcon className="w-4 h-4 text-slate-600 shrink-0" />
                    {!collapsed && <span>ตั้งค่า</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        openSettings ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>

                {openSettings && !collapsed && (
                  <div className="ml-4 pl-3 border-l border-slate-200 mt-1 space-y-0.5">
                    {canManageSettings && (
                    <Link
                      href="/settings"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname === '/settings'
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <SettingsIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>ตั้งค่าบริษัท</span>
                    </Link>
                    )}
                    {canManageUsers && (
                    <Link
                      href="/master/users"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/master/users')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>ผู้ใช้งาน</span>
                    </Link>
                    )}
                    {canManageSettings && (
                    <Link
                      href="/settings/doc-numbers"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/settings/doc-numbers')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Hash className="w-3.5 h-3.5 shrink-0" />
                      <span>เลขที่เอกสาร</span>
                    </Link>
                    )}
                    {canManageSettings && (
                    <Link
                      href="/settings/forms"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/settings/forms')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <FileCog className="w-3.5 h-3.5 shrink-0" />
                      <span>แบบฟอร์มเอกสาร</span>
                    </Link>
                    )}
                    <Link
                      href="/settings/guide"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/settings/guide')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <BookOpen className="w-3.5 h-3.5 shrink-0" />
                      <span>คู่มือการใช้งาน</span>
                    </Link>
                    <Link
                      href="/profile"
                      prefetch={false}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11.5px] transition ${
                        pathname.startsWith('/profile')
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <PenLine className="w-3.5 h-3.5 shrink-0" />
                      <span>โปรไฟล์ / ลายเซ็น</span>
                    </Link>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Bottom Profile in Sidebar (Images 2-5) */}
        <div className="p-3 border-t border-black/[0.05] shrink-0">
          <Link href="/profile" prefetch={false} title="โปรไฟล์ / ลายเซ็น" className="flex items-center gap-2.5 rounded-lg hover:bg-slate-50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-b from-blue-400 to-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm">
              {initials}
            </div>
            {!collapsed && (
              <div className="overflow-hidden leading-tight min-w-0">
                <div className="text-xs font-semibold text-slate-800 truncate">{displayName}</div>
                <div className="text-[10px] text-slate-400 truncate">{displayEmail}</div>
              </div>
            )}
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar (Images 2-5) */}
        <header className="h-14 border-b border-black/[0.06] apple-glass px-4 md:px-6 flex items-center justify-between shrink-0 sticky top-0 z-30">
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
            <NotificationBell
              initialUnread={unreadCount}
              onPoll={listMyNotificationsAction}
              onMarkRead={markMyNotificationReadAction}
              onMarkAllRead={markAllMyNotificationsReadAction}
              onChanged={router.refresh}
            />

            {/* User Avatar Circle */}
            <Link href="/profile" prefetch={false} title="โปรไฟล์ / ลายเซ็น" className="w-8 h-8 rounded-full bg-gradient-to-b from-slate-400 to-slate-600 ring-2 ring-white overflow-hidden flex items-center justify-center text-white text-xs font-semibold shadow-sm">
              <span>{initials}</span>
            </Link>

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

        <ViewOnlyNotice />
        <KeepServerAwake />

        {/* Page Content Body */}
        <main className="flex-1 p-4 md:p-6 xl:p-8 overflow-x-hidden">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}