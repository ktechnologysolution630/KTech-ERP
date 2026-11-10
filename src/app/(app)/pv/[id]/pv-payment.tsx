'use client';

import { useState, useTransition } from 'react';
import { DateInput } from '@/components/date-input';
import { formatMoneyDisplay } from '@/domain/money';
import { CHEQUE_STATUS_LABEL, type ChequeStatus, type PayMethod } from '@/domain/payment-terms';
import { formatThaiDate } from '@/domain/thai';
import { markPvPaidAction, updateChequeAction } from '../actions';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2';
const label = 'block font-medium text-slate-700 mb-1';

/** Records the payment; paying by cheque asks for its number, bank and date */
export function PvPayForm({ pvId, net, today, defaultMethod }: { pvId: string; net: string; today: string; defaultMethod: PayMethod }) {
  const [method, setMethod] = useState<PayMethod>(defaultMethod);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const r = await markPvPaidAction(pvId, {
            paidAt: String(fd.get('paidAt') ?? ''),
            payMethod: method,
            payFromAccount: String(fd.get('payFromAccount') ?? ''),
            payRef: String(fd.get('payRef') ?? ''),
            cheque:
              method === 'CHEQUE'
                ? { no: String(fd.get('chequeNo') ?? ''), bank: String(fd.get('chequeBank') ?? ''), date: String(fd.get('chequeDate') ?? '') }
                : undefined,
          });
          if (!r.ok) setError(r.error);
        });
      }}
      className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-4 text-xs"
    >
      <h3 className="text-sm font-semibold text-emerald-950">บันทึกการจ่ายเงิน</h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>วันที่จ่ายเงิน *</label>
          <DateInput name="paidAt" defaultValue={today} required className={field} />
        </div>
        <div>
          <label className={label}>วิธีจ่ายเงิน *</label>
          <select name="payMethod" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)} className={field}>
            <option value="TRANSFER">โอนเงิน</option>
            <option value="CHEQUE">เช็ค</option>
            <option value="CASH">เงินสด</option>
          </select>
        </div>
        <div>
          <label className={label}>{method === 'CHEQUE' ? 'สั่งจ่ายจากบัญชีบริษัท' : 'โอนจากบัญชีบริษัท'}</label>
          <input type="text" name="payFromAccount" placeholder="เช่น KBANK xxx-x-xxxxx-x" className={field} />
        </div>
        {method !== 'CHEQUE' && (
          <div>
            <label className={label}>เลขอ้างอิงสลิป</label>
            <input type="text" name="payRef" className={field} />
          </div>
        )}
      </div>
      {method === 'CHEQUE' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border border-emerald-200 bg-white p-3">
          <div>
            <label className={label}>เลขที่เช็ค *</label>
            <input type="text" name="chequeNo" required className={field} />
          </div>
          <div>
            <label className={label}>ธนาคาร *</label>
            <input type="text" name="chequeBank" required placeholder="เช่น กสิกรไทย สาขา..." className={field} />
          </div>
          <div>
            <label className={label}>วันที่หน้าเช็ค *</label>
            <DateInput name="chequeDate" defaultValue={today} required className={field} />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="font-medium text-red-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 font-semibold disabled:opacity-50">
        {pending ? 'กำลังบันทึก...' : `ยืนยันบันทึกจ่ายเงิน ฿${formatMoneyDisplay(net)}`}
      </button>
    </form>
  );
}

const STATUS_STYLE: Record<ChequeStatus, string> = {
  ISSUED: 'bg-amber-100 text-amber-800',
  COLLECTED: 'bg-blue-100 text-blue-800',
  CLEARED: 'bg-emerald-100 text-emerald-800',
  VOID: 'bg-red-100 text-red-700',
};

export interface ChequeInfo {
  no: string | null;
  bank: string | null;
  date: string | null;
  status: ChequeStatus;
  collectedBy: string | null;
  collectedAt: string | null;
  clearedAt: string | null;
  voidReason: string | null;
}

/** Where the cheque is: written → collected by the vendor → cleared, or voided */
export function ChequePanel({ pvId, cheque, today, canManage }: { pvId: string; cheque: ChequeInfo; today: string; canManage: boolean }) {
  const [mode, setMode] = useState<'COLLECT' | 'CLEAR' | 'VOID' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fd: FormData) => {
    setError(null);
    startTransition(async () => {
      const input =
        mode === 'COLLECT'
          ? { action: 'COLLECT' as const, by: String(fd.get('by') ?? ''), at: String(fd.get('at') ?? '') }
          : mode === 'CLEAR'
            ? { action: 'CLEAR' as const, at: String(fd.get('at') ?? '') }
            : { action: 'VOID' as const, reason: String(fd.get('reason') ?? '') };
      const r = await updateChequeAction(pvId, input);
      if (r.ok) setMode(null);
      else setError(r.error);
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900">เช็คเลขที่ {cheque.no}</h3>
        <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[cheque.status]}`}>{CHEQUE_STATUS_LABEL[cheque.status]}</span>
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-slate-700">
        <div>
          <dt className="text-slate-500">ธนาคาร</dt>
          <dd>{cheque.bank}</dd>
        </div>
        <div>
          <dt className="text-slate-500">วันที่หน้าเช็ค</dt>
          <dd>{cheque.date ? formatThaiDate(cheque.date) : '-'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">ผู้รับเช็ค</dt>
          <dd>{cheque.collectedBy ? `${cheque.collectedBy} (${formatThaiDate(cheque.collectedAt!)})` : '-'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">เช็คผ่าน</dt>
          <dd>{cheque.clearedAt ? formatThaiDate(cheque.clearedAt) : '-'}</dd>
        </div>
      </dl>
      {cheque.voidReason && <p className="text-red-700">เหตุผลยกเลิก: {cheque.voidReason}</p>}

      {canManage && cheque.status !== 'CLEARED' && cheque.status !== 'VOID' && (
        <div className="flex flex-wrap gap-2">
          {cheque.status === 'ISSUED' && (
            <button type="button" onClick={() => setMode('COLLECT')} className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white">
              ผู้ขายมารับเช็คแล้ว
            </button>
          )}
          {cheque.status === 'COLLECTED' && (
            <button type="button" onClick={() => setMode('CLEAR')} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white">
              บันทึกเช็คผ่าน
            </button>
          )}
          <button type="button" onClick={() => setMode('VOID')} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-red-700">
            ยกเลิกเช็ค
          </button>
        </div>
      )}

      {mode && (
        <form action={run} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {mode === 'COLLECT' && (
            <>
              <label className="flex-1 min-w-40">
                <span className={label}>ชื่อผู้รับเช็ค *</span>
                <input name="by" required className={field} />
              </label>
              <label>
                <span className={label}>วันที่รับ *</span>
                <DateInput name="at" defaultValue={today} required className={field} />
              </label>
            </>
          )}
          {mode === 'CLEAR' && (
            <label>
              <span className={label}>วันที่เช็คผ่าน *</span>
              <DateInput name="at" defaultValue={today} required className={field} />
            </label>
          )}
          {mode === 'VOID' && (
            <label className="flex-1 min-w-60">
              <span className={label}>เหตุผลยกเลิกเช็ค * (ยอดจะกลับเป็นค้างจ่าย และยกเลิก 50 ทวิ ใบเดิม)</span>
              <input name="reason" required className={field} />
            </label>
          )}
          <button type="submit" disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">
            {pending ? 'กำลังบันทึก...' : 'ยืนยัน'}
          </button>
          <button type="button" onClick={() => setMode(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
            ยกเลิก
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
