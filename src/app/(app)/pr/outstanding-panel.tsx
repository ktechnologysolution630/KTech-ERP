'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BellRing, ChevronDown, ChevronRight } from 'lucide-react';
import { formatQty, type OutstandingPrLine } from '@/domain/pr-outstanding';

/** Where a line stands, in the order a person would chase it */
function stage(o: OutstandingPrLine): { label: string; tone: string } {
  if (o.receivedQty > 0) return { label: 'รับบางส่วน', tone: 'bg-amber-100 text-amber-800' };
  if (o.orderedQty > 0) return { label: 'สั่งซื้อแล้ว รอของ', tone: 'bg-blue-50 text-blue-700' };
  if (o.prStatus === 'SUBMITTED') return { label: 'รออนุมัติ PR', tone: 'bg-slate-100 text-slate-600' };
  return { label: 'ยังไม่ได้ออก PO', tone: 'bg-slate-100 text-slate-600' };
}

/** แจ้งเตือนของค้างรับ: how many requested lines have not arrived in full, and on which PRs */
export function OutstandingPanel({ outstanding }: { outstanding: OutstandingPrLine[] }) {
  const [open, setOpen] = useState(false);
  if (outstanding.length === 0) return null;
  const prNumbers = [...new Map(outstanding.map((o) => [o.prId, o.prNumber])).entries()];
  const partial = outstanding.filter((o) => o.receivedQty > 0).length;

  return (
    <section aria-label="รายการที่ยังได้รับไม่ครบ" className="rounded-xl border border-amber-300 bg-amber-50 text-amber-950">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 text-xs">
          <p className="text-sm font-semibold">
            มี {outstanding.length} รายการที่ยังได้รับไม่ครบ จาก {prNumbers.length} ใบขอซื้อ
            {partial > 0 && <span className="font-normal"> (รับมาแล้วบางส่วน {partial} รายการ)</span>}
          </p>
          <p className="mt-1 leading-relaxed">
            เลขที่:{' '}
            {prNumbers.map(([id, number], i) => (
              <span key={id}>
                {i > 0 && ', '}
                <Link href={`/pr/${id}`} className="font-semibold underline">
                  {number}
                </Link>
              </span>
            ))}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {open ? 'ซ่อนรายการ' : 'ดูรายการค้างรับ'}
        </button>
      </div>
      {open && (
        <div className="overflow-x-auto border-t border-amber-200 bg-white">
          <table className="w-full min-w-[820px] text-xs text-slate-700">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">เลขที่ PR</th>
                <th className="px-4 py-2 text-left font-medium">โครงการ</th>
                <th className="px-4 py-2 text-left font-medium">รายการ</th>
                <th className="px-4 py-2 text-right font-medium">ขอซื้อ</th>
                <th className="px-4 py-2 text-right font-medium">สั่งซื้อแล้ว</th>
                <th className="px-4 py-2 text-right font-medium">รับแล้ว</th>
                <th className="px-4 py-2 text-right font-medium">ค้างรับ</th>
                <th className="px-4 py-2 text-left font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {outstanding.map((o) => {
                const s = stage(o);
                return (
                  <tr key={o.prLineId} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono">
                      <Link href={`/pr/${o.prId}`} className="font-semibold text-[#2453d4] hover:underline">
                        {o.prNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{o.projectCode}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{o.description}</td>
                    <td className="px-4 py-2 text-right">
                      {formatQty(o.qty)} {o.unitName}
                    </td>
                    <td className="px-4 py-2 text-right">{formatQty(o.orderedQty)}</td>
                    <td className="px-4 py-2 text-right">{formatQty(o.receivedQty)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-800">
                      {formatQty(o.outstandingQty)} {o.unitName}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${s.tone}`}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
