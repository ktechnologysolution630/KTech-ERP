'use client';

import type { ReactNode } from 'react';
import { branchLabel, COMPANY_NAME_EN } from '@/domain/brand';
import { bahtText, formatMoneyDisplay, VAT_RATE, type DocTotals, type VatMode } from '@/domain/money';

/** Company letterhead shown at the top of a purchasing document form */
export interface CompanyHeader {
  name: string;
  address: string;
  taxId: string;
  /** Tax branch, 00000 for the head office */
  branch?: string;
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

/* ---------- The boxed purchasing form, laid out like the printed PR and PO (src/pdf/form-parts.tsx) ---------- */

/** Line colour of the boxed form */
const BOX = 'border-slate-400';

/**
 * A form laid out like the printed purchasing form: logo with the company centred beside it, then the
 * title centred with the number and dates to its right. Stacks on a phone.
 */
export function FormSheet({
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
    <div className="mx-auto w-full max-w-[1000px] rounded-sm border border-slate-200 bg-white px-4 py-6 shadow-sm sm:px-8 sm:py-8">
      <div className="grid grid-cols-[64px_1fr] items-start gap-3 sm:grid-cols-[96px_1fr_96px]">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="h-16 w-16 object-contain sm:h-20 sm:w-20" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded bg-[#2453d4] text-xl font-bold text-white sm:h-20 sm:w-20">{initials}</div>
        )}
        <div className="text-center text-xs text-slate-600">
          <p className="text-base font-bold text-slate-900 sm:text-lg">{company.name}</p>
          <p className="text-sm font-semibold text-slate-800">{COMPANY_NAME_EN}</p>
          <p>{company.address || '-'}</p>
          <p>
            {branchLabel(company.branch)} เลขประจำตัวผู้เสียภาษี {company.taxId || '-'}
          </p>
        </div>
      </div>

      {/* The number column keeps room for a full document number; the title stays as near the centre as that allows */}
      <div className="mt-4 grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_minmax(280px,1fr)]">
        <div className="hidden md:block" />
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#102d72]">{titleTh}</h1>
          <p className="text-sm text-slate-500">{titleEn}</p>
        </div>
        <div className="w-full space-y-1.5 text-sm md:max-w-[320px] md:justify-self-end">{meta}</div>
      </div>

      <div className="mt-4 space-y-5">{children}</div>
    </div>
  );
}

/** One "label : field" cell inside a box of the form */
export function BoxField({ label, children, labelWidth = 'w-24' }: { label: string; children: ReactNode; labelWidth?: string }) {
  return (
    <label className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <span className={`${labelWidth} shrink-0 text-xs font-semibold text-slate-700`}>{label} :</span>
      <div className="min-w-0 flex-1">{children}</div>
    </label>
  );
}

/** A label with its value inside a box, for what the form shows but does not ask */
export function BoxValue({ label, value, labelWidth = 'w-24' }: { label: string; value: ReactNode; labelWidth?: string }) {
  return (
    <div className="flex gap-2 px-3 py-1.5 text-sm">
      <span className={`${labelWidth} shrink-0 text-xs font-semibold text-slate-700`}>{label} :</span>
      <span className="min-w-0 flex-1 break-words text-slate-800">{value}</span>
    </div>
  );
}

/**
 * The two boxes under the title: the vendor on the left, the cells the form asks on the right, then a
 * row for the vendor's contact person. On a phone the boxes stack.
 */
