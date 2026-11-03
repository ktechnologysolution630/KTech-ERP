'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Printer, XCircle } from 'lucide-react';
import type { PrvTransition } from '@/server/services/prv';
import { transitionPrvAction } from '../actions';

export function PrvActions({
  id,
  vendorId,
  allowed,
}: {
  id: string;
  vendorId: string | null;
  allowed: { submit: boolean; verify: boolean; approve: boolean; pay: boolean };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: PrvTransition, confirmText: string) => {
    let note = '';
    if (action === 'reject') {
      const reason = prompt('เหตุผลที่ไม่อนุมัติ');
      if (reason === null) return;
      note = reason;
    } else if (!confirm(confirmText)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await transitionPrvAction(id, action, note);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  const btn = 'inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg font-semibold text-xs transition disabled:opacity-50';
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => window.print()} className={`${btn} border border-slate-200 bg-white hover:bg-slate-50 text-slate-700`}>
          <Printer className="h-3.5 w-3.5" />
          พิมพ์ Payment Certificate (A4)
        </button>
        {allowed.submit && (
          <button type="button" disabled={isPending} onClick={() => run('submit', 'ส่งใบขอเบิกให้ PM ตรวจรับรอง?')} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
            ส่งขอเบิกเงิน
          </button>
        )}
        {allowed.verify && (
          <>
            <button type="button" disabled={isPending} onClick={() => run('verify', 'รับรองผลงานและส่งให้เจ้าของอนุมัติ?')} className={`${btn} bg-amber-600 hover:bg-amber-700 text-white`}>
              PM รับรองผลงาน ➔ ส่งเจ้าของอนุมัติ
            </button>
            <button type="button" disabled={isPending} onClick={() => run('reject', '')} className={`${btn} bg-rose-50 text-rose-700 hover:bg-rose-100`}>
              <XCircle className="h-3.5 w-3.5" /> ตีกลับ
            </button>
          </>
        )}
        {allowed.approve && (
          <>
            <button type="button" disabled={isPending} onClick={() => run('approve', 'อนุมัติจ่ายและตั้งหนี้รอทำจ่าย?')} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
              <CheckCircle2 className="h-3.5 w-3.5" /> เจ้าของอนุมัติจ่าย
            </button>
            <button type="button" disabled={isPending} onClick={() => run('reject', '')} className={`${btn} bg-rose-50 text-rose-700 hover:bg-rose-100`}>
              <XCircle className="h-3.5 w-3.5" /> ไม่อนุมัติ
            </button>
          </>
        )}
        {allowed.pay && vendorId && (
          <Link href={`/pv/new?vendorId=${vendorId}`} className={`${btn} bg-purple-600 hover:bg-purple-700 text-white`}>
            ออกใบสำคัญจ่าย (PV) ➔
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
