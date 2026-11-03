'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EXPENSE_EVIDENCE, EXPENSE_EVIDENCE_LABELS, type AdvanceStatus, type ExpenseEvidence } from '@/domain/advance';
import { bangkokDateString } from '@/domain/thai';
import {
  addAdvanceExpenseAction,
  cancelAdvanceAction,
  decideAdvanceAction,
  payAdvanceAction,
  recordAdvanceReturnAction,
  removeAdvanceExpenseAction,
  type AdvResult,
} from '../actions';

const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]';

function useSubmit() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submit = <T,>(fn: () => Promise<AdvResult<T>>, onOk?: () => void) => {
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

export function RemoveExpenseButton({ expenseId }: { expenseId: string }) {
  const { isPending, error, submit } = useSubmit();
  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm('ลบรายการนี้?')) submit(() => removeAdvanceExpenseAction(expenseId));
        }}
        className="text-red-600 hover:underline"
      >
        ลบ
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </>
  );
}

export function AdvanceActions({
  advanceId,
  status,
  isPayee,
  canClear,
  permissions,
  outstanding,
  substitutes,
}: {
  advanceId: string;
  status: AdvanceStatus;
  isPayee: boolean;
  canClear: boolean;
  permissions: { approve: boolean; pay: boolean };
  outstanding: number;
  substitutes: { id: string; number: string; total: number }[];
}) {
  const { isPending, error, submit } = useSubmit();
  const [expense, setExpense] = useState({
    spentOn: bangkokDateString(),
    description: '',
    amount: 0,
    evidence: 'RECEIPT' as ExpenseEvidence,
    reference: '',
    substituteId: '',
  });
  const [returned, setReturned] = useState(outstanding);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-2">
        {status === 'PENDING' && permissions.approve && !isPayee && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => confirm('อนุมัติเงินทดรองนี้?') && submit(() => decideAdvanceAction(advanceId, true, ''))}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50"
            >
              อนุมัติ
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                const note = prompt('เหตุผลที่ไม่อนุมัติ');
                if (note !== null) submit(() => decideAdvanceAction(advanceId, false, note));
              }}
              className="px-3 py-2 rounded-lg border border-red-200 text-red-600 disabled:opacity-50"
            >
              ไม่อนุมัติ
            </button>
          </>
        )}
        {status === 'APPROVED' && permissions.pay && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => confirm('บันทึกว่าจ่ายเงินทดรองแล้ว?') && submit(() => payAdvanceAction(advanceId))}
            className="px-4 py-2 rounded-lg bg-[#2453d4] text-white font-semibold disabled:opacity-50"
          >
            บันทึกจ่ายเงิน
          </button>
        )}
        {(status === 'PENDING' || status === 'APPROVED') && (isPayee || permissions.approve) && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => confirm('ยกเลิกใบขอเงินทดรองนี้?') && submit(() => cancelAdvanceAction(advanceId))}
            className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50"
          >
            ยกเลิก
          </button>
        )}
      </div>

      {canClear && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(
                () =>
                  addAdvanceExpenseAction(advanceId, {
                    ...expense,
                    substituteId: expense.evidence === 'SUBSTITUTE' ? expense.substituteId || null : null,
                  }),
                () => setExpense({ ...expense, description: '', amount: 0, reference: '', substituteId: '' }),
              );
            }}
            className="bg-white rounded-xl border border-slate-200 p-4 space-y-2"
          >
            <h2 className="font-bold text-sm">เคลียร์ค่าใช้จ่าย</h2>
            <fieldset disabled={isPending} className="grid grid-cols-2 gap-2">
              <label>
                <span className="block text-slate-600">วันที่จ่าย</span>
                <input type="date" value={expense.spentOn} onChange={(e) => setExpense({ ...expense, spentOn: e.target.value })} className={`${inputClass} font-mono`} />
              </label>
              <label>
                <span className="block text-slate-600">จำนวนเงิน</span>
                <input type="number" min={0.01} step="0.01" required value={expense.amount || ''} onChange={(e) => setExpense({ ...expense, amount: Number(e.target.value) || 0 })} className={`${inputClass} font-mono`} />
              </label>
              <label className="col-span-2">
                <span className="block text-slate-600">รายการ</span>
                <input required value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} className={inputClass} />
              </label>
              <label>
                <span className="block text-slate-600">หลักฐาน</span>
                <select value={expense.evidence} onChange={(e) => setExpense({ ...expense, evidence: e.target.value as ExpenseEvidence })} className={inputClass}>
                  {EXPENSE_EVIDENCE.map((ev) => (
                    <option key={ev} value={ev}>
                      {EXPENSE_EVIDENCE_LABELS[ev]}
                    </option>
                  ))}
                </select>
              </label>
              {expense.evidence === 'SUBSTITUTE' ? (
                <label>
                  <span className="block text-slate-600">ใบรับรองแทนใบเสร็จ (อนุมัติแล้ว)</span>
                  <select required value={expense.substituteId} onChange={(e) => setExpense({ ...expense, substituteId: e.target.value })} className={inputClass}>
                    <option value="">— เลือก —</option>
                    {substitutes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.number} ({s.total.toLocaleString('th-TH')})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  <span className="block text-slate-600">เลขที่ใบเสร็จ / อ้างอิง</span>
                  <input value={expense.reference} onChange={(e) => setExpense({ ...expense, reference: e.target.value })} className={inputClass} />
                </label>
              )}
            </fieldset>
            <button type="submit" disabled={isPending} className="px-4 py-2 rounded-lg bg-[#2453d4] text-white font-semibold disabled:opacity-50">
              เพิ่มรายการ
            </button>
          </form>

          {permissions.pay && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(() => recordAdvanceReturnAction(advanceId, returned));
              }}
              className="bg-white rounded-xl border border-slate-200 p-4 space-y-2"
            >
              <h2 className="font-bold text-sm">รับเงินสดคืน</h2>
              <p className="text-slate-500">ยอดคืนรวมทั้งหมดของเงินทดรองนี้ (แทนที่ยอดเดิม)</p>
              <input type="number" min={0} step="0.01" value={returned} onChange={(e) => setReturned(Number(e.target.value) || 0)} className={`${inputClass} font-mono`} aria-label="ยอดเงินคืน" />
              <button type="submit" disabled={isPending} className="px-4 py-2 rounded-lg border border-slate-300 font-semibold disabled:opacity-50">
                บันทึกเงินคืน
              </button>
            </form>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-red-600 font-medium">{error}</p>}
    </div>
  );
}
