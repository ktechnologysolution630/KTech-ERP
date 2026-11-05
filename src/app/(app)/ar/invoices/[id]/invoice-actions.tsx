'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PAY_METHODS, PAY_METHOD_LABELS, type ArInvoiceStatus, type ArPayMethod } from '@/domain/ar';
import { bangkokDateString } from '@/domain/thai';
import {
  issueArCreditNoteAction,
  issueArInvoiceAction,
  recordArReceiptAction,
  voidArInvoiceAction,
  voidArReceiptAction,
  type ArResult,
} from '../../actions';
import { DateInput } from '@/components/date-input';

const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]';
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useSubmit() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const submit = <T,>(fn: () => Promise<ArResult<T>>, ok?: (v: T) => string | void) => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const msg = ok?.(r.value);
      if (msg) setMessage(msg);
      router.refresh();
    });
  };
  return { isPending, error, message, submit };
}

export function VoidReceiptButton({ invoiceId, receiptId, number }: { invoiceId: string; receiptId: string; number: string }) {
  const { isPending, error, submit } = useSubmit();
  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          const reason = prompt(`เหตุผลที่ยกเลิก ${number}`);
          if (reason !== null) submit(() => voidArReceiptAction(invoiceId, receiptId, reason));
        }}
        className="text-red-600 hover:underline"
      >
        ยกเลิก
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </>
  );
}

export function InvoiceActions({
  invoiceId,
  status,
  balance,
  retention,
  beforeVat,
  gross,
}: {
  invoiceId: string;
  status: ArInvoiceStatus;
  balance: number;
  retention: number;
  beforeVat: number;
  gross: number;
}) {
  const { isPending, error, message, submit } = useSubmit();
  const open = status === 'ISSUED' || status === 'PARTIAL';
  // Default receipt: everything owed except retention still held, less 1% WHT on the base
  const suggestedWht = Math.round(beforeVat * 0.01 * (Math.max(0, balance - retention) / (gross || 1)) * 100) / 100;
  const [rc, setRc] = useState({
    receiptDate: bangkokDateString(),
    method: 'TRANSFER' as ArPayMethod,
    reference: '',
    whtAmount: suggestedWht,
    amountReceived: Math.max(0, Math.round((balance - retention - suggestedWht) * 100) / 100),
  });
  const [cn, setCn] = useState({ gross: 0, reason: '' });

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-2">
        {status === 'DRAFT' && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm('ยืนยันวางบิล? ระบบจะออกเลขที่ใบแจ้งหนี้และแก้ไขไม่ได้อีก')) {
                submit(() => issueArInvoiceAction(invoiceId), (n) => `วางบิลแล้ว เลขที่ ${n}`);
              }
            }}
            className="px-4 py-2 rounded-lg bg-[#2453d4] text-white font-semibold disabled:opacity-50"
          >
            วางบิล (ออกเลขที่)
          </button>
        )}
        {status !== 'VOID' && status !== 'PAID' && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              const reason = prompt('เหตุผลที่ยกเลิกใบแจ้งหนี้');
              if (reason !== null) submit(() => voidArInvoiceAction(invoiceId, reason));
            }}
            className="px-3 py-2 rounded-lg border border-red-200 text-red-600 disabled:opacity-50"
          >
            ยกเลิกใบแจ้งหนี้
          </button>
        )}
      </div>

      {open && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(() => recordArReceiptAction(invoiceId, rc), (n) => `ออกใบเสร็จ ${n} แล้ว`);
            }}
            className="bg-white rounded-xl border border-slate-200 p-4 space-y-2"
          >
            <h2 className="font-bold text-sm">รับชำระเงิน (ออกใบเสร็จ/ใบกำกับภาษี)</h2>
            <p className="text-slate-500">คงค้าง {baht(balance)} · หักประกันผลงาน {baht(retention)}</p>
            <fieldset disabled={isPending} className="grid grid-cols-2 gap-2">
              <label>
                <span className="block text-slate-600">วันที่รับเงิน</span>
                <DateInput value={rc.receiptDate} onChange={(e) => setRc({ ...rc, receiptDate: e.target.value })} className={`${inputClass} font-mono`} />
              </label>
              <label>
                <span className="block text-slate-600">วิธีรับเงิน</span>
                <select value={rc.method} onChange={(e) => setRc({ ...rc, method: e.target.value as ArPayMethod })} className={inputClass}>
                  {PAY_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAY_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="block text-slate-600">ยอดรับจริง</span>
                <input type="number" min={0} step="0.01" value={rc.amountReceived} onChange={(e) => setRc({ ...rc, amountReceived: Number(e.target.value) || 0 })} className={`${inputClass} font-mono`} />
              </label>
              <label>
                <span className="block text-slate-600">ลูกค้าหัก ณ ที่จ่าย</span>
                <input type="number" min={0} step="0.01" value={rc.whtAmount} onChange={(e) => setRc({ ...rc, whtAmount: Number(e.target.value) || 0 })} className={`${inputClass} font-mono`} />
              </label>
              <label className="col-span-2">
                <span className="block text-slate-600">อ้างอิง (เลขเช็ค/รายการโอน)</span>
                <input value={rc.reference} onChange={(e) => setRc({ ...rc, reference: e.target.value })} className={inputClass} />
              </label>
            </fieldset>
            <button type="submit" disabled={isPending} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50">
              บันทึกรับเงิน
            </button>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(() => issueArCreditNoteAction(invoiceId, cn), (n) => `ออกใบลดหนี้ ${n} แล้ว`);
            }}
            className="bg-white rounded-xl border border-slate-200 p-4 space-y-2"
          >
            <h2 className="font-bold text-sm">ออกใบลดหนี้</h2>
            <fieldset disabled={isPending} className="space-y-2">
              <label className="block">
                <span className="block text-slate-600">ยอดลดหนี้ (รวม VAT)</span>
                <input type="number" min={0.01} step="0.01" required value={cn.gross || ''} onChange={(e) => setCn({ ...cn, gross: Number(e.target.value) || 0 })} className={`${inputClass} font-mono`} />
              </label>
              <label className="block">
                <span className="block text-slate-600">เหตุผล</span>
                <input required value={cn.reason} onChange={(e) => setCn({ ...cn, reason: e.target.value })} className={inputClass} />
              </label>
            </fieldset>
            <button type="submit" disabled={isPending} className="px-4 py-2 rounded-lg border border-slate-300 font-semibold disabled:opacity-50">
              ออกใบลดหนี้
            </button>
          </form>
        </div>
      )}
      {error && <p role="alert" className="text-red-600 font-medium">{error}</p>}
      {message && <p className="text-emerald-700 font-medium">{message}</p>}
    </div>
  );
}
