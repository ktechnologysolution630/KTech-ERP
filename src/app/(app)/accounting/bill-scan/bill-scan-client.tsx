'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileUp, ScanLine } from 'lucide-react';
import { DateInput } from '@/components/date-input';
import { parseBillText } from '@/domain/bill-scan';
import { formatMoneyDisplay } from '@/domain/money';
import { computeSalesTotals, type CategoryOption } from '@/domain/sales-doc';
import { readBillLines } from '@/lib/read-bill';
import { createSalesDocAction } from '../../sales/actions';

const field = 'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-normal focus:border-[#2453d4] focus:outline-none';
const label = 'block text-xs font-semibold text-slate-700';
const MAX_BYTES = 15 * 1024 * 1024;

interface Form {
  vendorId: string;
  vendorName: string;
  taxId: string;
  invoiceNo: string;
  date: string;
  projectId: string;
  category: string;
  description: string;
  beforeVat: string;
  hasVat: boolean;
  whtRate: string;
  accountId: string;
  payMethod: 'TRANSFER' | 'CASH' | 'CHEQUE' | 'PROMPTPAY' | 'CARD';
}

/**
 * สแกนบิล: read a bill picture or PDF in the browser, show what was read for checking, then save it
 * as a payment voucher with the file attached. Nothing is saved until the person confirms.
 */
