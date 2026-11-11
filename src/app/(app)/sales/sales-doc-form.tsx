'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { DateInput } from '@/components/date-input';
import { AmountInWords, DocPaper, MetaRow, SignatureRow, paperCell, paperInput, type CompanyHeader } from '@/components/doc-paper';
import { formatMoneyDisplay } from '@/domain/money';
import { ACCOUNT_CATEGORIES, EXPENSE_CATEGORIES, computeSalesTotals, SALES_DOC_META, SALES_VAT_LABEL, type CategoryOption, type SalesDocKind, type SalesVatMode } from '@/domain/sales-doc';
import { THAI_BANKS } from '@/domain/vendor-profile';
import { createSalesDocAction } from './actions';

export interface SalesCustomerOption {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
  branch: string;
  address: string;
  contactName: string;
  phone: string;
  email: string;
}

export interface SalesAccountOption {
  id: string;
  label: string;
  isDefaultReceive: boolean;
  isDefaultPay: boolean;
}

const PAY_METHODS = [
  ['TRANSFER', 'โอนเงิน'],
  ['CASH', 'เงินสด'],
  ['CHEQUE', 'เช็ค'],
  ['PROMPTPAY', 'พร้อมเพย์'],
  ['CARD', 'บัตรเครดิต'],
] as const;
type PayMethod = (typeof PAY_METHODS)[number][0];

interface Line {
  isSection: boolean;
  name: string;
  detail: string;
  qty: string;
  unit: string;
  unitPrice: string;
}
const item = (): Line => ({ isSection: false, name: '', detail: '', qty: '1', unit: '', unitPrice: '' });
const n = (v: string) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};
const box = 'mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal';

