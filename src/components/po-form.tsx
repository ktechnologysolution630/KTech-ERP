'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { PoPaymentType } from '@/db/schema';
import { computeDocTotals, D, formatMoneyDisplay, parseDecimalInput, type VatMode } from '@/domain/money';
import { InstallmentEditor, type InstallmentRowState } from '@/components/installment-editor';
import { createPoAction, updatePoAction } from '@/app/(app)/po/actions';
import { DateInput } from '@/components/date-input';
import { PaymentTermsFields, type PaymentTermsValue } from '@/components/payment-terms-fields';
import {
  AmountInWords,
  DocPaper,
  MetaRow,
  SignatureRow,
  VAT_MODE_LABEL,
  VendorBlock,
  paperCell,
  paperInput,
  type CompanyHeader,
} from '@/components/doc-paper';
import { PAY_METHOD_LABEL, PAY_METHODS, type CreditBasis, type PayMethod } from '@/domain/payment-terms';

export interface OrderablePrLineOption {
  id: string;
  prNumber: string;
  projectId: string;
  projectCode: string;
  description: string;
  unitName: string;
  remainingQty: string;
  estUnitPrice: string | null;
}

export interface BoqMaterialPick {
  id: string;
  projectId: string;
  source?: string;
  no: string;
  description: string;
  unit: string;
  budget: number;
  remaining: number;
}

export interface PoVendorOption {
  id: string;
  code: string;
  name: string;
  address: string;
  taxId: string | null;
  contactPerson: string;
  phone: string;
  email: string;
  active: boolean;
  defaultCreditDays: number;
  billingSchedule: string;
  creditBasis: CreditBasis;
  chequeSchedule: string;
  defaultPayMethod: PayMethod;
}

interface LineState {
  id?: string;
  prLineId: string;
  boqLineId: string;
  description: string;
  detail: string;
  unitName: string;
  qty: string;
  unitPrice: string;
  discount: string;
}

const emptyLine = (): LineState => ({ id: undefined, prLineId: '', boqLineId: '', description: '', detail: '', unitName: 'ชิ้น', qty: '1', unitPrice: '', discount: '' });

/** A typed number, or zero while the field is empty or half-typed */
function num(v: string) {
  const d = parseDecimalInput(v);
  return d && d.isFinite() ? d : D(0);
}

const DEFAULT_INSTALLMENTS: InstallmentRowState[] = [
  { name: 'มัดจำ 20%', percent: '20', condition: 'BEFORE_PRODUCTION', conditionNote: '' },
  { name: 'ก่อนส่ง 30%', percent: '30', condition: 'BEFORE_DELIVERY', conditionNote: '' },
  { name: 'ส่งของ 40%', percent: '40', condition: 'AFTER_DELIVERY', conditionNote: '' },
  { name: 'งวดสุดท้าย 10%', percent: '10', condition: 'AFTER_DELIVERY', conditionNote: '' },
];

const footLabel = 'block text-xs font-semibold text-slate-600';
const footInput = 'mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal';

