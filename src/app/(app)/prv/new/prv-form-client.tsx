'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Receipt, Trash2 } from 'lucide-react';
import { computePrvTotals, PRV_CATEGORY_LABELS, PRV_NEW_CATEGORIES } from '@/domain/prv';
import { bangkokDateString } from '@/domain/thai';
import { createPrvAction } from '../actions';

interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  progressPercent: number;
}

const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900 focus:border-blue-600 focus:outline-none';
const cellInput = 'w-full border-b border-slate-200 py-1 focus:border-blue-600 focus:outline-none bg-transparent';
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PrvFormClient({
  projects,
  vendors,
  initialProjectId,
}: {
  projects: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; name: string }>;
  initialProjectId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? '');
  const [vendorId, setVendorId] = useState('');
  const [category, setCategory] = useState<(typeof PRV_NEW_CATEGORIES)[number]>('CONTRACTOR_PROGRESS');
  const [installmentNo, setInstallmentNo] = useState(1);
  const [date, setDate] = useState(bangkokDateString());
  const [retentionPercent, setRetentionPercent] = useState(5);
  const [whtRate, setWhtRate] = useState(3);
  const [vatRate, setVatRate] = useState(7);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ description: '', quantity: 1, unit: 'งวด', unitPrice: 0, progressPercent: 100 }]);

  const updateItem = <K extends keyof LineItem>(idx: number, key: K, value: LineItem[K]) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));

  // Same maths the server stores
  const totals = computePrvTotals(items, { retentionPercent, whtRate, vatRate });

  if (projects.length === 0) {
    return <p className="max-w-4xl mx-auto text-sm text-slate-600">คุณไม่มีสิทธิ์เปิดใบขอเบิกในโครงการใด</p>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <Link href="/prv" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          กลับไปหน้ารายการ PRV
        </Link>
        <span className="text-xs text-slate-400 font-mono">FORM: PAYMENT REQUEST VOUCHER</span>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-[#102d72] to-[#1e40af] text-white p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">เปิดใบขอเบิกเงิน & เสนอจ่าย (PRV)</h1>
              <p className="text-xs text-blue-100">Payment Certificate รับรองผลงานเพื่อขออนุมัติจ่าย · ค่าของตาม PO ให้เบิกผ่านใบแจ้งหนี้/PO</p>
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const r = await createPrvAction({
                date,
                projectId,
                vendorId,
                category,
                installmentNo: category === 'CONTRACTOR_PROGRESS' ? installmentNo : null,
                retentionPercent,
                whtRate,
                vatRate,
                notes,
                items,
              });
              if (!r.ok) {
                setError(r.error);
                return;
              }
              router.push(`/prv/${r.id}`);
            });
          }}
          className="p-6 space-y-6 text-xs"
        >
          <fieldset disabled={isPending} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">โครงการก่อสร้าง *</span>
                <select required value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">ประเภทการขอเบิก *</span>
                <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={field}>
                  {PRV_NEW_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {PRV_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">ผู้รับเงิน / ผู้รับเหมา *</span>
                <select required value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={field}>
                  <option value="">-- เลือกผู้รับเหมา / ผู้ขาย --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <Link href="/labor-payments/contractors" className="mt-1 inline-block text-[11px] text-blue-600 hover:underline">
                  + เพิ่มผู้รับเหมาใหม่
                </Link>
              </label>
              {category === 'CONTRACTOR_PROGRESS' && (
                <label className="block">
                  <span className="block font-medium text-slate-700 mb-1">งวดที่ขอเบิก</span>
                  <input type="number" min={1} value={installmentNo} onChange={(e) => setInstallmentNo(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} className={field} />
                </label>
              )}
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">วันที่เอกสาร</span>
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-sm">รายการขอเบิก / งวดงาน</span>
                <button
                  type="button"
                  onClick={() => setItems((p) => [...p, { description: '', quantity: 1, unit: 'งวด', unitPrice: 0, progressPercent: 100 }])}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" />
                  เพิ่มบรรทัด
                </button>
              </div>
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="bg-slate-100/80 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">ลำดับ</th>
                      <th className="px-3 py-2 text-left font-medium">รายละเอียดงาน</th>
                      <th className="px-3 py-2 text-right font-medium w-20">จำนวน</th>
                      <th className="px-3 py-2 text-left font-medium w-20">หน่วย</th>
                      <th className="px-3 py-2 text-right font-medium w-28">ราคาต่อหน่วย</th>
                      <th className="px-3 py-2 text-right font-medium w-24">ผลงานงวดนี้ (%)</th>
                      <th className="px-3 py-2 text-right font-medium w-28">ขอเบิก (บาท)</th>
                      <th className="px-2 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <input required value={it.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} placeholder="เช่น งานฐานรากและคานคอดิน" className={cellInput} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="0.001" min={0.001} required value={it.quantity} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))} className={`${cellInput} text-right`} />
                        </td>
                        <td className="px-3 py-2">
                          <input value={it.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} className={cellInput} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="0.01" min={0} required value={it.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))} className={`${cellInput} text-right`} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="1" min={0} max={100} value={it.progressPercent} onChange={(e) => updateItem(idx, 'progressPercent', Number(e.target.value))} className={`${cellInput} text-right`} />
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">฿{baht(totals.lineAmounts[idx].toNumber())}</td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            disabled={items.length <= 1}
                            onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 disabled:opacity-30"
                            title="ลบบรรทัด"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
              <label className="block">
                <span className="block font-medium text-slate-700 mb-1">หมายเหตุ / บันทึกเพิ่มเติม</span>
                <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ผลงานที่ส่งมอบ เงื่อนไขการเบิก" className="w-full rounded-lg border border-slate-300 p-2.5 focus:border-blue-600 focus:outline-none" />
              </label>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
                <div className="flex justify-between font-medium text-slate-700">
                  <span>มูลค่างานที่ขอเบิก</span>
                  <span>฿{baht(totals.total.toNumber())}</span>
                </div>
                {(
                  [
                    ['หักเงินประกันผลงาน (Retention)', retentionPercent, setRetentionPercent, `-฿${baht(totals.retention.toNumber())}`, 'text-rose-600'],
                    ['หักภาษี ณ ที่จ่าย (จากยอดจ่ายก่อน VAT)', whtRate, setWhtRate, `-฿${baht(totals.wht.toNumber())}`, 'text-rose-600'],
                    ['ภาษีมูลค่าเพิ่ม (VAT)', vatRate, setVatRate, `+฿${baht(totals.vat.toNumber())}`, 'text-blue-700'],
                  ] as const
                ).map(([label, value, setter, amount, tone]) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      {label}
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        max={100}
                        value={value}
                        onChange={(e) => setter(Number(e.target.value))}
                        className="w-14 text-center border border-slate-300 rounded px-1 py-0.5 bg-white"
                      />
                      %
                    </span>
                    <span className={`font-medium ${tone}`}>{amount}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-slate-200 flex justify-between text-sm">
                  <span className="font-bold text-slate-900">คงเหลือจ่ายสุทธิงวดนี้</span>
                  <span className="font-bold text-emerald-700 text-base">฿{baht(totals.net.toNumber())}</span>
                </div>
              </div>
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-red-600 font-medium">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <Link href="/prv" className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium">
              ยกเลิก
            </Link>
            <button type="submit" disabled={isPending} className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm disabled:opacity-60">
              {isPending ? 'กำลังบันทึก...' : 'บันทึกใบขอเบิกเงิน (PRV)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
