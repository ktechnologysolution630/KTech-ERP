'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { computeArInvoiceTotals } from '@/domain/ar';
import { bangkokDateString } from '@/domain/thai';
import type { VatMode } from '@/domain/money';
import { createArInvoiceAction } from '../../actions';

interface Option {
  id: string;
  label: string;
}

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]';

export function ArInvoiceForm({
  customers,
  projects,
}: {
  customers: Option[];
  projects: (Option & { customerId: string | null })[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [projectId, setProjectId] = useState('');
  const [docDate, setDocDate] = useState(bangkokDateString());
  const [dueDate, setDueDate] = useState('');
  const [vatMode, setVatMode] = useState<VatMode>('EXCLUSIVE');
  const [retention, setRetention] = useState(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ description: '', qty: 1, unitPrice: 0 }]);

  const totals = computeArInvoiceTotals(lines, vatMode);

  if (customers.length === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        ยังไม่มีลูกค้า — เพิ่มลูกค้าที่เมนู บัญชี / การเงิน → ลูกค้า ก่อนสร้างใบแจ้งหนี้
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createArInvoiceAction({
            customerId,
            projectId: projectId || null,
            docDate,
            dueDate: dueDate || undefined,
            vatMode,
            retentionAmount: retention,
            note,
            lines,
          });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          router.push(`/ar/invoices/${r.value}`);
        });
      }}
      className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 text-xs"
    >
      <fieldset disabled={isPending} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">ลูกค้า *</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputClass}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">โครงการ</span>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                const p = projects.find((x) => x.id === e.target.value);
                if (p?.customerId) setCustomerId(p.customerId);
              }}
              className={inputClass}
            >
              <option value="">— ไม่ระบุ —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">การคิด VAT</span>
            <select value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)} className={inputClass}>
              <option value="EXCLUSIVE">แยก VAT 7%</option>
              <option value="INCLUSIVE">รวม VAT แล้ว</option>
              <option value="NONE">ไม่มี VAT</option>
            </select>
          </label>
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">วันที่</span>
            <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className={`${inputClass} font-mono`} />
          </label>
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">ครบกำหนด (เว้นว่าง = ตามเครดิตลูกค้า)</span>
            <input type="date" min={docDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputClass} font-mono`} />
          </label>
          <label className="block">
            <span className="block font-medium text-slate-700 mb-1">หักประกันผลงาน (บาท)</span>
            <input type="number" min={0} step="0.01" value={retention} onChange={(e) => setRetention(Number(e.target.value) || 0)} className={`${inputClass} font-mono`} />
          </label>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <label className="col-span-6">
                <span className="block text-[11px] text-slate-500">รายการ</span>
                <input
                  required
                  value={l.description}
                  onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  className={inputClass}
                />
              </label>
              <label className="col-span-2">
                <span className="block text-[11px] text-slate-500">จำนวน</span>
                <input
                  type="number"
                  min={0.001}
                  step="0.001"
                  value={l.qty}
                  onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))}
                  className={`${inputClass} font-mono text-right`}
                />
              </label>
              <label className="col-span-3">
                <span className="block text-[11px] text-slate-500">ราคา/หน่วย</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={l.unitPrice}
                  onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)))}
                  className={`${inputClass} font-mono text-right`}
                />
              </label>
              <div className="col-span-1 text-right">
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-red-600 hover:underline">
                    ลบ
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((p) => [...p, { description: '', qty: 1, unitPrice: 0 }])}
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200"
          >
            + เพิ่มรายการ
          </button>
        </div>

        <label className="block">
          <span className="block font-medium text-slate-700 mb-1">หมายเหตุ</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-4 border-t border-slate-100 pt-3">
        <span>ก่อน VAT <b className="font-mono">{baht(totals.beforeVat.toNumber())}</b></span>
        <span>VAT <b className="font-mono">{baht(totals.vat.toNumber())}</b></span>
        <span>รวมทั้งสิ้น <b className="font-mono text-sm">{baht(totals.gross.toNumber())}</b></span>
      </div>
      {error && <p role="alert" className="text-red-600 font-medium">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={isPending} className="px-4 py-2 bg-[#2453d4] text-white rounded-lg font-semibold disabled:opacity-60">
          {isPending ? 'กำลังบันทึก...' : 'บันทึกฉบับร่าง'}
        </button>
      </div>
    </form>
  );
}
