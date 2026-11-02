'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export interface NotificationItem {
  id: string;
  title: string;
  href: string;
  readAt: Date | string | null;
  createdAt: Date | string;
}

export function NotificationBell({
  initialItems = [],
  onPoll,
  onMarkAllRead,
}: {
  initialItems?: NotificationItem[];
  onPoll?: () => Promise<NotificationItem[]>;
  onMarkAllRead?: () => Promise<void>;
}) {
  const [items, setItems] = useState<NotificationItem[]>(initialItems);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

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
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg z-40 p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-semibold text-slate-900">
              การแจ้งเตือนล่าสุด
            </span>
            {unreadCount > 0 && onMarkAllRead && (
              <button
                type="button"
                onClick={async () => {
                  await onMarkAllRead();
                  setItems((prev) =>
                    prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })),
                  );
                }}
                className="text-[11px] text-blue-600 hover:underline"
              >
                ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
            {items.length === 0 ? (
              <p className="py-4 text-center text-slate-400">ไม่มีการแจ้งเตือน</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={`block py-2 px-2 rounded hover:bg-slate-50 ${
                    !n.readAt ? 'bg-blue-50/50 font-semibold text-slate-900' : 'text-slate-600'
                  }`}
                >
                  {n.title}
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
