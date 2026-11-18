'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reissueWhtCertAction, voidWhtCertAction } from './actions';

/**
 * ยกเลิก on an issued certificate, with the reason typed in; ออกใหม่ on a cancelled one whose PV is
 * still paid
 */
export function WhtCertActions({ id, number, status, pvPaid }: { id: string; number: string; status: 'ACTIVE' | 'VOID'; pvPaid: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const done = (r: { ok: true } | { ok: false; error: string }) => {
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setVoiding(false);
    setReason('');
    setError(null);
    router.refresh();
  };

  if (status === 'VOID') {
    if (!pvPaid) return null;
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`ออก ${number} ใหม่ ด้วยยอดจากใบสำคัญจ่ายและข้อมูลผู้ขายปัจจุบัน?`)) return;
            startTransition(async () => done(await reissueWhtCertAction(id)));
          }}
          className="text-emerald-700 hover:underline disabled:opacity-50"
        >
          ออกใหม่
        </button>
        {error && <span className="text-red-600">{error}</span>}
      </span>
    );
  }

  if (!voiding) {
    return (
      <button type="button" onClick={() => setVoiding(true)} className="text-red-600 hover:underline">
        ยกเลิก
      </button>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="เหตุผลที่ยกเลิก (จำเป็น)"
        aria-label={`เหตุผลที่ยกเลิก ${number}`}
        className="w-48 rounded border border-red-300 px-2 py-1"
        autoFocus
      />
      <span className="flex gap-2">
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() => startTransition(async () => done(await voidWhtCertAction(id, reason)))}
          className="rounded bg-red-600 px-2 py-1 font-semibold text-white disabled:opacity-50"
        >
          ยืนยันยกเลิก
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setVoiding(false);
            setError(null);
          }}
          className="text-slate-500 hover:underline"
        >
          ไม่ยกเลิก
        </button>
      </span>
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}
