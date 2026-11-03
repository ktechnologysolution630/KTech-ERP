'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Receipt, Plus, Trash2, ArrowLeft, Calculator } from 'lucide-react';
import { createPrvAction } from '../actions';

interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  progressPercent: number;
}

export function PrvFormClient({
  projects,
  vendors,
  pos,
}: {
  projects: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; name: string }>;
  pos: Array<{ id: string; number: string; projectId: string; vendorId: string; total: string }>;
}) {
  const router = useRouter();
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const [selectedPoId, setSelectedPoId] = useState('');
  const [category, setCategory] = useState('CONTRACTOR_PROGRESS');
  const [payeeName, setPayeeName] = useState('');
  const [installmentNo, setInstallmentNo] = useState(1);
  const [retentionPercent, setRetentionPercent] = useState(5);
  const [whtRate, setWhtRate] = useState(3);
  const [vatRate, setVatRate] = useState(7);
  const [isPending, setIsPending] = useState(false);

  const [items, setItems] = useState<LineItem[]>([
    { description: 'งวดงานโครงสร้างฐานราก และคานคอดิน', quantity: 1, unit: 'งวด', unitPrice: 100000, progressPercent: 100 },
  ]);

  const addItem = () => {
    setItems([
      ...items,
      { description: '', quantity: 1, unit: 'งวด', unitPrice: 0, progressPercent: 100 },
    ]);
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: keyof LineItem, val: unknown) => {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: val };
    setItems(next);
  };

  // Live calculations
  const totalAmount = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
  const retentionAmount = (totalAmount * retentionPercent) / 100;
  const whtAmount = (totalAmount * whtRate) / 100;
  const vatAmount = (totalAmount * vatRate) / 100;
  const netAmount = totalAmount - retentionAmount - whtAmount + vatAmount;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb / Top Bar */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <Link
          href="/prv"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปหน้ารายการ PRV
        </Link>
        <span className="text-xs text-slate-400 font-mono">FORM: PAYMENT REQUEST VOUCHER</span>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200/90 shadow-sm overflow-hidden">
        {/* Form Header */}
        <div className="bg-gradient-to-r from-[#102d72] to-[#1e40af] text-white p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center text-white backdrop-blur-xs">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">เปิดใบขอเบิกเงิน & เสนอจ่าย (PRV)</h1>
              <p className="text-xs text-blue-100">
                Payment Request Voucher / Payment Certificate รับรองผลงานเพื่อขออนุมัติจ่าย
              </p>
            </div>
          </div>
        </div>

        <form
          action={async (fd) => {
            setIsPending(true);
            await createPrvAction(fd);
            setIsPending(false);
          }}
          className="p-6 space-y-6 text-xs"
        >
          {/* Header fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">โครงการก่อสร้าง *</label>
              <select
                name="projectId"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">ประเภทการขอเบิก *</label>
              <select
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value="CONTRACTOR_PROGRESS">งวดงานผู้รับเหมา (Payment Certificate)</option>
                <option value="PO_ADVANCE">เงินมัดจำล่วงหน้า (Advance Payment)</option>
                <option value="PO_CREDIT">ขอจ่ายค่าของเครดิตตาม PO</option>
                <option value="EXPENSE">ค่าใช้จ่ายทั่วไปของโครงการ</option>
                <option value="PETTY_CASH">ขอเบิกชดเชยเงินสดย่อย (Petty Cash)</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">อ้างอิงใบสั่งซื้อ PO (ถ้ามี)</label>
              <select
                name="poId"
                value={selectedPoId}
                onChange={(e) => setSelectedPoId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value="">-- ไม่ระบุ PO (เบิกตรง/ค่าใช้จ่าย) --</option>
                {pos
                  .filter((po) => !selectedProjectId || po.projectId === selectedProjectId)
                  .map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.number} (ยอด ฿{Number(po.total).toLocaleString()})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">ชื่อผู้รับเงิน / ผู้รับเหมา *</label>
              <input
                type="text"
                name="payeeName"
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                required
                placeholder="เช่น บจก. ซีเมนต์ไทย, ช่างสมศักดิ์ งานฉาบ"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">งวดที่ขอเบิก</label>
              <input
                type="number"
                name="installmentNo"
                value={installmentNo}
                onChange={(e) => setInstallmentNo(Number(e.target.value))}
                min={1}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">วันที่เอกสาร</label>
              <input
                type="date"
                name="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Line items table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">รายการขอเบิก / งวดงาน</span>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold transition"
              >
                <Plus className="h-3.5 w-3.5" />
                เพิ่มบรรทัด
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-100/80 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">ลำดับ</th>
                    <th className="px-3 py-2 text-left font-medium">รายละเอียดงาน / สินค้า</th>
                    <th className="px-3 py-2 text-right font-medium w-20">จำนวน</th>
                    <th className="px-3 py-2 text-left font-medium w-20">หน่วย</th>
                    <th className="px-3 py-2 text-right font-medium w-28">ราคาต่อหน่วย</th>
                    <th className="px-3 py-2 text-right font-medium w-24">ผลงาน (%)</th>
                    <th className="px-3 py-2 text-right font-medium w-28">รวม (บาท)</th>
                    <th className="px-2 py-2 text-center w-10">ลบ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it, idx) => {
                    const rowTotal = it.quantity * it.unitPrice;
                    return (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            name="description"
                            value={it.description}
                            onChange={(e) => updateItem(idx, 'description', e.target.value)}
                            required
                            placeholder="ระบุรายละเอียดงานหรืองวดที่ขอเบิก"
                            className="w-full border-b border-slate-200 py-1 focus:border-blue-600 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.001"
                            name="quantity"
                            value={it.quantity}
                            onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                            className="w-full text-right border-b border-slate-200 py-1 focus:border-blue-600 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            name="unit"
                            value={it.unit}
                            onChange={(e) => updateItem(idx, 'unit', e.target.value)}
                            className="w-full border-b border-slate-200 py-1 focus:border-blue-600 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            name="unitPrice"
                            value={it.unitPrice}
                            onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                            className="w-full text-right border-b border-slate-200 py-1 focus:border-blue-600 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="1"
                            name="progressPercent"
                            value={it.progressPercent}
                            onChange={(e) => updateItem(idx, 'progressPercent', Number(e.target.value))}
                            className="w-full text-right border-b border-slate-200 py-1 focus:border-blue-600 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">
                          ฿{rowTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="p-1 rounded text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tax & Retention Calculation Box */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
            <div>
              <label className="block font-medium text-slate-700 mb-1">หมายเหตุ / บันทึกเพิ่มเติม</label>
              <textarea
                name="notes"
                rows={4}
                placeholder="ระบุเงื่อนไขการเบิก ผลงานที่ส่งมอบ หรือรายละเอียดเลขที่บัญชีรับเงิน"
                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>

            {/* Calculations Breakdown */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-700 font-medium">
                <span>รวมเป็นจำนวนเงิน</span>
                <span>฿{totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
              </div>

              {/* Retention 5% */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span>หักเงินประกันผลงาน (Retention)</span>
                  <input
                    type="number"
                    step="0.5"
                    name="retentionPercent"
                    value={retentionPercent}
                    onChange={(e) => setRetentionPercent(Number(e.target.value))}
                    className="w-12 text-center border border-slate-300 rounded px-1 py-0.5 text-xs bg-white"
                  />
                  <span>%</span>
                </div>
                <span className="text-rose-600 font-medium">
                  -฿{retentionAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* WHT 3% */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span>หักภาษี ณ ที่จ่าย (WHT)</span>
                  <input
                    type="number"
                    step="0.5"
                    name="whtRate"
                    value={whtRate}
                    onChange={(e) => setWhtRate(Number(e.target.value))}
                    className="w-12 text-center border border-slate-300 rounded px-1 py-0.5 text-xs bg-white"
                  />
                  <span>%</span>
                </div>
                <span className="text-rose-600 font-medium">
                  -฿{whtAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* VAT 7% */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span>ภาษีมูลค่าเพิ่ม (VAT)</span>
                  <input
                    type="number"
                    step="1"
                    name="vatRate"
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value))}
                    className="w-12 text-center border border-slate-300 rounded px-1 py-0.5 text-xs bg-white"
                  />
                  <span>%</span>
                </div>
                <span className="text-blue-700 font-medium">
                  +฿{vatAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-sm">
                <span className="font-bold text-slate-900">คงเหลือจ่ายสุทธิงวดนี้ (Net Amount)</span>
                <span className="font-bold text-emerald-700 text-base">
                  ฿{netAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <Link
              href="/prv"
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium transition"
            >
              ยกเลิก
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition shadow-sm"
            >
              {isPending ? 'กำลังบันทึก...' : 'บันทึกเปิดใบขอเบิกเงิน (PRV)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
