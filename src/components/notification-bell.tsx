'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type NotificationCategory = 'BOQ' | 'PO' | 'PR' | 'RECEIPT' | 'FINANCE' | 'PROJECT' | 'VEHICLE' | 'GENERAL';
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
  VEHICLE: 'การใช้รถ',
  GENERAL: 'ทั่วไป',
};
const CATEGORY_ORDER: NotificationCategory[] = ['BOQ', 'PO', 'PR', 'RECEIPT', 'FINANCE', 'PROJECT', 'VEHICLE', 'GENERAL'];

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

/** "5 นาทีที่แล้ว" style time, falling back to a Thai date after a week. */
function timeAgo(value: Date | string): string {
  const date = new Date(value);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'เมื่อสักครู่';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} นาทีที่แล้ว`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} ชั่วโมงที่แล้ว`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} วันที่แล้ว`;
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

// Stable default, so a bell without initial items does not look like it got new ones every render
const NO_ITEMS: NotificationItem[] = [];

export function NotificationBell({
  initialItems = NO_ITEMS,
  initialUnread,
  onPoll,
  onMarkAllRead,
  onMarkRead,
  onChanged,
}: {
  initialItems?: NotificationItem[];
  /** Unread count known before the list is loaded (header bell loads the list on first open). */
  initialUnread?: number;
  /** Loads the latest list; called on first open when there are no initial items, and every minute. */
  onPoll?: () => Promise<NotificationItem[]>;
  onMarkAllRead?: () => Promise<void>;
  onMarkRead?: (id: string) => Promise<void>;
  /** Called after something was marked read, e.g. to refresh server-rendered unread counts. */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<NotificationItem[]>(initialItems);
  const [loaded, setLoaded] = useState(initialItems !== NO_ITEMS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotificationCategory | 'ALL'>('ALL');
  const rootRef = useRef<HTMLDivElement>(null);

  // New items from the server replace the local list (adjusting state during render, not in an effect)
  const [shownInitial, setShownInitial] = useState(initialItems);
  if (shownInitial !== initialItems) {
    setShownInitial(initialItems);
    setItems(initialItems);
  }

  const load = useCallback(async () => {
    if (!onPoll) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await onPoll());
      setLoaded(true);
    } catch {
      setError('โหลดการแจ้งเตือนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [onPoll]);

  // Background refresh once the list has been loaded; poll errors are ignored
  useEffect(() => {
    if (!onPoll || !loaded) return;
    const timer = setInterval(async () => {
      try {
        setItems(await onPoll());
      } catch {
        // ignore background poll errors
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [onPoll, loaded]);

  // Close on a click outside or Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void load();
  };

  const unreadCount = loaded ? items.filter((i) => !i.readAt).length : (initialUnread ?? 0);
  const categories = CATEGORY_ORDER.filter((c) => items.some((i) => (i.category ?? 'GENERAL') === c));
  const activeTab = tab !== 'ALL' && !categories.includes(tab) ? 'ALL' : tab;
  const shown = activeTab === 'ALL' ? items : items.filter((i) => (i.category ?? 'GENERAL') === activeTab);
  const unreadIn = (c: NotificationCategory) => items.filter((i) => !i.readAt && (i.category ?? 'GENERAL') === c).length;

  const markAll = async () => {
    if (!onMarkAllRead) return;
    const before = items;
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })));
    try {
      await onMarkAllRead();
      onChanged?.();
    } catch {
      setItems(before);
      setError('ทำเครื่องหมายว่าอ่านแล้วไม่สำเร็จ');
    }
  };

  const openItem = (n: NotificationItem) => {
    setOpen(false);
    if (n.readAt || !onMarkRead) return;
    setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, readAt: new Date() } : i)));
    onMarkRead(n.id)
      .then(() => onChanged?.())
      .catch(() => {
        // Stays read locally; the next poll shows the server's state
      });
  };

  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `การแจ้งเตือน ยังไม่อ่าน ${unreadCount} รายการ` : 'การแจ้งเตือน'}
        title="การแจ้งเตือน"
        className={`relative p-1.5 rounded-lg transition ${
          open ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
        }`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 ring-2 ring-white text-[9px] font-bold leading-4 text-white text-center">
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="การแจ้งเตือน"
          className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg z-50 p-3 space-y-2"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-semibold text-slate-900">การแจ้งเตือนล่าสุด</span>
            {unreadCount > 0 && onMarkAllRead && loaded && (
              <button type="button" onClick={markAll} className="text-[11px] text-blue-600 hover:underline">
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

          {error && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              <span>{error}</span>
              {onPoll && (
                <button type="button" onClick={() => void load()} className="font-semibold hover:underline">
                  ลองใหม่
                </button>
              )}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto space-y-1 text-xs" aria-busy={loading}>
            {loading && !loaded ? (
              <div className="space-y-2 py-1" aria-label="กำลังโหลด">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            ) : shown.length === 0 ? (
              !error && <p className="py-4 text-center text-slate-400">ไม่มีการแจ้งเตือน</p>
            ) : (
              shown.map((n) => {
                const style = LEVEL_STYLES[n.level ?? 'INFO'];
                const badge = levelLabel(n);
                return (
                  <Link
                    key={n.id}
                    href={n.href}
                    prefetch={false}
                    onClick={() => openItem(n)}
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
                      <span className="block text-[10px] font-normal text-slate-400">{timeAgo(n.createdAt)}</span>
                    </span>
                    {style && badge && (
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${style.badge}`}>{badge}</span>
                    )}
                  </Link>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-100 pt-2 text-center">
            <Link href="/inbox" prefetch={false} onClick={() => setOpen(false)} className="text-[11px] font-medium text-blue-600 hover:underline">
              ไปที่กล่องงานของฉัน
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
