'use client';

import type { ReactNode } from 'react';
import { bahtText, formatMoneyDisplay, type DocTotals, type VatMode } from '@/domain/money';

/** Company letterhead shown at the top of a purchasing document form */
export interface CompanyHeader {
  name: string;
  address: string;
  taxId: string;
  logoUrl: string | null;
}

export interface VendorRef {
  id: string;
  code: string;
  name: string;
  address: string;
  taxId: string | null;
  contactPerson: string;
  phone: string;
  email: string;
}

export const paperInput =
  'w-full border-0 border-b border-dashed border-slate-300 bg-transparent px-1 py-1 text-sm focus:border-[#2453d4] focus:outline-none focus:ring-0';
export const paperCell = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-[#2453d4] focus:outline-none';

/** A form laid out like the printed document: letterhead, title and the document's number and dates */
export function DocPaper({
  company,
  titleTh,
  titleEn,
  meta,
  children,
}: {
  company: CompanyHeader;
  titleTh: string;
  titleEn: string;
  meta: ReactNode;
  children: ReactNode;
}) {
  const initials = company.name.replace(/^บริษัท\s*/, '').slice(0, 2);
  return (
    <div className="mx-auto w-full max-w-[1000px] rounded-sm border border-slate-200 bg-white px-4 py-6 shadow-sm sm:px-10 sm:py-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="" className="h-20 w-20 rounded object-contain" />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-[#2453d4] text-xl font-bold text-white">{initials}</div>
          )}
          <div className="text-xs text-slate-600">
            <p className="text-base font-bold text-slate-900">{company.name}</p>
            <p>ที่อยู่ : {company.address || '-'}</p>
            <p>เลขประจำตัวผู้เสียภาษี : {company.taxId || '-'}</p>
          </div>
        </div>
        <div className="sm:min-w-[300px]">
          <h1 className="text-right text-2xl font-bold text-[#102d72]">{titleTh}</h1>
          <p className="mb-3 text-right text-xs tracking-widest text-slate-500">{titleEn}</p>
          <div className="space-y-1.5 text-sm">{meta}</div>
        </div>
      </div>
      <hr className="my-6 border-slate-200" />
      <div className="space-y-6">{children}</div>
    </div>
  );
}

/** One "label: value" row in the document's top-right box */
export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[120px_1fr] items-center gap-2">
      <span className="text-right text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

/** Supplier picked from the register, with its details filled in below */
export function VendorBlock({
  title,
  vendors,
  vendorId,
  onChange,
  required,
}: {
  title: string;
  vendors: VendorRef[];
  vendorId: string;
  onChange: (id: string) => void;
  required?: boolean;
}) {
  const v = vendors.find((x) => x.id === vendorId);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs font-semibold text-slate-600">
        {title}
        {required && <span className="text-red-500"> *</span>}
      </p>
      <select value={vendorId} onChange={(e) => onChange(e.target.value)} className={`${paperInput} font-semibold`} aria-label={title}>
        <option value="">ยังไม่ระบุซัพพลายเออร์ / ผู้รับเหมา</option>
        {[...vendors]
          .sort((a, b) => a.name.localeCompare(b.name, 'th'))
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.code})
            </option>
          ))}
      </select>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="inline text-slate-400">ที่อยู่ </dt>
          <dd className="inline">{v?.address || '-'}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">เลขประจำตัวผู้เสียภาษี </dt>
          <dd className="inline">{v?.taxId || '-'}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">ผู้ติดต่อ </dt>
          <dd className="inline">{v?.contactPerson || '-'}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">โทรศัพท์ </dt>
          <dd className="inline">{v?.phone || '-'}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">อีเมล </dt>
          <dd className="inline">{v?.email || '-'}</dd>
        </div>
      </dl>
    </div>
  );
}

export const VAT_MODE_LABEL: Record<VatMode, string> = {
  EXCLUSIVE: 'ราคาไม่รวม VAT',
  INCLUSIVE: 'ราคารวม VAT แล้ว',
  NONE: 'ไม่มี VAT',
};

/** Totals box and amount in words at the foot of a document */
export function TotalsBox({
  totals,
  billDiscount,
  onBillDiscount,
  vatMode,
}: {
  totals: DocTotals;
  billDiscount: string;
  onBillDiscount: (v: string) => void;
  vatMode: VatMode;
}) {
  const row = 'flex items-center justify-between gap-4 px-3 py-1.5';
  return (
    <div className="space-y-2">
      <div className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
        <div className={row}>
          <span className="text-slate-600">รวมก่อนส่วนลด</span>
          <span>{formatMoneyDisplay(totals.subtotal.toFixed(2))}</span>
        </div>
        <div className={row}>
          <span className="text-slate-600">ส่วนลด</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={billDiscount}
            onChange={(e) => onBillDiscount(e.target.value)}
            aria-label="ส่วนลดท้ายบิล"
            className="w-32 rounded border border-slate-200 px-2 py-0.5 text-right text-sm"
          />
        </div>
        <div className={row}>
          <span className="text-slate-600">รวมก่อน VAT</span>
          <span>{formatMoneyDisplay(totals.beforeVat.toFixed(2))}</span>
        </div>
        <div className={row}>
          <span className="text-slate-600">{vatMode === 'NONE' ? 'ภาษีมูลค่าเพิ่ม' : 'ภาษีมูลค่าเพิ่ม 7%'}</span>
          <span>{formatMoneyDisplay(totals.vat.toFixed(2))}</span>
        </div>
        <div className={`${row} bg-[#102d72] font-bold text-white`}>
          <span>ยอดรวมทั้งสิ้น</span>
          <span>{formatMoneyDisplay(totals.gross.toFixed(2))}</span>
        </div>
      </div>
    </div>
  );
}

export function AmountInWords({ amount }: { amount: DocTotals['gross'] }) {
  return (
    <div className="rounded bg-slate-50 px-3 py-2 text-sm">
      <p className="text-xs text-slate-500">จำนวนเงินตัวอักษร</p>
      <p className="font-semibold text-slate-800">({bahtText(amount)})</p>
    </div>
  );
}

/** Blank signature lines, as on the printed form */
export function SignatureRow({ roles }: { roles: string[] }) {
  return (
    <div className={`grid grid-cols-1 gap-6 pt-6 text-center text-xs text-slate-600 ${roles.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
      {roles.map((r) => (
        <div key={r} className="space-y-2">
          <div className="mx-auto h-10 w-48 border-b border-slate-400" />
          <p>({r})</p>
          <p>วันที่ ____ / ____ / ______</p>
        </div>
      ))}
    </div>
  );
}
