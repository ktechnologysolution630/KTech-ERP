'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { BoqOverrunRequestDto, PoBoqCheck } from '@/server/services/boq-overrun';
import { decideBoqOverrunAction, requestBoqOverrunAction, type ApActionResult } from '@/app/(app)/po/ap-actions';

const baht = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABEL: Record<BoqOverrunRequestDto['status'], string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

const STATUS_BADGE: Record<BoqOverrunRequestDto['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};

export function useApSubmit() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submit = (fn: () => Promise<ApActionResult>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onOk?.();
      router.refresh();
    });
  };
  return { isPending, error, submit };
}

/** Owner's approve / reject buttons for one pending AP. */
export function ApDecisionButtons({ request }: { request: BoqOverrunRequestDto }) {
  const { isPending, error, submit } = useApSubmit();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm(`อนุมัติ ${request.number} ซื้อเกิน BOQ ${baht(request.overAmount)} บาท?`)) {
            submit(() => decideBoqOverrunAction(request.poId, request.id, true, ''));
          }
        }}
        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
      >
        อนุมัติ
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          const note = prompt(`เหตุผลที่ไม่อนุมัติ ${request.number}`);
          if (note !== null) submit(() => decideBoqOverrunAction(request.poId, request.id, false, note));
        }}
        className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium disabled:opacity-50"
      >
        ไม่อนุมัติ
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}

/** PO detail: shows whether the PO buys beyond its project's BOQ and the AP that covers it. */
export function BoqOverrunPanel({ poId, check }: { poId: string; check: PoBoqCheck }) {
  const { isPending, error, submit } = useApSubmit();
  const [reason, setReason] = useState('');

  if (check.overAmount <= 0 && check.requests.length === 0) return null;

  return (
    <section
      className={`rounded-xl border p-4 space-y-3 text-xs ${
        check.covered ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-300 bg-amber-50'
      }`}
    >
      <div className="flex items-start gap-2">
        {check.covered ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        )}
        <div>
          <h2 className="font-bold text-slate-900 text-sm">
            {check.overAmount > 0 ? `ซื้อเกิน BOQ ${baht(check.overAmount)} บาท` : 'ไม่เกิน BOQ'}
          </h2>
          <p className="text-slate-600">
            {check.overAmount <= 0
              ? 'ยอดปัจจุบันอยู่ในงบวัสดุของ BOQ'
              : check.covered
                ? 'มีใบ AP ที่อนุมัติแล้วครอบคลุมยอดนี้ อนุมัติใบสั่งซื้อได้'
                : 'ต้องได้รับอนุมัติใบ AP (ขออนุมัติซื้อเกิน BOQ) จากเจ้าของก่อน จึงจะอนุมัติใบสั่งซื้อนี้ได้'}
          </p>
        </div>
      </div>

      {check.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[620px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">รายการ BOQ</th>
                <th className="px-3 py-2 text-right">งบวัสดุ</th>
                <th className="px-3 py-2 text-right">PO อื่นใช้ไปแล้ว</th>
                <th className="px-3 py-2 text-right">PO นี้</th>
                <th className="px-3 py-2 text-right">เกิน BOQ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {check.lines.map((l) => (
                <tr key={l.boqLineId}>
                  <td className="px-3 py-2">
                    <span className="font-mono text-slate-400 mr-1">{l.boqNo}</span>
                    {l.description}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{baht(l.budget)}</td>
                  <td className="px-3 py-2 text-right font-mono">{baht(l.committedElsewhere)}</td>
                  <td className="px-3 py-2 text-right font-mono">{baht(l.thisPo)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-red-600">{baht(l.over)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1.5 text-[11px] text-slate-400">ยอดก่อน VAT · นับเฉพาะรายการที่ผูกกับ BOQ</p>
        </div>
      )}

      {check.canRequest && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => requestBoqOverrunAction(poId, reason), () => setReason(''));
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <label htmlFor="ap-reason" className="sr-only">
            เหตุผลที่ต้องซื้อเกิน BOQ
          </label>
          <input
            id="ap-reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เหตุผลที่ต้องซื้อเกิน BOQ เช่น ราคาวัสดุปรับขึ้น / ปริมาณหน้างานเพิ่ม"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
          <button
            type="submit"
            disabled={isPending || reason.trim() === ''}
            className="px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white font-semibold disabled:opacity-50"
          >
            {isPending ? 'กำลังส่ง...' : 'ขออนุมัติซื้อเกิน BOQ (ใบ AP)'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-red-600 font-medium">
          {error}
        </p>
      )}

      {check.requests.length > 0 && (
        <ul className="space-y-2">
          {check.requests.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold text-slate-800">{r.number}</span>
                <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${STATUS_BADGE[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
                <span className="text-slate-500">ฉบับที่ {r.poRevision}</span>
                <span className="ml-auto font-mono font-semibold">{baht(r.overAmount)} บาท</span>
              </div>
              <p className="text-slate-600">
                เหตุผล: {r.reason} · ผู้ขอ {r.requestedByName}
                {r.decidedByName && ` · ผู้พิจารณา ${r.decidedByName}`}
                {r.decisionNote && ` (${r.decisionNote})`}
              </p>
              {check.canDecide && r.status === 'PENDING' && <ApDecisionButtons request={r} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
