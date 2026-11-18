'use client';

import type { ReactNode } from 'react';
import { COMPANY_NAME_EN } from '@/domain/brand';
import { bahtText, formatMoneyDisplay, VAT_RATE, type DocTotals, type VatMode } from '@/domain/money';

/**
 * The purchasing forms on screen, drawn like their printed PDF (src/pdf/form-parts.tsx): the same
 * letterhead, blue of the K TECH logo, boxes, table header, totals band and signature boxes.
 */

/** Company letterhead shown at the top of a purchasing document form */
export interface CompanyHeader {
  name: string;
  address: string;
  taxId: string;
  /** Branch number from the company settings; 00000 or blank is the head office */
  branch?: string;
  logoUrl: string | null;
  /** The English name from the form settings; the built-in one when left out */
  nameEn?: string;
  /** The phone and e-mail line from the form settings */
  contact?: string;
}

/** สำนักงานใหญ่, or the branch, as printed before the company address */
export function companyBranchLabel(branch: string | undefined): string {
  return !branch || branch === '00000' ? 'สำนักงานใหญ่' : `สาขา ${branch}`;
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
  'w-full border-0 border-b border-dashed border-slate-300 bg-transparent px-1 py-1 text-sm focus:border-[#1668a8] focus:outline-none focus:ring-0';
export const paperCell = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-[#1668a8] focus:outline-none';

/** The PDF's boxes: a light blue-grey line with rounded corners */
export const paperBox = 'overflow-hidden rounded-md border border-[#9db0c4] bg-white';
/** A heading inside a box, e.g. ซัพพลายเออร์อ้างอิง */
export const paperBoxTitle = 'text-sm font-bold text-[#0e4677]';
/** The item table: a blue header like the PDF's */
export const paperTableHead = 'bg-[#1668a8] text-xs text-white';
/** Item rows ruled all round like the printed grid, with no tint between them */
export const paperTableRow = 'align-top [&>td]:border [&>td]:border-[#9db0c4]';

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
    <div className="mx-auto w-full max-w-[1000px] rounded-sm border border-slate-200 bg-white px-4 py-6 shadow-sm sm:px-10 sm:py-8">
      <header>
        <div className="flex flex-col items-center gap-3 sm:grid sm:grid-cols-[120px_1fr_120px] sm:items-center">
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="" className="h-28 w-28 object-contain" />
          ) : (
            <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-[#1668a8] text-2xl font-bold text-white">{initials}</div>
          )}
          <div className="text-center">
            <p className="text-xl font-bold text-[#0e4677]">{company.name}</p>
            <p className="text-sm font-bold tracking-wide text-[#1668a8]">{company.nameEn || COMPANY_NAME_EN}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {companyBranchLabel(company.branch)} {company.address || '-'}
            </p>
            <p className="text-xs text-slate-500">เลขประจำตัวผู้เสียภาษี {company.taxId || '-'}</p>
            {company.contact && <p className="text-xs text-slate-500">{company.contact}</p>}
          </div>
          {/* Balances the logo so the company name stays centred */}
          <span className="hidden sm:block" />
        </div>
        {/* The letterhead rule: a brand-blue line over a thin pale one */}
        <div className="mt-4 h-[3px] bg-[#1668a8]" />
        <div className="mt-[2px] h-px bg-[#9ec3e6]" />
      </header>

      <div className="my-5 flex flex-col items-center gap-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <span className="hidden sm:block" />
        <div className="text-center">
          <h1 className="text-3xl font-bold text-[#0e4677]">{titleTh}</h1>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{titleEn}</p>
        </div>
        <div className="w-full space-y-1.5 rounded-md border border-[#1668a8] bg-[#eaf2fa] px-3 py-2 text-sm sm:ml-auto sm:max-w-[320px]">{meta}</div>
      </div>

      <div className="space-y-6">{children}</div>
    </div>
  );
}

/** One "label: value" row in the document's number and date box */
export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[112px_1fr] items-center gap-2">
      <span className="text-xs font-bold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

