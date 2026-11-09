'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export type NotificationCategory = 'BOQ' | 'PO' | 'PR' | 'RECEIPT' | 'FINANCE' | 'PROJECT' | 'GENERAL';
export type NotificationLevel = 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL' | 'OVER';

export interface NotificationItem {
  id: string;
  title: string;
  href: string;
  category?: NotificationCategory;
  level?: NotificationLevel;
  readAt: Date | string | null;
  createdAt: Date | string;
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  BOQ: 'งบ BOQ',
  PO: 'ใบสั่งซื้อ',
  PR: 'ใบขอซื้อ',
  RECEIPT: 'รับของ/สต็อก',
  FINANCE: 'การเงิน',
  PROJECT: 'โครงการ',
  GENERAL: 'ทั่วไป',
};
const CATEGORY_ORDER: NotificationCategory[] = ['BOQ', 'PO', 'PR', 'RECEIPT', 'FINANCE', 'PROJECT', 'GENERAL'];

/** Left stripe and badge per severity; BOQ usage alerts use 50% / 80% / 100% / เกิน. */
const LEVEL_STYLES: Record<NotificationLevel, { stripe: string; badge: string; label: string } | null> = {
  INFO: null,
  NOTICE: { stripe: 'border-l-yellow-400', badge: 'bg-yellow-100 text-yellow-800', label: '50%' },
  WARNING: { stripe: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-800', label: '80%' },
  CRITICAL: { stripe: 'border-l-red-500', badge: 'bg-red-100 text-red-700', label: '100%' },
  OVER: { stripe: 'border-l-red-800', badge: 'bg-red-800 text-white', label: 'เกิน' },
};

/** Badge text: BOQ alerts show the threshold, other categories a generic word. */
function levelLabel(n: NotificationItem): string | null {
  const style = LEVEL_STYLES[n.level ?? 'INFO'];
  if (!style) return null;
  if (n.category === 'BOQ') return style.label;
  return n.level === 'OVER' || n.level === 'CRITICAL' ? 'ด่วน' : n.level === 'WARNING' ? 'สำคัญ' : 'แจ้ง';
}

// Stable default, so a bell without initial items does not look like it got new ones every render
const NO_ITEMS: NotificationItem[] = [];

export function NotificationBell({
  initialItems = NO_ITEMS,
  onPoll,
  onMarkAllRead,
}: {
  initialItems?: NotificationItem[];
  onPoll?: () => Promise<NotificationItem[]>;
  onMarkAllRead?: () => Promise<void>;
}) {
  const [items, setItems] = useState<NotificationItem[]>(initialItems);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotificationCategory | 'ALL'>('ALL');

  // New items from the server replace the local list (adjusting state during render, not in an effect)
  const [shownInitial, setShownInitial] = useState(initialItems);
  if (shownInitial !== initialItems) {
    setShownInitial(initialItems);
    setItems(initialItems);
  }

  useEffect(() => {
    if (!onPoll) return;
    const timer = setInterval(async () => {
      try {
        const latest = await onPoll();
        setItems(latest);
      } catch {
        // ignore background poll errors
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [onPoll]);

  const unreadCount = items.filter((i) => !i.readAt).length;
  const categories = CATEGORY_ORDER.filter((c) => items.some((i) => (i.category ?? 'GENERAL') === c));
  const activeTab = tab !== 'ALL' && !categories.includes(tab) ? 'ALL' : tab;
  const shown = activeTab === 'ALL' ? items : items.filter((i) => (i.category ?? 'GENERAL') === activeTab);
  const unreadIn = (c: NotificationCategory) => items.filter((i) => !i.readAt && (i.category ?? 'GENERAL') === c).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        แจ้งเตือน
        {unreadCount > 0 && (
          <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg z-40 p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-semibold text-slate-900">การแจ้งเตือนล่าสุด</span>
            {unreadCount > 0 && onMarkAllRead && (
              <button
                type="button"
                onClick={async () => {
                  await onMarkAllRead();
                  setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })));
                }}
                className="text-[11px] text-blue-600 hover:underline"
              >
                ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
              </button>
            )}
          </div>

          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {(['ALL', ...categories] as const).map((c) => {
                const count = c === 'ALL' ? unreadCount : unreadIn(c);
                const active = activeTab === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTab(c)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {c === 'ALL' ? 'ทั้งหมด' : CATEGORY_LABELS[c]}
                    {count > 0 && <span className={`ml-1 ${active ? 'text-red-300' : 'text-red-600'}`}>{count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto space-y-1 text-xs">
            {shown.length === 0 ? (
              <p className="py-4 text-center text-slate-400">ไม่มีการแจ้งเตือน</p>
            ) : (
              shown.map((n) => {
                const style = LEVEL_STYLES[n.level ?? 'INFO'];
                const badge = levelLabel(n);
                return (
                  <Link
                    key={n.id}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-2 rounded border-l-4 py-2 px-2 hover:bg-slate-50 ${
                      style ? style.stripe : 'border-l-transparent'
                    } ${!n.readAt ? 'bg-blue-50/50 font-semibold text-slate-900' : 'text-slate-600'}`}
                  >
                    <span className="min-w-0 flex-1">
                      {activeTab === 'ALL' && (
                        <span className="block text-[10px] font-normal text-slate-400">
                          {CATEGORY_LABELS[n.category ?? 'GENERAL']}
                        </span>
                      )}
                      {n.title}
                    </span>
                    {style && badge && (
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${style.badge}`}>{badge}</span>
                    )}
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