/** One form for every sales document, laid out like the printed page */
export function SalesDocForm({
  kind,
  company,
  customers,
  vendors = [],
  accounts = [],
  categories,
  projects,
  today,
}: {
  kind: SalesDocKind;
  company: CompanyHeader;
  customers: SalesCustomerOption[];
  /** Payees of a payment voucher */
  vendors?: SalesCustomerOption[];
  accounts?: SalesAccountOption[];
  /** Active categories from ตั้งค่าบัญชี; the built-in list is used when none are set up */
  categories?: CategoryOption[];
  projects: { id: string; code: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const meta = SALES_DOC_META[kind];
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [docDate, setDocDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [cust, setCust] = useState({ name: '', taxId: '', branch: '', address: '', contact: '', phone: '', email: '' });
  const [projectId, setProjectId] = useState('');
  const [milestone, setMilestone] = useState('');
  const [accountCategory, setAccountCategory] = useState('');
  const [lines, setLines] = useState<Line[]>([item()]);
  const [notes, setNotes] = useState('');
  const [vatMode, setVatMode] = useState<SalesVatMode>(kind === 'STI' ? 'INCLUSIVE' : 'EXCLUSIVE');
  const [discountType, setDiscountType] = useState<'PERCENT' | 'AMOUNT'>('AMOUNT');
  const [discountValue, setDiscountValue] = useState('');
  const [whtRate, setWhtRate] = useState('');
  const isExpense = kind === 'EXP';
  const paid = kind === 'RC' || kind === 'INC' || isExpense;
  const parties = isExpense ? vendors : customers;
  const [payMethod, setPayMethod] = useState<PayMethod>('TRANSFER');
  const [accountId, setAccountId] = useState(() => accounts.find((a) => (isExpense ? a.isDefaultPay : a.isDefaultReceive))?.id ?? '');
  const [retentionRate, setRetentionRate] = useState('');
  const [bank, setBank] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNo, setAccountNo] = useState('');

  const totals = useMemo(
    () =>
      computeSalesTotals({
        lines: lines.map((l) => ({ isSection: l.isSection, qty: n(l.qty), unitPrice: n(l.unitPrice) })),
        discountType,
        discountValue: n(discountValue),
        vatMode,
        whtRate: n(whtRate),
        retentionRate: isExpense ? n(retentionRate) : 0,
      }),
    [lines, discountType, discountValue, vatMode, whtRate, retentionRate, isExpense],
  );
  const categoryList: CategoryOption[] = categories && categories.length > 0 ? categories : (isExpense ? EXPENSE_CATEGORIES : ACCOUNT_CATEGORIES).map((label) => ({ label }));
  // A tax field the person has set by hand is theirs; a category only fills the ones left alone
  const taxSetByHand = useRef({ vat: false, wht: false });
  const pickCategory = (label: string) => {
    setAccountCategory(label);
    const c = categoryList.find((x) => x.label === label);
    // An abbreviated tax invoice always carries VAT and has no withholding tax
    if (!c || kind === 'STI') return;
    if (c.vatDefault && !taxSetByHand.current.vat) setVatMode(c.vatDefault === 'NONE' ? 'NONE' : 'EXCLUSIVE');
    if (c.whtRate !== undefined && !taxSetByHand.current.wht) setWhtRate(c.whtRate > 0 ? String(c.whtRate) : '');
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = parties.find((x) => x.id === id);
    setCust(c ? { name: c.name, taxId: c.taxId ?? '', branch: c.branch, address: c.address, contact: c.contactName, phone: c.phone, email: c.email } : { name: '', taxId: '', branch: '', address: '', contact: '', phone: '', email: '' });
  };
  // Item numbers skip the area headings
  const itemNos = lines.reduce<number[]>((acc, l, i) => [...acc, (acc[i - 1] ?? 0) + (l.isSection ? 0 : 1)], []);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await createSalesDocAction({
        kind,
        docDate,
        dueDate: kind === 'QT' && dueDate ? dueDate : null,
        reference,
        customerId: isExpense ? null : customerId || null,
        vendorId: isExpense ? customerId || null : null,
        accountId: paid && accountId ? accountId : null,
        retentionRate: isExpense ? n(retentionRate) : 0,
        customerName: cust.name,
        customerTaxId: cust.taxId,
        customerBranch: cust.branch,
        customerAddress: cust.address,
        contactName: cust.contact,
        phone: cust.phone,
        email: cust.email,
        projectId: projectId || null,
        milestone,
        accountCategory,
        vatMode,
        discountType,
        discountValue: n(discountValue),
        whtRate: n(whtRate),
        payMethod: paid ? payMethod : null,
        bank,
        bankBranch,
        accountName,
        accountNo,
        notes,
        lines: lines.map((l) => ({ isSection: l.isSection, name: l.name, detail: l.detail, qty: n(l.qty), unit: l.unit, unitPrice: n(l.unitPrice) })),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/sales/${meta.slug}/${r.id}`);
    });
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        <div>
          <h1 className="text-lg font-bold text-slate-900">สร้าง{meta.th}</h1>
          <p className="text-xs text-slate-500">{meta.hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {error && (
            <p role="alert" className="text-xs font-medium text-red-600">
              {error}
            </p>
          )}
          <button type="button" onClick={() => router.back()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" disabled={pending} onClick={save} className="rounded-lg bg-[#2453d4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
            {pending ? 'กำลังบันทึก...' : 'สร้างเอกสาร'}
          </button>
        </div>
      </div>

      <DocPaper
        company={company}
        titleTh={meta.th}
        titleEn={meta.en}
        meta={
          <>
            <MetaRow label="เลขที่:">
              <input value={`ออกเลขอัตโนมัติ (${meta.prefix})`} readOnly className={`${paperInput} text-slate-500`} />
            </MetaRow>
            <MetaRow label="วันที่:">
              <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} className={paperInput} />
            </MetaRow>
            {kind === 'QT' ? (
              <MetaRow label="ครบกำหนด:">
                <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={paperInput} />
              </MetaRow>
            ) : (
              <MetaRow label="อ้างอิง:">
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={kind === 'DN' ? 'เลขที่ใบกำกับภาษีเดิม *' : 'อ้างอิงเอกสาร'} className={paperInput} />
              </MetaRow>
            )}
          </>
        }
      >
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="space-y-1.5 text-sm">
            <p className="text-xs font-semibold text-slate-600">
              {isExpense ? 'ผู้ขาย / ผู้รับเงิน' : 'ลูกค้า'}
              {kind !== 'STI' && <span className="text-red-500"> *</span>}
            </p>
            <select value={customerId} onChange={(e) => pickCustomer(e.target.value)} aria-label={isExpense ? 'ผู้ขาย / ผู้รับเงิน' : 'ลูกค้า'} className={`${paperInput} font-semibold`}>
              <option value="">{kind === 'STI' ? 'ไม่ระบุลูกค้า (ขายปลีก)' : isExpense ? 'เลือกผู้ขาย / ผู้รับเงิน' : 'เลือกลูกค้า'}</option>
              {parties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            {!customerId && (
              <input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} placeholder={isExpense ? 'หรือพิมพ์ชื่อผู้รับเงิน' : 'หรือพิมพ์ชื่อลูกค้า'} aria-label="ชื่อ" className={paperInput} />
            )}
            <input value={cust.address} onChange={(e) => setCust({ ...cust, address: e.target.value })} placeholder="ที่อยู่" aria-label="ที่อยู่ลูกค้า" className={paperInput} />
            <div className="grid grid-cols-2 gap-2">
              <input value={cust.taxId} onChange={(e) => setCust({ ...cust, taxId: e.target.value })} placeholder="เลขประจำตัวผู้เสียภาษี" aria-label="เลขประจำตัวผู้เสียภาษี" className={paperInput} />
              <input value={cust.branch} onChange={(e) => setCust({ ...cust, branch: e.target.value })} placeholder="สาขา" aria-label="สาขา" className={paperInput} />
              <input value={cust.contact} onChange={(e) => setCust({ ...cust, contact: e.target.value })} placeholder="ผู้ติดต่อ" aria-label="ผู้ติดต่อ" className={paperInput} />
              <input value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} placeholder="โทรศัพท์" aria-label="โทรศัพท์" className={paperInput} />
              <input value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} placeholder="อีเมล" aria-label="อีเมล" className={`${paperInput} col-span-2`} />
            </div>
          </div>
          <div className="space-y-1.5 text-sm">
            <p className="text-xs font-semibold text-slate-600">โครงการ</p>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="โครงการ" className={paperInput}>
              <option value="">ไม่ระบุโครงการ</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </select>
            <input value={milestone} onChange={(e) => setMilestone(e.target.value)} placeholder="งวดงาน" aria-label="งวดงาน" className={paperInput} />
            <select value={accountCategory} onChange={(e) => pickCategory(e.target.value)} aria-label="หมวดบัญชี" className={paperInput}>
              <option value="">เลือกหมวดบัญชี</option>
              {categoryList.map((a) => (
                <option key={a.label}>{a.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="bg-[#102d72] text-xs text-white">
              <tr>
                <th className="w-12 border border-[#102d72] px-2 py-2">ลำดับ</th>
                <th className="border border-[#102d72] px-2 py-2">รายการ</th>
                <th className="w-24 border border-[#102d72] px-2 py-2">จำนวน</th>
                <th className="w-24 border border-[#102d72] px-2 py-2">หน่วย</th>
                <th className="w-32 border border-[#102d72] px-2 py-2">ราคาต่อหน่วย</th>
                <th className="w-32 border border-[#102d72] px-2 py-2">จำนวนเงิน</th>
                <th className="w-8 border border-[#102d72]" aria-label="ลบ" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                return l.isSection ? (
                  <tr key={i} className="bg-slate-50">
                    <td className="border border-slate-200" />
                    <td colSpan={5} className="border border-slate-200 px-1 py-1">
                      <input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="ชื่อพื้นที่หลัก เช่น ห้องโถง" aria-label={`พื้นที่หลักแถวที่ ${i + 1}`} className={`${paperCell} font-semibold`} />
                    </td>
                    <td className="border border-slate-200 px-1 text-center">
                      <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" title="ลบพื้นที่">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={i} className="align-top">
                    <td className="border border-slate-200 px-2 py-2 text-center text-slate-500">{itemNos[i]}</td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="ชื่อรายการ" aria-label={`ชื่อรายการแถวที่ ${i + 1}`} className={`${paperCell} font-medium`} />
                      <textarea value={l.detail} onChange={(e) => setLine(i, { detail: e.target.value })} placeholder="รายละเอียดรายการ" rows={1} aria-label={`รายละเอียดแถวที่ ${i + 1}`} className={`${paperCell} mt-1 resize-y text-xs text-slate-600`} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={`จำนวนแถวที่ ${i + 1}`} className={`${paperCell} text-right`} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label={`หน่วยแถวที่ ${i + 1}`} className={paperCell} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} placeholder="0.00" aria-label={`ราคาต่อหน่วยแถวที่ ${i + 1}`} className={`${paperCell} text-right`} />
                    </td>
                    <td className="border border-slate-200 px-2 py-2 text-right font-medium">{formatMoneyDisplay((n(l.qty) * n(l.unitPrice)).toFixed(2))}</td>
                    <td className="border border-slate-200 px-1 py-2 text-center">
                      {lines.filter((x) => !x.isSection).length > 1 && (
                        <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" title={`ลบแถวที่ ${i + 1}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setLines((p) => [...p, item()])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#2453d4] px-3 py-1.5 text-xs font-medium text-[#2453d4] hover:bg-blue-50">
              <Plus className="h-3.5 w-3.5" /> เพิ่มรายการ
            </button>
            <button type="button" onClick={() => setLines((p) => [...p, { ...item(), isSection: true, qty: '0' }])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-400 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <Plus className="h-3.5 w-3.5" /> เพิ่มพื้นที่หลัก
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <AmountInWords amount={totals.payable} />
            <label className="block text-xs font-semibold text-slate-600">
              หมายเหตุ
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={box} />
            </label>
            {paid && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
                <label className="block text-xs font-semibold text-slate-600">
                  วิธีชำระเงิน
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PayMethod)} className={box}>
                    {PAY_METHODS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  {isExpense ? 'จ่ายจากบัญชีบริษัท' : 'เข้าบัญชีบริษัท'}
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={box}>
                    <option value="">{accounts.length === 0 ? 'ยังไม่มีบัญชี (เพิ่มที่เมนูเงินสด / ธนาคาร)' : 'ไม่ระบุ'}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                {payMethod !== 'CASH' && (
                  <>
                    <label className="block text-xs font-semibold text-slate-600">
                      ธนาคาร
                      <select value={bank} onChange={(e) => setBank(e.target.value)} className={box}>
                        <option value="">เลือกธนาคาร</option>
                        {THAI_BANKS.map((b) => (
                          <option key={b}>{b}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">
                      สาขา
                      <input value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} className={box} />
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">
                      ชื่อบัญชี
                      <input value={accountName} onChange={(e) => setAccountName(e.target.value)} className={box} />
                    </label>
                    <label className="col-span-2 block text-xs font-semibold text-slate-600">
                      {payMethod === 'CHEQUE' ? 'เลขที่เช็ค' : 'เลขบัญชี'}
                      <input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} className={box} />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="divide-y divide-slate-100 self-start rounded border border-slate-200 text-sm">
            <Row label="รวมเป็นเงิน" value={totals.subtotal.toFixed(2)} />
            <div className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="text-slate-600">ส่วนลด</span>
              <span className="flex items-center gap-1">
                <input type="number" min={0} step="0.01" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="0" aria-label="ส่วนลด" className="w-24 rounded border border-slate-200 px-2 py-0.5 text-right" />
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)} aria-label="หน่วยส่วนลด" className="rounded border border-slate-200 px-1 py-0.5 text-xs">
                  <option value="AMOUNT">บาท</option>
                  <option value="PERCENT">%</option>
                </select>
              </span>
            </div>
            <Row label="ราคาหลังหักส่วนลด" value={totals.afterDiscount.toFixed(2)} />
            <div className="flex items-center justify-between gap-3 px-3 py-1.5">
              <select
                value={vatMode}
                onChange={(e) => {
                  taxSetByHand.current.vat = true;
                  setVatMode(e.target.value as SalesVatMode);
                }}
                aria-label="ประเภท VAT" className="rounded border border-slate-200 px-1 py-0.5 text-xs">
                {(Object.keys(SALES_VAT_LABEL) as SalesVatMode[])
                  .filter((m) => kind !== 'STI' || m !== 'EXCLUSIVE')
                  .map((m) => (
                    <option key={m} value={m}>
                      {SALES_VAT_LABEL[m]}
                    </option>
                  ))}
              </select>
              <span>{vatMode === 'INCLUSIVE_HIDDEN' ? '-' : formatMoneyDisplay(totals.vat.toFixed(2))}</span>
            </div>
            <Row label="ราคาไม่รวมภาษีมูลค่าเพิ่ม" value={totals.beforeVat.toFixed(2)} />
            <Row label="จำนวนเงินรวมทั้งสิ้น" value={totals.total.toFixed(2)} />
            {kind !== 'STI' && (
              <div className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="flex items-center gap-1 text-slate-600">
                  หัก ณ ที่จ่าย
                  <input type="number" min={0} max={100} step="0.01" value={whtRate} onChange={(e) => { taxSetByHand.current.wht = true; setWhtRate(e.target.value); }} placeholder="0" aria-label="หัก ณ ที่จ่าย (%)" className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right text-xs" />%
                </span>
                <span>{formatMoneyDisplay(totals.wht.toFixed(2))}</span>
              </div>
            )}
            {isExpense && (
              <div className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="flex items-center gap-1 text-slate-600">
                  หักประกันผลงาน
                  <input type="number" min={0} max={100} step="0.01" value={retentionRate} onChange={(e) => setRetentionRate(e.target.value)} placeholder="0" aria-label="หักประกันผลงาน (%)" className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right text-xs" />%
                </span>
                <span>-{formatMoneyDisplay(totals.retention.toFixed(2))}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 bg-[#102d72] px-3 py-1.5 font-bold text-white">
              <span>{isExpense ? 'ยอดสุทธิที่ต้องจ่าย' : 'ยอดชำระ'}</span>
              <span>{formatMoneyDisplay(totals.payable.toFixed(2))}</span>
            </div>
          </div>
        </div>

        <SignatureRow roles={['ผู้จัดทำ', 'ผู้อนุมัติ', isExpense ? 'ผู้รับเงิน' : 'ลูกค้า']} />
      </DocPaper>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <span className="text-slate-600">{label}</span>
      <span>{formatMoneyDisplay(value)}</span>
    </div>
  );
}
