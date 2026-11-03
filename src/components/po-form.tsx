'use client';

import { useState, useTransition } from 'react';
import type { PoPaymentType } from '@/db/schema';
import { computeDocTotals, D, type VatMode } from '@/domain/money';
import { formatMoneyDisplay } from '@/domain/money';
import {
  InstallmentEditor,
  type InstallmentRowState,
} from '@/components/installment-editor';
import { createPoAction, updatePoAction } from '@/app/(app)/po/actions';

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

export function PoForm({
  projects,
  vendors,
  orderablePrLines = [],
  boqMaterials = [],
  initialProjectId,
  existing,
}: {
  projects: { id: string; code: string; name: string }[];
  /** Main-BOQ material lines; a PO line linked to one is checked against its budget */
  boqMaterials?: BoqMaterialPick[];
  vendors: { id: string; code: string; name: string; defaultCreditDays: number }[];
  orderablePrLines?: OrderablePrLineOption[];
  initialProjectId?: string | null;
  existing?: {
    id: string;
    projectId: string | null;
    vendorId: string;
    paymentType: PoPaymentType;
    creditDays: number | null;
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
      unitName: string;
      qty: string;
      unitPrice: string;
      discount: string;
    }[];
    installments?: InstallmentRowState[];
  };
}) {
  const [projectId, setProjectId] = useState<string>(
    existing
      ? existing.projectId ?? 'OFFICE'
      : initialProjectId === null
      ? 'OFFICE'
      : initialProjectId || projects[0]?.id || 'OFFICE',
  );
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? (vendors[0]?.id || ''));
  const [paymentType, setPaymentType] = useState<PoPaymentType>(
    existing?.paymentType ?? 'CREDIT',
  );
  const [creditDays, setCreditDays] = useState<number>(
    existing?.creditDays ?? vendors[0]?.defaultCreditDays ?? 30,
  );
  const [vatMode, setVatMode] = useState<VatMode>(existing?.vatMode ?? 'EXCLUSIVE');
  const [billDiscount, setBillDiscount] = useState(existing?.billDiscount ?? '0');
  const [shipping, setShipping] = useState(existing?.shipping ?? '0');
  const [deliveryDate, setDeliveryDate] = useState(existing?.deliveryDate ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(existing?.deliveryAddress ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [reason, setReason] = useState('');

  const [lines, setLines] = useState(
    existing?.lines.map((l) => ({
      id: l.id,
      prLineId: l.prLineId ?? '',
      boqLineId: l.boqLineId ?? '',
      description: l.description,
      unitName: l.unitName,
      qty: String(Number(l.qty)),
      unitPrice: String(Number(l.unitPrice)),
      discount: String(Number(l.discount)),
    })) ?? [
      {
        id: undefined,
        prLineId: '',
        boqLineId: '',
        description: '',
        unitName: 'ชิ้น',
        qty: '1',
        unitPrice: '0',
        discount: '0',
      },
    ],
  );

  const [installments, setInstallments] = useState<InstallmentRowState[]>(
    existing?.installments && existing.installments.length > 0
      ? existing.installments
      : [
          {
            name: 'มัดจำ 20%',
            percent: '20',
            condition: 'BEFORE_PRODUCTION',
            conditionNote: '',
          },
          {
            name: 'ก่อนส่ง 30%',
            percent: '30',
            condition: 'BEFORE_DELIVERY',
            conditionNote: '',
          },
          {
            name: 'ส่งของ 40%',
            percent: '40',
            condition: 'AFTER_DELIVERY',
            conditionNote: '',
          },
          {
            name: 'งวดสุดท้าย 10%',
            percent: '10',
            condition: 'AFTER_DELIVERY',
            conditionNote: '',
          },
        ],
  );

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const liveTotals = computeDocTotals({
    vatMode,
    billDiscount: D(billDiscount || 0),
    shipping: D(shipping || 0),
    lines: lines.map((l) => ({
      qty: D(l.qty || 0),
      unitPrice: D(l.unitPrice || 0),
      discount: D(l.discount || 0),
    })),
  });

  const projectBoqMaterials = boqMaterials.filter((b) => projectId !== 'OFFICE' && b.projectId === projectId);

  const matchingPrLines = orderablePrLines.filter(
    (pl) => projectId !== 'OFFICE' && pl.projectId === projectId,
  );

  function addPrLineToPo(prLine: OrderablePrLineOption) {
    setLines((prev) => [
      ...prev.filter((r) => r.description.trim() !== ''),
      {
        id: undefined,
        prLineId: prLine.id,
        boqLineId: '',
        description: prLine.description,
        unitName: prLine.unitName,
        qty: String(Number(prLine.remainingQty)),
        unitPrice: prLine.estUnitPrice ? String(Number(prLine.estUnitPrice)) : '0',
        discount: '0',
      },
    ]);
  }

  function handleSave(submitNow: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          projectId: projectId === 'OFFICE' ? null : projectId,
          vendorId,
          paymentType,
          creditDays: paymentType === 'CREDIT' ? creditDays : null,
          vatMode,
          billDiscount,
          shipping,
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
            unitName: l.unitName,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discount: l.discount || '0',
          })),
          installments:
            paymentType === 'INSTALLMENT'
              ? installments.map((inst) => ({
                  name: inst.name,
                  percent: inst.percent,
                  condition: inst.condition,
                  conditionNote: inst.conditionNote,
                }))
              : undefined,
        };
        if (existing) {
          await updatePoAction(existing.id, payload);
        } else {
          await createPoAction(payload);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-5">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            โครงการ หรือ สำนักงาน/ส่วนกลาง *
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="OFFICE">สำนักงาน / ส่วนกลาง (ไม่มี PR)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} - {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ผู้ขาย / ร้านค้า *</label>
          <select
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              const v = vendors.find((x) => x.id === e.target.value);
              if (v) setCreditDays(v.defaultCreditDays);
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} - {v.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">เงื่อนไขการชำระเงิน *</label>
          <div className="flex gap-2">
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as PoPaymentType)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="CREDIT">เครดิต (รับของก่อนจ่าย)</option>
              <option value="PREPAID">เงินสด / จ่ายก่อนรับของ</option>
              <option value="INSTALLMENT">แบ่งจ่ายหลายงวด</option>
            </select>
            {paymentType === 'CREDIT' && (
              <input
                type="number"
                value={creditDays}
                onChange={(e) => setCreditDays(Number(e.target.value))}
                className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm text-right"
                title="จำนวนวันเครดิต"
              />
            )}
          </div>
        </div>
      </div>

      {matchingPrLines.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-900">
            ดึงรายการจากใบขอซื้อ (PR) ที่อนุมัติแล้วในโครงการนี้:
          </p>
          <div className="flex flex-wrap gap-2">
            {matchingPrLines.map((pl) => (
              <button
                key={pl.id}
                type="button"
                onClick={() => addPrLineToPo(pl)}
                className="rounded-lg bg-white border border-blue-300 hover:bg-blue-100 px-2.5 py-1 text-xs text-blue-800"
              >
                + {pl.prNumber}: {pl.description} (คงเหลือ {Number(pl.remainingQty)} {pl.unitName})
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">รายการสั่งซื้อ</h3>
          <button
            type="button"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                {
                  id: undefined,
                  prLineId: '',
                  boqLineId: '',
                  description: '',
                  unitName: 'ชิ้น',
                  qty: '1',
                  unitPrice: '0',
                  discount: '0',
                },
              ])
            }
            className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
          >
            + เพิ่มรายการ
          </button>
        </div>

        {lines.map((l, idx) => (
          <div
            key={idx}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-lg border border-slate-200 p-3 bg-slate-50/50 items-end"
          >
            {projectBoqMaterials.length > 0 && (
              <div className="sm:col-span-12">
                <label className="block text-[11px] text-slate-500">รายการ BOQ (ใช้ตรวจงบซื้อเกิน BOQ)</label>
                <select
                  value={l.boqLineId}
                  onChange={(e) => {
                    const pick = projectBoqMaterials.find((b) => b.id === e.target.value);
                    setLines((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? {
                              ...r,
                              boqLineId: e.target.value,
                              description: r.description.trim() || pick?.description || r.description,
                              unitName: pick?.unit && (r.unitName === 'ชิ้น' || !r.unitName) ? pick.unit : r.unitName,
                            }
                          : r,
                      ),
                    );
                  }}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">— ไม่ผูกกับ BOQ —</option>
                  {projectBoqMaterials.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.source && b.source !== 'BOQ หลัก' ? `[${b.source}] ` : ''}
                      {b.no} {b.description} · งบวัสดุคงเหลือ {formatMoneyDisplay(b.remaining.toFixed(2))}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="sm:col-span-4">
              <label className="block text-[11px] text-slate-500">รายละเอียดสินค้า *</label>
              <input
                type="text"
                value={l.description}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500">จำนวน *</label>
              <input
                type="number"
                step="0.001"
                value={l.qty}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-right text-xs"
              />
            </div>

            <div className="sm:col-span-1">
              <label className="block text-[11px] text-slate-500">หน่วย *</label>
              <input
                type="text"
                value={l.unitName}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, unitName: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500">ราคา/หน่วย *</label>
              <input
                type="number"
                step="0.01"
                value={l.unitPrice}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, unitPrice: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-right text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500">ส่วนลดรายการ</label>
              <input
                type="number"
                step="0.01"
                value={l.discount}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, discount: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-right text-xs"
              />
            </div>

            <div className="sm:col-span-1 flex justify-between sm:justify-end items-center">
              <span className="text-xs font-medium text-slate-700 sm:mr-2">
                {formatMoneyDisplay(liveTotals.lines[idx]?.gross.toFixed(2) ?? '0.00')}
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-xs text-red-600 hover:underline"
                >
                  ลบ
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">การคิด VAT 7%</label>
          <select
            value={vatMode}
            onChange={(e) => setVatMode(e.target.value as VatMode)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          >
            <option value="EXCLUSIVE">แยก VAT 7% (ราคายังไม่รวม VAT)</option>
            <option value="INCLUSIVE">รวม VAT 7% ในราคาแล้ว</option>
            <option value="NONE">ไม่มี VAT</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ส่วนลดท้ายบิล (บาท)</label>
          <input
            type="number"
            step="0.01"
            value={billDiscount}
            onChange={(e) => setBillDiscount(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-right text-xs"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ค่าขนส่ง (บาท)</label>
          <input
            type="number"
            step="0.01"
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-right text-xs"
          />
        </div>

        <div className="rounded-lg bg-slate-100 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span>ยอดก่อน VAT:</span>
            <span>฿{formatMoneyDisplay(liveTotals.beforeVat.toFixed(2))}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT 7%:</span>
            <span>฿{formatMoneyDisplay(liveTotals.vat.toFixed(2))}</span>
          </div>
          <div className="flex justify-between font-bold text-slate-900 text-sm pt-1 border-t border-slate-300">
            <span>ยอดสุทธิรวม VAT:</span>
            <span>฿{formatMoneyDisplay(liveTotals.gross.toFixed(2))}</span>
          </div>
        </div>
      </div>

      {paymentType === 'INSTALLMENT' && (
        <InstallmentEditor
          rows={installments}
          onChange={setInstallments}
          grossTotal={liveTotals.gross.toFixed(2)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">กำหนดส่งของ</label>
          <input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">สถานที่จัดส่ง</label>
          <input
            type="text"
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">หมายเหตุ</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
      </div>

      {existing?.isApprovedRevision && (
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            เหตุผลในการแก้ไข PO หลังอนุมัติ *
          </label>
          <input
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ระบุเหตุผลที่ต้องแก้ไข PO..."
            className="w-full rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-2 text-xs"
          />
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(false)}
          className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
        >
          บันทึกร่าง
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(true)}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
        >
          บันทึกและส่งขออนุมัติ
        </button>
      </div>
    </div>
  );
}