export function PartyBoxes({
  vendorTitle,
  vendors,
  vendorId,
  onVendor,
  right,
  currency,
}: {
  vendorTitle: string;
  vendors: VendorRef[];
  vendorId: string;
  onVendor: (id: string) => void;
  /** Rows of the right box, each a cell or a row of cells */
  right: ReactNode[];
  /** Shows "Currency : BAHT" beside the contact, for forms with prices */
  currency?: boolean;
}) {
  const v = vendors.find((x) => x.id === vendorId);
  return (
    <div>
      <div className={`grid grid-cols-1 border ${BOX} md:grid-cols-[1.1fr_1fr]`}>
        <div className={`space-y-1 border-b ${BOX} px-3 py-2 md:border-b-0 md:border-r`}>
          <p className="text-xs font-semibold text-slate-700">{vendorTitle}</p>
          <select value={vendorId} onChange={(e) => onVendor(e.target.value)} className={`${paperInput} font-semibold`} aria-label={vendorTitle}>
            <option value="">ยังไม่ระบุซัพพลายเออร์ / ผู้รับเหมา</option>
            {[...vendors]
              .sort((a, b) => a.name.localeCompare(b.name, 'th'))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.code})
                </option>
              ))}
          </select>
          <dl className="space-y-0.5 pt-1 text-xs text-slate-600">
            {[
              ['ที่อยู่', v?.address],
              ['โทร', v?.phone],
              ['เลขประจำตัวผู้เสียภาษี', v?.taxId],
            ].map(([k, value]) => (
              <div key={k} className="flex gap-2">
                <dt className="shrink-0 font-semibold text-slate-700">{k} :</dt>
                <dd className="min-w-0 break-words">{value || '-'}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={`divide-y divide-slate-400`}>{right}</div>
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-x-6 border border-t-0 ${BOX}`}>
        <BoxValue label="Contact" value={v?.contactPerson || '-'} labelWidth="w-16" />
        {currency && <BoxValue label="Currency" value="BAHT" labelWidth="w-16" />}
      </div>
    </div>
  );
}

/** Two cells side by side in a box row on a wide screen; one above the other where the box is narrow */
export function BoxPair({ children }: { children: [ReactNode, ReactNode] }) {
  return (
    <div className={`grid grid-cols-1 divide-y divide-slate-400 xl:grid-cols-[1.3fr_1fr] xl:divide-x xl:divide-y-0`}>
      {children[0]}
      {children[1]}
    </div>
  );
}

/** The heading of a table column, in Thai over English */
export function BiHeading({ th, en }: { th: ReactNode; en: string }) {
  return (
    <>
      <span className="block">{th}</span>
      <span className="block text-[10px] font-normal opacity-80">{en}</span>
    </>
  );
}

/** The VAT row's name, as the printed form has it */
export function vatRowLabel(mode: VatMode): string {
  return mode === 'NONE' ? 'VAT (ไม่คิดภาษี)' : mode === 'INCLUSIVE' ? `VAT ${VAT_RATE}% (รวมในราคา)` : `VAT ${VAT_RATE}%`;
}

/**
 * The foot of a priced form: what is entered beside the figures, then the net amount with its words.
 * The special discount, and shipping where the form has it, are typed into their rows.
 */
export function FormTotals({
  totals,
  billDiscount,
  onBillDiscount,
  shipping,
  onShipping,
  vatMode,
  left,
}: {
  totals: DocTotals;
  billDiscount: string;
  onBillDiscount: (v: string) => void;
  /** Given only by a form that charges shipping */
  shipping?: string;
  onShipping?: (v: string) => void;
  vatMode: VatMode;
  left: ReactNode;
}) {
  const row = 'flex items-center justify-between gap-4 py-1';
  const amountInput = 'w-32 rounded border border-slate-200 px-2 py-0.5 text-right text-sm';
  return (
    <div className="space-y-2">
      <div className={`grid grid-cols-1 gap-4 border-t ${BOX} pt-3 md:grid-cols-[1fr_300px]`}>
        <div className="space-y-3">{left}</div>
        <div className="text-sm">
          <div className={row}>
            <span className="text-slate-600">ยอดรวมก่อนหักส่วนลด</span>
            <span>{formatMoneyDisplay(totals.subtotal.toFixed(2))}</span>
          </div>
          <div className={row}>
            <span className="text-slate-600">หักส่วนลดพิเศษ</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={billDiscount}
              onChange={(e) => onBillDiscount(e.target.value)}
              placeholder="0.00"
              aria-label="ส่วนลดพิเศษ"
              className={amountInput}
            />
          </div>
          <div className={row}>
            <span className="text-slate-600">หลังหักส่วนลดพิเศษ</span>
            <span>{formatMoneyDisplay(totals.subtotal.minus(totals.billDiscount).toFixed(2))}</span>
          </div>
          {onShipping && (
            <div className={row}>
              <span className="text-slate-600">ค่าขนส่ง</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={shipping ?? ''}
                onChange={(e) => onShipping(e.target.value)}
                placeholder="0.00"
                aria-label="ค่าขนส่ง"
                className={amountInput}
              />
            </div>
          )}
          {(vatMode === 'INCLUSIVE' || !totals.shipping.isZero()) && (
            <div className={row}>
              <span className="text-slate-600">มูลค่าก่อนภาษี</span>
              <span>{formatMoneyDisplay(totals.beforeVat.toFixed(2))}</span>
            </div>
          )}
          <div className={row}>
            <span className="text-slate-600">{vatRowLabel(vatMode)}</span>
            <span>{formatMoneyDisplay(totals.vat.toFixed(2))}</span>
          </div>
        </div>
      </div>
      <div className={`grid grid-cols-1 border ${BOX} md:grid-cols-[1fr_300px]`}>
        <p className="bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-800">({bahtText(totals.gross)})</p>
        <p className={`flex justify-between border-t ${BOX} px-3 py-2 text-sm font-bold text-slate-900 md:border-l md:border-t-0`}>
          <span>รวมเงินสุทธิ</span>
          <span>{formatMoneyDisplay(totals.gross.toFixed(2))}</span>
        </p>
      </div>
    </div>
  );
}

/** The boxed rows at the foot of the form: the left and right cells, then the signature boxes under them */
export function FootBoxes({ left, right, roles }: { left: ReactNode; right: ReactNode; roles: string[] }) {
  return (
    <div>
      <div className={`grid grid-cols-1 border ${BOX} md:grid-cols-[1.1fr_1fr]`}>
        <div className={`border-b ${BOX} py-1 md:border-b-0 md:border-r`}>{left}</div>
        <div className="py-1">{right}</div>
      </div>
      <div className={`grid grid-cols-1 border border-t-0 ${BOX} sm:grid-cols-3`}>
        {roles.map((r, i) => (
          <div key={r} className={`space-y-1 px-3 pb-3 pt-10 text-center text-xs text-slate-600 ${i ? `border-t ${BOX} sm:border-l sm:border-t-0` : ''}`}>
            <div className="mx-auto w-44 border-b border-slate-400" />
            <p className="font-semibold text-slate-800">{r}</p>
            <p>วันที่ ____ / ____ / ______</p>
          </div>
        ))}
      </div>
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
