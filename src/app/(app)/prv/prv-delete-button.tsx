'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import { deletePrvAction } from './actions';

export function PrvDeleteButton({ id, number, payeeName, approved }: { id: string; number: string; payeeName: string; approved: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const close = () => {
    if (isPending) return;
    setOpen(false);
    setError(null);
  };
  const confirmDelete = () => {
    setError(null);
    startTransition(async () => {
      const r = await deletePrvAction(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`ลบ ${number}`}
        aria-label={`ลบ ${number}`}
        className="ml-1 inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
      >
        <Trash2 className="h-3 w-3" />
        ลบ
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 text-left"
          role="dialog"
          aria-modal="true"
          aria-label={`ลบ ${number}`}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-xs shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">ลบใบขอเบิก {number}</h3>
              <button type="button" onClick={close} disabled={isPending} className="text-slate-400 hover:text-slate-600" title="ปิด">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-slate-600">
              ผู้รับเงิน: <span className="font-semibold text-slate-900">{payeeName}</span> ลบแล้วกู้คืนไม่ได้ และเลขที่นี้จะไม่ถูกนำกลับมาใช้
            </p>
            {approved && (
              <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                ใบนี้อนุมัติแล้ว รายการในคิวตั้งจ่ายจะถูกยกเลิกด้วย ถ้าอยู่ในใบสำคัญจ่ายหรือจ่ายเงินแล้ว ระบบจะไม่ให้ลบ
              </p>
            )}
            {error && (
              <p role="alert" className="font-medium text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={isPending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
                ยกเลิก
              </button>
              <button type="button" onClick={confirmDelete} disabled={isPending} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {isPending ? 'กำลังลบ...' : 'ลบใบขอเบิก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
