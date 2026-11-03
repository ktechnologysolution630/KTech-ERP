'use client';

import React, { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, ExternalLink, Megaphone, Pin, Plus, Trash2, X } from 'lucide-react';
import type { NewsItem } from '@/server/services/news';
import { createNewsAction, deleteNewsAction } from './actions';

const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-blue-600 focus:outline-none';
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thaiDate = (iso: string) => {
  const d = new Date(iso);
  const bkk = new Date(d.getTime() + 7 * 3600_000);
  return `${bkk.getUTCDate()} ${TH_MONTHS[bkk.getUTCMonth()]} ${bkk.getUTCFullYear() + 543}`;
};

function NewsVisual({ item, className }: { item: NewsItem; className: string }) {
  if (item.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.imageUrl} alt="" className={`${className} object-cover`} />;
  }
  // No image: a branded navy/gold card with the headline
  return (
    <div className={`${className} relative overflow-hidden bg-gradient-to-br from-[#0b1430] via-[#13224a] to-[#1d3170] p-5 flex flex-col justify-end`}>
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-[#d4b26a]/20 blur-2xl" />
      <Megaphone className="absolute right-5 top-5 w-8 h-8 text-[#d4b26a]/70" />
      <div className="relative text-white font-bold text-lg leading-snug line-clamp-3">{item.title}</div>
      <div className="relative mt-2 h-0.5 w-12 bg-[#d4b26a]" />
    </div>
  );
}

function NewsDialog({ item, canManage, onClose }: { item: NewsItem; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const external = /^https?:\/\//i.test(item.linkUrl);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <NewsVisual item={item} className="w-full h-56 sm:h-72 rounded-t-2xl" />
          <button type="button" onClick={onClose} aria-label="ปิด" className="absolute right-3 top-3 p-1.5 rounded-full bg-black/40 text-white hover:bg-black/60">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-3">
          <div className="text-[11px] text-slate-400">
            {thaiDate(item.createdAt)} · {item.authorName}
            {item.pinned && <span className="ml-2 inline-flex items-center gap-0.5 text-amber-600"><Pin className="w-3 h-3" /> ปักหมุด</span>}
          </div>
          <h2 className="text-lg font-bold text-slate-900">{item.title}</h2>
          {item.body && <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{item.body}</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex items-center justify-between pt-2">
            {item.linkUrl ? (
              external ? (
                <a href={item.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[#2453d4] hover:underline">
                  อ่านเพิ่มเติม <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <Link href={item.linkUrl} className="text-sm font-semibold text-[#2453d4] hover:underline">
                  อ่านเพิ่มเติม →
                </Link>
              )
            ) : (
              <span />
            )}
            {canManage && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (!confirm('ลบข่าวนี้?')) return;
                  startTransition(async () => {
                    const r = await deleteNewsAction(item.id);
                    if (!r.ok) return setError(r.error);
                    onClose();
                    router.refresh();
                  });
                }}
                className="inline-flex items-center gap-1 text-sm text-rose-600 hover:underline disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" /> ลบข่าว
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewNewsDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          startTransition(async () => {
            const r = await createNewsAction(data);
            if (!r.ok) return setError(r.error);
            onClose();
            router.refresh();
          });
        }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">เพิ่มข่าวสาร / ประกาศ</h2>
          <button type="button" onClick={onClose} aria-label="ปิด" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4 text-sm">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">หัวข้อ *</span>
            <input name="title" required maxLength={200} className={field} placeholder="เช่น ประกาศวันหยุดบริษัท" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">รายละเอียด</span>
            <textarea name="body" rows={5} maxLength={5000} className={field} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">รูปประกอบ (ไม่บังคับ · JPG/PNG/WebP ไม่เกิน 4 MB)</span>
            <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-700" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">ลิงก์อ่านเพิ่มเติม (ไม่บังคับ)</span>
            <input name="linkUrl" maxLength={500} className={field} placeholder="/projects หรือ https://…" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input name="pinned" type="checkbox" className="rounded border-slate-300" /> ปักหมุดไว้ด้านหน้า
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="submit" disabled={isPending} className="px-5 py-2 rounded-lg bg-[#2453d4] text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
            {isPending ? 'กำลังเผยแพร่…' : 'เผยแพร่'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function NewsSection({ items, canManage }: { items: NewsItem[]; canManage: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<NewsItem | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#0b1430] to-[#1d3170] px-3.5 py-2 text-white text-sm font-semibold">
          <Megaphone className="w-4 h-4 text-[#d4b26a]" /> ข่าวสาร / อัปเดตล่าสุด
        </div>
        <div className="flex items-center gap-3">
          {canManage && (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#2453d4] hover:underline">
              <Plus className="w-3.5 h-3.5" /> เพิ่มข่าว
            </button>
          )}
          <button type="button" onClick={() => setCollapsed(!collapsed)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            {collapsed ? 'ขยาย' : 'ย่อ'} {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!collapsed &&
        (items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
            ยังไม่มีข่าวสาร{canManage ? ' — กด "เพิ่มข่าว" เพื่อประกาศถึงทุกคนในบริษัท' : ''}
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x scrollbar-thin">
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setOpen(n)}
                className="snap-start shrink-0 w-[300px] sm:w-[360px] text-left rounded-xl overflow-hidden border border-slate-200 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition bg-white"
              >
                <NewsVisual item={n} className="w-full h-44" />
                <div className="p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    {n.pinned && <Pin className="w-3 h-3 text-amber-500" />}
                    {thaiDate(n.createdAt)}
                  </div>
                  <div className="text-sm font-semibold text-slate-900 line-clamp-1">{n.title}</div>
                  {n.body && <div className="text-xs text-slate-500 line-clamp-2">{n.body}</div>}
                </div>
              </button>
            ))}
          </div>
        ))}

      {open && <NewsDialog item={open} canManage={canManage} onClose={() => setOpen(null)} />}
      {adding && <NewNewsDialog onClose={() => setAdding(false)} />}
    </section>
  );
}