export function BillScanClient({
  vendors,
  projects,
  accounts,
  categories,
  ownTaxId,
  ownName,
  today,
}: {
  vendors: { id: string; name: string; taxId: string | null }[];
  projects: { id: string; code: string; name: string }[];
  accounts: { id: string; label: string; isDefaultPay: boolean }[];
  categories: CategoryOption[];
  ownTaxId: string;
  ownName: string;
  today: string;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const [billTotal, setBillTotal] = useState<number | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The voucher that was saved while its bill file could not be attached */
  const [savedWithoutFile, setSavedWithoutFile] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const abort = useRef<AbortController | null>(null);
  // A withholding tax rate typed by hand is kept when the category changes
  const whtSetByHand = useRef(false);
  const set = (patch: Partial<Form>) => setForm((p) => (p ? { ...p, ...patch } : p));
  const pickCategory = (label: string) => {
    const rate = categories.find((c) => c.label === label)?.whtRate;
    // VAT is left as read from the bill itself
    set({ category: label, ...(rate !== undefined && !whtSetByHand.current ? { whtRate: rate > 0 ? String(rate) : '' } : {}) });
  };

  useEffect(() => () => abort.current?.abort(), []);
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const read = async (picked: File) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setFile(picked);
    setLines(null);
    setForm(null);
    setError(null);
    setReadError(null);
    setSavedWithoutFile(null);
    whtSetByHand.current = false;
    if (picked.size > MAX_BYTES) {
      setReadError('ไฟล์ใหญ่เกิน 15 MB');
      return;
    }
    setStatus('กำลังเริ่มอ่าน...');
    try {
      const text = await readBillLines(picked, setStatus, controller.signal);
      if (controller.signal.aborted) return;
      const f = parseBillText(text, { ownTaxId, ownName });
      const vendor = vendors.find((v) => v.taxId && f.taxIds.includes(v.taxId)) ?? vendors.find((v) => f.vendorName && f.vendorName.replace(/\s/g, '').includes(v.name.replace(/\s/g, '')));
      setLines(text);
      setBillTotal(f.total);
      setForm({
        vendorId: vendor?.id ?? '',
        vendorName: vendor?.name ?? f.vendorName,
        taxId: vendor?.taxId ?? f.taxIds[0] ?? '',
        invoiceNo: f.invoiceNo,
        date: f.date || today,
        projectId: '',
        category: '',
        description: '',
        beforeVat: f.beforeVat !== null ? String(f.beforeVat) : '',
        hasVat: f.vat !== null && f.vat > 0,
        whtRate: '',
        accountId: accounts.find((a) => a.isDefaultPay)?.id ?? '',
        payMethod: 'TRANSFER',
      });
    } catch {
      if (!controller.signal.aborted) setReadError('อ่านไฟล์ไม่สำเร็จ กรุณาลองรูปที่ชัดขึ้น หรือกรอกข้อมูลเองที่เมนูรายจ่าย');
    } finally {
      if (!controller.signal.aborted) setStatus(null);
    }
  };

  const totals = useMemo(
    () =>
      form
        ? computeSalesTotals({
            lines: [{ qty: 1, unitPrice: Number(form.beforeVat) > 0 ? Number(form.beforeVat) : 0 }],
            discountType: 'AMOUNT',
            discountValue: 0,
            vatMode: form.hasVat ? 'EXCLUSIVE' : 'NONE',
            whtRate: Number(form.whtRate) > 0 ? Number(form.whtRate) : 0,
          })
        : null,
    [form],
  );
  const differs = totals && billTotal !== null && Math.abs(totals.total.toNumber() - billTotal) > 0.01;

  const save = () => {
    if (!form || !file) return;
    if (!(Number(form.beforeVat) > 0)) {
      setError('กรุณากรอกยอดก่อน VAT');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await createSalesDocAction({
        kind: 'EXP',
        docDate: form.date,
        reference: form.invoiceNo,
        vendorId: form.vendorId || null,
        customerName: form.vendorName,
        customerTaxId: form.taxId,
        projectId: form.projectId || null,
        accountCategory: form.category,
        accountId: form.accountId || null,
        payMethod: form.payMethod,
        vatMode: form.hasVat ? 'EXCLUSIVE' : 'NONE',
        whtRate: Number(form.whtRate) > 0 ? Number(form.whtRate) : 0,
        notes: 'บันทึกจากการสแกนบิล',
        lines: [{ name: form.description.trim() || `ค่าใช้จ่ายตามบิล ${form.invoiceNo}`.trim(), qty: 1, unit: 'รายการ', unitPrice: Number(form.beforeVat) }],
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const fd = new FormData();
      fd.set('file', file);
      fd.set('entityType', 'SALES_DOC');
      fd.set('entityId', r.id);
      const uploaded = await fetch('/api/upload', { method: 'POST', body: fd }).catch(() => null);
      if (!uploaded?.ok) {
        // The voucher exists already; saving again would make a second one
        setSavedWithoutFile(r.id);
        return;
      }
      router.push(`/sales/expense/${r.id}`);
    });
  };

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-8 text-center hover:border-[#2453d4]">
        <FileUp className="h-8 w-8 text-slate-400" />
        <span className="text-sm font-semibold text-slate-800">{file ? `${file.name} — เลือกไฟล์อื่น` : 'เลือกไฟล์'}</span>
        <span className="text-xs text-slate-500">รูปบิล (JPG, PNG) หรือ PDF ไม่เกิน 15 MB · อ่านในเครื่องของคุณ ไม่ส่งรูปไปบริการภายนอก</span>
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void read(f);
          }}
        />
      </label>

      {status && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <ScanLine className="h-4 w-4 animate-pulse" /> {status} (ครั้งแรกอาจใช้เวลาสักครู่)
        </p>
      )}
      {readError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {readError}
        </p>
      )}

      {form && totals && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-900">ตรวจสอบก่อนบันทึกเป็นรายจ่าย</h2>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">ข้อมูลด้านล่างมาจากการอ่านรูป อาจผิดได้ โดยเฉพาะตัวเลขและภาษาไทย กรุณาเทียบกับบิลทุกช่องก่อนบันทึก</p>
            <div className="grid grid-cols-2 gap-3">
              <label className={`${label} col-span-2`}>
                ผู้ขาย / ผู้รับเงิน
                <select
                  value={form.vendorId}
                  onChange={(e) => {
                    const v = vendors.find((x) => x.id === e.target.value);
                    set({ vendorId: e.target.value, ...(v ? { vendorName: v.name, taxId: v.taxId ?? form.taxId } : {}) });
                  }}
                  className={field}
                >
                  <option value="">ไม่อยู่ในรายชื่อซัพพลายเออร์ (ใช้ชื่อด้านล่าง)</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${label} col-span-2`}>
                ชื่อบนบิล <span className="text-red-500">*</span>
                <input value={form.vendorName} onChange={(e) => set({ vendorName: e.target.value })} className={field} />
              </label>
              <label className={label}>
                เลขประจำตัวผู้เสียภาษี
                <input value={form.taxId} onChange={(e) => set({ taxId: e.target.value })} inputMode="numeric" maxLength={13} className={field} />
              </label>
              <label className={label}>
                เลขที่บิล / ใบกำกับภาษี
                <input value={form.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} className={field} />
              </label>
              <label className={label}>
                วันที่ <span className="text-red-500">*</span>
                <DateInput value={form.date} onChange={(e) => set({ date: e.target.value })} className={field} />
              </label>
              <label className={label}>
                โครงการ
                <select value={form.projectId} onChange={(e) => set({ projectId: e.target.value })} className={field}>
                  <option value="">ไม่ระบุโครงการ</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                หมวดบัญชี
                <select value={form.category} onChange={(e) => pickCategory(e.target.value)} className={field}>
                  <option value="">เลือกหมวดบัญชี</option>
                  {categories.map((c) => (
                    <option key={c.label}>{c.label}</option>
                  ))}
                </select>
              </label>
              <label className={label}>
                รายการ
                <input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="เช่น ค่าวัสดุ ค่าน้ำมัน" className={field} />
              </label>
              <label className={label}>
                ยอดก่อน VAT <span className="text-red-500">*</span>
                <input type="number" min={0} step="0.01" value={form.beforeVat} onChange={(e) => set({ beforeVat: e.target.value })} className={`${field} text-right`} />
              </label>
              <label className={label}>
                หัก ณ ที่จ่าย (%)
                <input type="number" min={0} max={100} step="0.5" value={form.whtRate} onChange={(e) => { whtSetByHand.current = true; set({ whtRate: e.target.value }); }} placeholder="0" className={`${field} text-right`} />
              </label>
              <label className={`${label} col-span-2 inline-flex items-center gap-1.5`}>
                <input type="checkbox" checked={form.hasVat} onChange={(e) => set({ hasVat: e.target.checked })} /> บิลนี้มี VAT 7% (ใบกำกับภาษี)
              </label>
              <label className={label}>
                วิธีชำระเงิน
                <select value={form.payMethod} onChange={(e) => set({ payMethod: e.target.value as Form['payMethod'] })} className={field}>
                  <option value="TRANSFER">โอนเงิน</option>
                  <option value="CASH">เงินสด</option>
                  <option value="CHEQUE">เช็ค</option>
                  <option value="PROMPTPAY">พร้อมเพย์</option>
                  <option value="CARD">บัตรเครดิต</option>
                </select>
              </label>
              <label className={label}>
                จ่ายจากบัญชีบริษัท
                <select value={form.accountId} onChange={(e) => set({ accountId: e.target.value })} className={field}>
                  <option value="">ไม่ระบุ</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {(
                [
                  ['ยอดก่อน VAT', totals.beforeVat],
                  ['VAT 7%', totals.vat],
                  ['ยอดรวม', totals.total],
                  ['หัก ณ ที่จ่าย', totals.wht],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="flex justify-between px-3 py-1.5">
                  <dt className="text-slate-600">{l}</dt>
                  <dd>{formatMoneyDisplay(v.toFixed(2))}</dd>
                </div>
              ))}
              <div className="flex justify-between bg-[#102d72] px-3 py-1.5 font-bold text-white">
                <dt>ยอดสุทธิที่ต้องจ่าย</dt>
                <dd>{formatMoneyDisplay(totals.payable.toFixed(2))}</dd>
              </div>
            </dl>
            {differs && (
              <p role="alert" className="text-xs font-medium text-amber-800">
                ยอดรวมที่คำนวณได้ ({formatMoneyDisplay(totals.total.toFixed(2))}) ไม่ตรงกับยอดที่อ่านจากบิล ({formatMoneyDisplay(billTotal!.toFixed(2))}) กรุณาตรวจยอดก่อน VAT และช่อง VAT
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs font-medium text-red-600">
                {error}
              </p>
            )}
            {savedWithoutFile ? (
              <div role="alert" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-medium">บันทึกรายจ่ายแล้ว แต่แนบไฟล์บิลไม่สำเร็จ กรุณาเปิดรายจ่ายแล้วแนบไฟล์อีกครั้งที่ช่องไฟล์แนบ</p>
                <Link href={`/sales/expense/${savedWithoutFile}`} className="inline-block rounded-lg bg-[#2453d4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1c43ab]">
                  เปิดรายจ่ายที่บันทึกแล้ว
                </Link>
              </div>
            ) : (
              <button type="button" disabled={pending || !form.vendorName.trim()} onClick={save} className="w-full rounded-lg bg-[#2453d4] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
                {pending ? 'กำลังบันทึก...' : 'บันทึกเป็นรายจ่าย และแนบไฟล์บิล'}
              </button>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-900">ไฟล์บิลและข้อความที่อ่านได้</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview ? <img src={preview} alt="รูปบิลที่เลือก" className="max-h-[420px] w-full rounded-lg border border-slate-200 object-contain" /> : <p className="text-xs text-slate-500">{file?.name} (PDF ไม่แสดงตัวอย่าง)</p>}
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-slate-700">ข้อความที่อ่านได้ทั้งหมด ({lines?.length ?? 0} บรรทัด)</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">{lines?.join('\n') || 'อ่านข้อความไม่ได้'}</pre>
            </details>
          </section>
        </div>
      )}
    </div>
  );
}