/** A "label : field" row in a box, ruled off from the next like the PDF's cells */
export function BoxRow({ label, required, labelWidth = 104, children }: { label: string; required?: boolean; labelWidth?: number; children: ReactNode }) {
  return (
    <label
      className="grid items-center gap-2 border-b border-[#9db0c4] px-3 py-2 last:border-b-0"
      style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
    >
      <span className="text-xs font-bold text-slate-700">
        {label} :{required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

/** The register's active vendors as a picker, by name */
export function VendorSelect({
  label,
  vendors,
  vendorId,
  onChange,
}: {
  label: string;
  vendors: VendorRef[];
  vendorId: string;
  onChange: (id: string) => void;
}) {
  return (
    <select value={vendorId} onChange={(e) => onChange(e.target.value)} className={`${paperInput} font-semibold`} aria-label={label}>
      <option value="">ยังไม่ระบุซัพพลายเออร์ / ผู้รับเหมา</option>
      {[...vendors]
        .sort((a, b) => a.name.localeCompare(b.name, 'th'))
        .map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({x.code})
          </option>
        ))}
    </select>
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
  const fact = (label: string, value: string | null | undefined) => (
    <div className="grid grid-cols-[136px_1fr] gap-2">
      <dt className="font-bold text-slate-700">{label} :</dt>
      <dd className="text-slate-700">{value || '-'}</dd>
    </div>
  );
  return (
    <div className="space-y-2 px-3 py-2 text-sm">
      <p className={paperBoxTitle}>
        {title}
        {required && <span className="text-red-500"> *</span>}
      </p>
      <div className="grid grid-cols-[136px_1fr] items-center gap-2">
        <span className="text-xs font-bold text-slate-700">ชื่อ :</span>
        <VendorSelect label={title} vendors={vendors} vendorId={vendorId} onChange={onChange} />
      </div>
      <dl className="space-y-1 text-xs">
        {fact('ที่อยู่', v?.address)}
        {fact('โทร', v?.phone)}
        {fact('เลขประจำตัวผู้เสียภาษี', v?.taxId)}
        {fact('ผู้ติดต่อ', [v?.contactPerson, v?.email].filter(Boolean).join(' · '))}
      </dl>
    </div>
  );
}

export const VAT_MODE_LABEL: Record<VatMode, string> = {
  EXCLUSIVE: 'ราคาไม่รวม VAT',
  INCLUSIVE: 'ราคารวม VAT แล้ว',
  NONE: 'ไม่มี VAT',
};

/** The VAT row's label, as the PDF prints it */
export function vatRowLabel(mode: VatMode): string {
  return mode === 'NONE' ? 'VAT (ไม่คิดภาษี)' : mode === 'INCLUSIVE' ? `VAT ${VAT_RATE}% (รวมในราคา)` : `VAT ${VAT_RATE}%`;
}

/** One figure in the totals, right-aligned like the PDF's */
export function TotalLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-1 py-1 text-sm">
      <span className="text-slate-700">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** The amount in words on a pale band beside the net amount on a blue one, the PDF's last totals row */
export function AmountAndNet({ amount }: { amount: DocTotals['gross'] }) {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-md border border-[#1668a8] text-sm font-bold md:grid-cols-[1fr_minmax(0,_42%)]">
      <p className="bg-[#eaf2fa] px-3 py-2 text-center text-[#0e4677]">({bahtText(amount)})</p>
      <p className="flex items-center justify-between gap-4 bg-[#1668a8] px-3 py-2 text-white">
        <span>รวมเงินสุทธิ</span>
        <span>{formatMoneyDisplay(amount.toFixed(2))}</span>
      </p>
    </div>
  );
}

/** An amount typed into the totals: the bill discount or the shipping */
export function TotalInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <TotalLine label={label}>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        aria-label={label}
        className="w-32 rounded border border-slate-300 px-2 py-0.5 text-right text-sm focus:border-[#1668a8] focus:outline-none"
      />
    </TotalLine>
  );
}

/** Totals at the foot of a document, labelled as the PDF prints them; AmountAndNet follows with the net */
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
  return (
    <div className="border-t border-[#9db0c4] pt-2">
      <TotalLine label="ยอดรวมก่อนหักส่วนลด">{formatMoneyDisplay(totals.subtotal.toFixed(2))}</TotalLine>
      <TotalInput label="หักส่วนลดพิเศษ" value={billDiscount} onChange={onBillDiscount} />
      <TotalLine label="หลังหักส่วนลดพิเศษ">{formatMoneyDisplay(totals.subtotal.minus(totals.billDiscount).toFixed(2))}</TotalLine>
      {vatMode === 'INCLUSIVE' && <TotalLine label="มูลค่าก่อนภาษี">{formatMoneyDisplay(totals.beforeVat.toFixed(2))}</TotalLine>}
      <TotalLine label={vatRowLabel(vatMode)}>{formatMoneyDisplay(totals.vat.toFixed(2))}</TotalLine>
    </div>
  );
}

/** The amount in words on the PDF's pale band */
export function AmountInWords({ amount }: { amount: DocTotals['gross'] }) {
  return (
    <div className="rounded-md border border-[#1668a8] bg-[#eaf2fa] px-3 py-2 text-center text-sm">
      <p className="text-[11px] text-slate-500">จำนวนเงินตัวอักษร</p>
      <p className="font-bold text-[#0e4677]">({bahtText(amount)})</p>
    </div>
  );
}

/** A box per signer, the role on a pale band at the top, as on the printed form */
export function SignatureRow({ roles }: { roles: string[] }) {
  return (
    <div className={`grid grid-cols-1 gap-3 pt-2 text-center text-xs text-slate-600 ${roles.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
      {roles.map((r) => (
        <div key={r} className={paperBox}>
          <p className="bg-[#eaf2fa] py-1.5 text-sm font-bold text-[#0e4677]">{r}</p>
          <div className="mx-auto mt-12 w-48 border-b border-dotted border-slate-500" />
          <p className="py-2">วันที่ ......../......../........</p>
        </div>
      ))}
    </div>
  );
}

/** A column heading in Thai over English, as in the PDF's table */
export function PaperTh({ th, en, className = '' }: { th: ReactNode; en: string; className?: string }) {
  return (
    <th className={`border border-[#1668a8] px-2 py-1.5 font-bold ${className}`}>
      <span className="block">{th}</span>
      <span className="block text-[10px] font-normal text-[#d6e6f5]">{en}</span>
    </th>
  );
}
