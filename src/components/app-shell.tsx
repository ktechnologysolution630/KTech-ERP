'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type SessionUser } from '@/db/schema';
import { logoutAction } from '@/app/login/actions';

const NAV_ITEMS = [
  { href: '/inbox', label: 'กล่องงาน', mobile: true },
  { href: '/dashboard', label: 'ภาพรวมเจ้าของ', roles: ['OWNER', 'FINANCE', 'ADMIN'] },
  { href: '/pr', label: 'ใบขอซื้อ (PR)', mobile: true },
  { href: '/po', label: 'ใบสั่งซื้อ (PO)', mobile: true },
  { href: '/receive', label: 'รับของหน้างาน', mobile: true },
  { href: '/invoices', label: 'ใบแจ้งหนี้/วางบิล', roles: ['FINANCE', 'PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'] },
  { href: '/payables', label: 'คิวตั้งจ่าย', roles: ['FINANCE', 'OWNER', 'ADMIN'] },
  { href: '/pv', label: 'ใบสำคัญจ่าย (PV)', roles: ['FINANCE', 'OWNER', 'ADMIN'], mobile: true },
  { href: '/exports', label: 'รายงาน/50 ทวิ', roles: ['FINANCE', 'OWNER', 'ADMIN'] },
  { href: '/master/projects', label: 'โครงการ', roles: ['PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'] },
  { href: '/master/vendors', label: 'ผู้ขาย/ร้านค้า', roles: ['PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'] },
  { href: '/master/items', label: 'สินค้า/วัสดุ', roles: ['PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'] },
  { href: '/master/users', label: 'ผู้ใช้งาน', roles: ['OWNER', 'ADMIN'] },
  { href: '/settings', label: 'ตั้งค่าบริษัท', roles: ['OWNER', 'ADMIN'] },
];

export function AppShell({
  user,
  unreadCount = 0,
  children,
}: {
  user: SessionUser;
  unreadCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.some((r) => user.roles.includes(r as never)),
  );
  const mobileItems = visibleItems.filter((i) => i.mobile).slice(0, 5);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50">
      <aside className="hidden md:flex md:w-60 md:flex-col border-r border-slate-200 bg-white">
        <div className="p-4 border-b border-slate-200">
          <Link href="/inbox" className="text-lg font-bold text-slate-900">
            K Tec ERP
          </Link>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{user.name}</p>
          <p className="text-[11px] text-blue-700 font-medium mt-0.5">
            {user.roles.join(', ')}
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200">
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              ออกจากระบบ
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/inbox" className="md:hidden font-bold text-slate-900 text-base">
              K Tec ERP
            </Link>
            <span className="hidden md:inline text-sm text-slate-600">
              สวัสดี, <strong className="text-slate-900">{user.name}</strong>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/inbox"
              className="relative inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              แจ้งเตือน
              {unreadCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </Link>
            <form action={logoutAction} className="md:hidden">
              <button
                type="submit"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600"
              >
                ออก
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto">{children}</main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-slate-200 bg-white">
        {mobileItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 py-3 text-center text-xs font-medium ${
                active ? 'text-blue-600 border-t-2 border-blue-600' : 'text-slate-600'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
