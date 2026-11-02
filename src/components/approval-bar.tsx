'use client';

import { useState, useTransition } from 'react';

export function ApprovalBar({
  canApprove,
  approverHint,
  onApprove,
  onReject,
  requireOverrideReason = false,
}: {
  canApprove: boolean;
  approverHint?: string;
  onApprove: (overrideReason?: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  requireOverrideReason?: boolean;
}) {
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canApprove) {
    return approverHint ? (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        {approverHint}
      </div>
    ) : null;
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">รอการอนุมัติจากคุณ</p>
          {approverHint && <p className="text-xs text-slate-600">{approverHint}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  await onApprove(overrideReason || undefined);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
                }
              });
            }}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            อนุมัติ
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowReject((v) => !v)}
            className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            ตีกลับ
          </button>
        </div>
      </div>

      {requireOverrideReason && (
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            เหตุผลอนุมัติกรณีเกินยอด PO (ถ้ามี)
          </label>
          <input
            type="text"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="ระบุเหตุผลกรณีจ่ายเกินยอด PO..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
          />
        </div>
      )}

      {showReject && (
        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ระบุเหตุผลที่ตีกลับ (จำเป็น)..."
            className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!reason.trim()) {
                setError('กรุณาระบุเหตุผลที่ตีกลับ');
                return;
              }
              setError(null);
              startTransition(async () => {
                try {
                  await onReject(reason);
                  setShowReject(false);
                  setReason('');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
                }
              });
            }}
            className="rounded-lg bg-red-700 text-white px-3 py-1.5 text-xs font-medium"
          >
            ยืนยันตีกลับ
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
}