/** The purchase order, laid out like the printed document */
export function PoForm({
  projects,
  vendors,
  company,
  currentUserName,
  today,
  orderablePrLines = [],
  boqMaterials = [],
  initialProjectId,
  existing,
}: {
  projects: { id: string; code: string; name: string }[];
  /** Main-BOQ material lines; a PO line linked to one is checked against its budget */
  boqMaterials?: BoqMaterialPick[];
  vendors: PoVendorOption[];
  company: CompanyHeader;
  currentUserName: string;
  today: string;
  orderablePrLines?: OrderablePrLineOption[];
  initialProjectId?: string | null;
  existing?: {
    id: string;
    number: string;
    projectId: string | null;
    vendorId: string;
    paymentType: PoPaymentType;
    creditDays: number | null;
    terms?: PaymentTermsValue;
    docDate: string | null;
    department: string;
    requesterName: string;
    paymentTerms: string;
    vatMode: VatMode;
    billDiscount: string;
    shipping: string;
    deliveryDate: string | null;
    deliveryAddress: string;
    note: string;
    isApprovedRevision?: boolean;
    lines: {
      id?: string;
      prLineId: string | null;
      boqLineId?: string | null;
      description: string;
      detail?: string;
      unitName: string;
      qty: string;
      unitPrice: string;
      discount: string;
    }[];
    installments?: InstallmentRowState[];
  };
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>(
    existing ? (existing.projectId ?? 'OFFICE') : initialProjectId === null ? 'OFFICE' : initialProjectId || '',
  );
  // No vendor is picked for the user: with a long list, the first one would slip through unnoticed
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? '');
  const activeVendors = useMemo(() => vendors.filter((v) => v.active || v.id === existing?.vendorId), [vendors, existing?.vendorId]);
  const [paymentType, setPaymentType] = useState<PoPaymentType>(existing?.paymentType ?? 'CREDIT');
  const [creditDays, setCreditDays] = useState<number>(existing?.creditDays ?? 30);
  // Billing / cheque terms start from the vendor's and can be changed for this PO only
  const [terms, setTerms] = useState<PaymentTermsValue | null>(existing?.terms ?? null);
  const [termsKey, setTermsKey] = useState(0);
  const [docDate, setDocDate] = useState(existing?.docDate ?? today);
  const [department, setDepartment] = useState(existing?.department ?? '');
  const [requester, setRequester] = useState(existing?.requesterName || currentUserName);
  const [paymentTerms, setPaymentTerms] = useState(existing?.paymentTerms ?? '');
  const [vatMode, setVatMode] = useState<VatMode>(existing?.vatMode ?? 'EXCLUSIVE');
  const [billDiscount, setBillDiscount] = useState(existing && Number(existing.billDiscount) ? String(Number(existing.billDiscount)) : '');
  const [shipping, setShipping] = useState(existing && Number(existing.shipping) ? String(Number(existing.shipping)) : '');
  const [deliveryDate, setDeliveryDate] = useState(existing?.deliveryDate ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(existing?.deliveryAddress ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<LineState[]>(
    existing?.lines.map((l) => ({
      id: l.id,
      prLineId: l.prLineId ?? '',
      boqLineId: l.boqLineId ?? '',
      description: l.description,
      detail: l.detail ?? '',
      unitName: l.unitName,
      qty: String(Number(l.qty)),
      unitPrice: String(Number(l.unitPrice)),
      discount: Number(l.discount) ? String(Number(l.discount)) : '',
    })) ?? [emptyLine()],
  );
  const [showBoq, setShowBoq] = useState(Boolean(existing?.lines.some((l) => l.boqLineId)));
  const [installments, setInstallments] = useState<InstallmentRowState[]>(
    existing?.installments && existing.installments.length > 0 ? existing.installments : DEFAULT_INSTALLMENTS,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setLine = (idx: number, patch: Partial<LineState>) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const totals = useMemo(
    () =>
      computeDocTotals({
        vatMode,
        billDiscount: num(billDiscount),
        shipping: num(shipping),
        lines: lines.map((l) => ({ qty: num(l.qty), unitPrice: num(l.unitPrice), discount: num(l.discount) })),
      }),
    [lines, billDiscount, shipping, vatMode],
  );

  const projectBoqMaterials = boqMaterials.filter((b) => projectId !== 'OFFICE' && b.projectId === projectId);
  const matchingPrLines = orderablePrLines.filter((pl) => projectId !== 'OFFICE' && pl.projectId === projectId);

  function pickVendor(id: string) {
    setVendorId(id);
    const v = vendors.find((x) => x.id === id);
    if (v) {
      setCreditDays(v.defaultCreditDays);
      setTerms({ billingSchedule: v.billingSchedule, creditBasis: v.creditBasis, chequeSchedule: v.chequeSchedule, payMethod: v.defaultPayMethod });
      setTermsKey((k) => k + 1);
    }
  }

  function addPrLineToPo(prLine: OrderablePrLineOption) {
    setLines((prev) => [
      ...prev.filter((r) => r.description.trim() !== ''),
      {
        ...emptyLine(),
        prLineId: prLine.id,
        description: prLine.description,
        unitName: prLine.unitName,
        qty: String(Number(prLine.remainingQty)),
        unitPrice: prLine.estUnitPrice ? String(Number(prLine.estUnitPrice)) : '',
      },
    ]);
  }

  function handleSave(submitNow: boolean) {
    if (!projectId) {
      setError('กรุณาเลือกโครงการ หรือ สำนักงาน / ส่วนกลาง');
      return;
    }
    if (!vendorId) {
      setError('กรุณาเลือกซัพพลายเออร์ / ผู้รับเหมา');
      return;
    }
    if (existing?.isApprovedRevision && !reason.trim()) {
      setError('กรุณาระบุเหตุผลในการแก้ไข PO หลังอนุมัติ');
      return;
    }
    setError(null);
    const payload = {
      projectId: projectId === 'OFFICE' ? null : projectId,
      vendorId,
      paymentType,
      creditDays: paymentType === 'CREDIT' ? creditDays : null,
      terms: terms ?? undefined,
      header: { docDate: docDate || null, department, requesterName: requester, paymentTerms },
      vatMode,
      billDiscount: billDiscount || '0',
      shipping: shipping || '0',
      deliveryDate: deliveryDate || null,
      deliveryAddress,
      note,
      reason: reason || undefined,
      submitNow,
      lines: lines.map((l) => ({
        id: l.id,
        prLineId: l.prLineId || null,
        boqLineId: projectId === 'OFFICE' ? null : l.boqLineId || null,
        description: l.description,
        detail: l.detail,
        unitName: l.unitName,
        qty: l.qty,
        unitPrice: l.unitPrice || '0',
        discount: l.discount || '0',
      })),
      installments:
        paymentType === 'INSTALLMENT'
          ? installments.map((inst) => ({ name: inst.name, percent: inst.percent, condition: inst.condition, conditionNote: inst.conditionNote }))
          : undefined,
    };
    startTransition(async () => {
      const r = existing ? await updatePoAction(existing.id, payload) : await createPoAction(payload);
      // Success redirects; only a refusal comes back
      if (r && !r.ok) setError(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        {error && (
          <p role="alert" className="mr-auto text-xs font-medium text-red-600">
            {error}
          </p>
        )}
        {projectId !== 'OFFICE' && projectBoqMaterials.length > 0 && (
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" checked={showBoq} onChange={(e) => setShowBoq(e.target.checked)} />
            ตัดงบ BOQ
          </label>
        )}
        <button type="button" onClick={() => router.back()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ยกเลิก
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(false)}
          className="rounded-lg border border-[#2453d4] bg-white px-4 py-2 text-sm font-medium text-[#2453d4] hover:bg-blue-50 disabled:opacity-50"
        >
          บันทึกร่าง
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(true)}
          className="rounded-lg bg-[#2453d4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50"
        >
          {pending ? 'กำลังบันทึก...' : 'สร้างเอกสารและส่งขออนุมัติ'}
        </button>
      </div>

      <DocPaper
        company={company}
        titleTh="ใบสั่งซื้อ"
        titleEn="PURCHASE ORDER"
        meta={
          <>
            <MetaRow label="เลขที่:">
              <input value={existing?.number ?? 'ออกเลขอัตโนมัติเมื่อบันทึก'} readOnly className={`${paperInput} text-slate-500`} />
            </MetaRow>
            <MetaRow label="ประเภท:">
              <select
                value="PO"
                disabled={Boolean(existing)}
                onChange={(e) => {
                  if (e.target.value === 'PR') router.push('/pr/new');
                }}
                className={paperInput}
              >
                <option value="PR">PR</option>
                <option value="PO">PO</option>
              </select>
            </MetaRow>
            <MetaRow label="วันที่:">
              <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} className={paperInput} />
            </MetaRow>
            <MetaRow label="กำหนดใช้/รับของ:">
              <DateInput value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={paperInput} />
            </MetaRow>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <VendorBlock title="ซัพพลายเออร์ / ผู้รับเหมา" vendors={activeVendors} vendorId={vendorId} onChange={pickVendor} required />
          <div className="space-y-2 text-sm">
            <p className="text-xs font-semibold text-slate-600">
              โครงการ / ผู้ขอซื้อ <span className="text-red-500">*</span>
            </p>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="โครงการ" className={`${paperInput} font-semibold`}>
              <option value="">เลือกโครงการ</option>
              <option value="OFFICE">สำนักงาน / ส่วนกลาง (ไม่มี PR)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </select>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="แผนก / ฝ่าย" aria-label="แผนก / ฝ่าย" className={paperInput} />
            <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="ผู้ขอซื้อ" aria-label="ผู้ขอซื้อ" className={paperInput} />
            <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="สถานที่จัดส่ง" aria-label="สถานที่จัดส่ง" className={paperInput} />
          </div>
        </div>

        {matchingPrLines.length > 0 && (
          <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
            <p className="text-xs font-semibold text-blue-900">ดึงรายการจากใบขอซื้อ (PR) ที่อนุมัติแล้วในโครงการนี้:</p>
            <div className="flex flex-wrap gap-2">
              {matchingPrLines.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => addPrLineToPo(pl)}
                  className="rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-xs text-blue-800 hover:bg-blue-100"
                >
                  + {pl.prNumber}: {pl.description} (คงเหลือ {Number(pl.remainingQty)} {pl.unitName})
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead className="bg-[#102d72] text-xs text-white">
              <tr>
                <th className="w-12 border border-[#102d72] px-2 py-2">ลำดับ</th>
                <th className="border border-[#102d72] px-2 py-2">รายการ</th>
                <th className="w-24 border border-[#102d72] px-2 py-2">จำนวน</th>
                <th className="w-20 border border-[#102d72] px-2 py-2">หน่วย</th>
                <th className="w-28 border border-[#102d72] px-2 py-2">ราคาต่อหน่วย</th>
                <th className="w-24 border border-[#102d72] px-2 py-2">ส่วนลด</th>
                <th className="w-28 border border-[#102d72] px-2 py-2">จำนวนเงิน</th>
                <th className="w-8 border border-[#102d72]" aria-label="ลบ" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className="align-top">
                  <td className="border border-slate-200 px-2 py-2 text-center text-slate-500">{idx + 1}</td>
                  <td className="border border-slate-200 px-1 py-1">
                    {showBoq && projectBoqMaterials.length > 0 && (
                      <select
                        value={l.boqLineId}
                        onChange={(e) => {
                          const pick = projectBoqMaterials.find((b) => b.id === e.target.value);
                          setLine(idx, {
                            boqLineId: e.target.value,
                            description: l.description.trim() || pick?.description || l.description,
                            unitName: pick?.unit && (l.unitName === 'ชิ้น' || !l.unitName) ? pick.unit : l.unitName,
                          });
                        }}
                        aria-label={`รายการ BOQ ของรายการที่ ${idx + 1}`}
                        className={`${paperCell} mb-1 bg-amber-50 text-xs`}
                      >
                        <option value="">— ไม่ตัดงบ BOQ —</option>
                        {projectBoqMaterials.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.source && b.source !== 'BOQ หลัก' ? `[${b.source}] ` : ''}
                            {b.no} {b.description} · งบคงเหลือ {formatMoneyDisplay(b.remaining.toFixed(2))}
                          </option>
                        ))}
                      </select>
                    )}
                    <input value={l.description} onChange={(e) => setLine(idx, { description: e.target.value })} placeholder="ชื่อรายการ" aria-label={`ชื่อรายการที่ ${idx + 1}`} className={`${paperCell} font-medium`} />
                    <textarea
                      value={l.detail}
                      onChange={(e) => setLine(idx, { detail: e.target.value })}
                      placeholder="รายละเอียด"
                      rows={1}
                      aria-label={`รายละเอียดรายการที่ ${idx + 1}`}
                      className={`${paperCell} mt-1 resize-y text-xs text-slate-600`}
                    />
                    {l.prLineId && <p className="px-1.5 text-[11px] text-blue-700">อ้างอิงใบขอซื้อ</p>}
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input type="number" step="0.001" min={0} value={l.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} aria-label={`จำนวนรายการที่ ${idx + 1}`} className={`${paperCell} text-right`} />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input value={l.unitName} onChange={(e) => setLine(idx, { unitName: e.target.value })} aria-label={`หน่วยรายการที่ ${idx + 1}`} className={paperCell} />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input type="number" step="0.01" min={0} value={l.unitPrice} onChange={(e) => setLine(idx, { unitPrice: e.target.value })} placeholder="0.00" aria-label={`ราคาต่อหน่วยรายการที่ ${idx + 1}`} className={`${paperCell} text-right`} />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input type="number" step="0.01" min={0} value={l.discount} onChange={(e) => setLine(idx, { discount: e.target.value })} placeholder="0.00" aria-label={`ส่วนลดรายการที่ ${idx + 1}`} className={`${paperCell} text-right`} />
                  </td>
                  <td className="border border-slate-200 px-2 py-2 text-right font-medium">
                    {formatMoneyDisplay(num(l.qty).times(num(l.unitPrice)).minus(num(l.discount)).toFixed(2))}
                  </td>
                  <td className="border border-slate-200 px-1 py-2 text-center">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-600" title={`ลบรายการที่ ${idx + 1}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-[#2453d4] px-3 py-1.5 text-xs font-medium text-[#2453d4] hover:bg-blue-50"
          >
            <Plus className="h-3.5 w-3.5" /> เพิ่มรายการ
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <AmountInWords amount={totals.gross} />
            <label className={footLabel}>
              หมายเหตุ
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={footInput} />
            </label>
            <label className={footLabel}>
              เงื่อนไขการชำระเงิน
              <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="เช่น ชำระภายใน 30 วันหลังวางบิล" className={footInput} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={footLabel}>
                การชำระ
                <select value={paymentType} onChange={(e) => setPaymentType(e.target.value as PoPaymentType)} className={footInput}>
                  <option value="CREDIT">เครดิต (รับของก่อนจ่าย)</option>
                  <option value="PREPAID">เงินสด / จ่ายก่อนรับของ</option>
                  <option value="INSTALLMENT">แบ่งจ่ายหลายงวด</option>
                </select>
              </label>
              {paymentType === 'CREDIT' ? (
                <label className={footLabel}>
                  เครดิต (วัน)
                  <input type="number" min={0} value={creditDays} onChange={(e) => setCreditDays(Number(e.target.value))} className={`${footInput} text-right`} />
                </label>
              ) : (
                <span />
              )}
              <label className={footLabel}>
                วิธีชำระเงิน
                <select
                  value={terms?.payMethod ?? ''}
                  onChange={(e) =>
                    setTerms((t) => ({
                      billingSchedule: t?.billingSchedule ?? '',
                      creditBasis: t?.creditBasis ?? 'BILLING',
                      chequeSchedule: t?.chequeSchedule ?? '',
                      payMethod: e.target.value as PayMethod,
                    }))
                  }
                  className={footInput}
                >
                  <option value="" disabled>
                    เลือกวิธีการชำระเงิน
                  </option>
                  {PAY_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAY_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={footLabel}>
                รูปแบบ VAT
                <select value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)} className={footInput}>
                  {(['EXCLUSIVE', 'INCLUSIVE', 'NONE'] as const).map((m) => (
                    <option key={m} value={m}>
                      {VAT_MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={footLabel}>
                VAT (%)
                <input value={vatMode === 'NONE' ? '0' : '7'} readOnly className={`${footInput} bg-slate-50 text-slate-500`} />
              </label>
            </div>
            {paymentType === 'CREDIT' && terms && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-800">เงื่อนไขวางบิล / รับเช็ค (ดึงจากผู้ขาย แก้เฉพาะใบนี้ได้)</p>
                <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                  <PaymentTermsFields key={termsKey} value={terms} onChange={setTerms} hidePayMethod />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
              <TotalRow label="รวมก่อนส่วนลด" value={totals.subtotal.toFixed(2)} />
              <TotalInput label="ส่วนลด" value={billDiscount} onChange={setBillDiscount} />
              <TotalInput label="ค่าขนส่ง" value={shipping} onChange={setShipping} />
              <TotalRow label="รวมก่อน VAT" value={totals.beforeVat.toFixed(2)} />
              <TotalRow label={vatMode === 'NONE' ? 'ภาษีมูลค่าเพิ่ม' : 'ภาษีมูลค่าเพิ่ม 7%'} value={totals.vat.toFixed(2)} />
              <div className="flex items-center justify-between gap-4 bg-[#102d72] px-3 py-1.5 font-bold text-white">
                <span>ยอดรวมทั้งสิ้น</span>
                <span>{formatMoneyDisplay(totals.gross.toFixed(2))}</span>
              </div>
            </div>
          </div>
        </div>

        {paymentType === 'INSTALLMENT' && <InstallmentEditor rows={installments} onChange={setInstallments} grossTotal={totals.gross.toFixed(2)} />}

        {existing?.isApprovedRevision && (
          <label className={footLabel}>
            เหตุผลในการแก้ไข PO หลังอนุมัติ <span className="text-red-500">*</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุเหตุผลที่ต้องแก้ไข PO..."
              className={`${footInput} border-amber-300 bg-amber-50/40`}
            />
          </label>
        )}

        <SignatureRow roles={['ผู้ขอซื้อ', 'ผู้จัดทำ', 'ผู้อนุมัติ']} />
      </DocPaper>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-1.5">
      <span className="text-slate-600">{label}</span>
      <span>{formatMoneyDisplay(value)}</span>
    </div>
  );
}

function TotalInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-1.5">
      <span className="text-slate-600">{label}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        aria-label={label}
        className="w-32 rounded border border-slate-200 px-2 py-0.5 text-right text-sm"
      />
    </div>
  );
}
