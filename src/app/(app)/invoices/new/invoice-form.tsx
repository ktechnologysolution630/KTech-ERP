'use client';

import { useState, useTransition } from 'react';
import { DateInput } from '@/components/date-input';
import { CREDIT_BASIS_LABEL, computeDueDate, describeSchedule } from '@/domain/payment-terms';
import { formatThaiDate } from '@/domain/thai';
import type { PoBillingInfo } from '@/server/services/invoice';
import { createInvoiceAction } from '../actions';

const input = 'w-full rounded-lg border border-slate-300 px-3 py-2';
const label = 'block text-xs font-medium text-slate-700 mb-1';

export function InvoiceForm({
  pos,
  billing,
  initialPoId,
  today,
}: {
  pos: { id: string; number: string; vendorName: string; gross: string }[];
  billing: PoBillingInfo[];
  initialPoId: string;
  today: string;
}) {
  const [poId, setPoId] = useState(initialPoId);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const info = billing.find((b) => b.poId === poId);
  const isCredit = info?.paymentType === 'CREDIT';
  const preview =
    isCredit && info.lastReceivedDate && invoiceDate
      ? computeDueDate({
          invoiceDate,
          receivedDate: info.lastReceivedDate,
          terms: { billingSchedule: info.billingSchedule, creditBasis: info.creditBasis, creditDays: info.creditDays ?? 0, chequeSchedule: info.chequeSchedule },
        })
      : null;

  return (
    <form
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const r = await createInvoiceAction({
            poId,
            invoiceNo: String(fd.get('invoiceNo') ?? ''),
            invoiceDate: String(fd.get('invoiceDate') ?? ''),
            isTaxInvoice: fd.get('isTaxInvoice') === 'on',
            beforeVat: String(fd.get('beforeVat') ?? '0'),
            vat: String(fd.get('vat') ?? '0'),
            dueDate: String(fd.get('dueDate') ?? ''),
          });
          // Success redirects away; only a refusal comes back
          if (r && !r.ok) setError(r.error);
        });
      }}
      className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 text-sm"
    >
      <div>
        <label className={label}>ใบสั่งซื้อ (PO) *</label>
        <select name="poId" value={poId} onChange={(e) => setPoId(e.target.value)} required className={input}>
          <option value="">-- เลือก PO --</option>
          {pos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.number} · {p.vendorName} (฿{p.gross})
            </option>
          ))}
        </select>
      </div>

      {isCredit && (
        <div className={`rounded-lg border p-3 text-xs ${info.lastReceivedDate ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <p>
            เงื่อนไข: เครดิต {info.creditDays ?? 0} วัน · {CREDIT_BASIS_LABEL[info.creditBasis]} · วางบิล {describeSchedule(info.billingSchedule, 'ได้ทุกวัน')} · รับเช็ค{' '}
            {describeSchedule(info.chequeSchedule, 'ไม่กำหนดรอบ')}
          </p>
          {!info.lastReceivedDate ? (
            <p className="mt-1 font-semibold">ยังไม่มีการรับของใน PO นี้ — วางบิลได้หลังรับของแล้วเท่านั้น</p>
          ) : (
            preview && (
              <p className="mt-1 font-semibold">
                รับของล่าสุด {formatThaiDate(info.lastReceivedDate)} → วันวางบิล {formatThaiDate(preview.billingDate)} → ครบกำหนดจ่าย {formatThaiDate(preview.dueDate)}
              </p>
            )
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>เลขที่ใบแจ้งหนี้ / ใบกำกับภาษี *</label>
          <input type="text" name="invoiceNo" required className={input} />
        </div>
        <div>
          <label className={label}>วันที่เอกสาร *</label>
          <DateInput name="invoiceDate" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required className={input} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>ยอดก่อน VAT (บาท) *</label>
          <input type="number" step="0.01" name="beforeVat" required className={input} />
        </div>
        <div>
          <label className={label}>VAT (บาท) *</label>
          <input type="number" step="0.01" name="vat" defaultValue="0.00" required className={input} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 items-center">
        <div>
          <label className={label}>วันครบกำหนดชำระ (เว้นว่างให้ระบบคำนวณตามเงื่อนไข)</label>
          <DateInput name="dueDate" className={input} />
        </div>
        <label className="flex items-center gap-2 pt-5 text-xs font-medium text-slate-700">
          <input type="checkbox" name="isTaxInvoice" defaultChecked />
          เป็นใบกำกับภาษีซื้อ (ใช้ในรายงานภาษีซื้อ)
        </label>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
      <div className="pt-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-xs font-semibold disabled:opacity-50">
          {pending ? 'กำลังบันทึก...' : 'บันทึกเอกสาร'}
        </button>
      </div>
    </form>
  );
}
