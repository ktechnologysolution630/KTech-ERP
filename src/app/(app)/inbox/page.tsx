import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { getInbox } from '@/server/services/inbox';
import {
  listNotifications,
  markAllRead,
} from '@/server/services/notifications';
import { formatMoneyDisplay } from '@/components/money-input';
import { NotificationBell } from '@/components/notification-bell';

export default async function InboxPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [groups, notifications] = await Promise.all([
    getInbox(db, actor),
    listNotifications(db, actor),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            กล่องงานของฉัน (Action Inbox)
          </h1>
          <p className="text-xs text-slate-600">
            รายการงานที่รอการอนุมัติ สั่งซื้อ รับของ หรือทำจ่ายตามบทบาทของคุณ
          </p>
        </div>

        <NotificationBell
          initialItems={notifications}
          onPoll={async () => {
            'use server';
            const u = await requireUser();
            const d = await getDb();
            return listNotifications(d, u);
          }}
          onMarkAllRead={async () => {
            'use server';
            const u = await requireUser();
            const d = await getDb();
            await markAllRead(d, u);
          }}
        />
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          ไม่มีงานค้างดำเนินการในขณะนี้
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((g) => (
            <div
              key={g.key}
              className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h2 className="text-sm font-semibold text-slate-900">{g.label}</h2>
                <span className="rounded-full bg-blue-100 text-blue-800 px-2.5 py-0.5 text-xs font-bold">
                  {g.count}
                </span>
              </div>
              <ul className="divide-y divide-slate-100 text-xs">
                {g.items.map((item) => (
                  <li key={item.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={item.href}
                        className="font-semibold text-blue-600 hover:underline"
                      >
                        {item.number}
                      </Link>
                      <span className="text-slate-700 ml-1.5">{item.title}</span>
                    </div>
                    <div className="text-right shrink-0">
                      {item.amount && (
                        <div className="font-semibold text-slate-900">
                          ฿{formatMoneyDisplay(item.amount)}
                        </div>
                      )}
                      {item.date && (
                        <div className="text-[11px] text-slate-400">{item.date}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
