'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, X } from 'lucide-react';
import type { VendorBankAccount, VendorContact } from '@/db/schema';
import { emptyBankAccount, emptyContact, type VendorProfileValues } from '@/components/vendor-profile-values';
import { WHT_RATES } from '@/domain/money';
import { PAY_METHOD_LABEL, PAY_METHODS, type PayMethod } from '@/domain/payment-terms';
import {
  BANK_ACCOUNT_TYPES,
  CONTACT_KIND_LABEL,
  THAI_BANKS,
  THAI_PROVINCES,
  VENDOR_CATEGORY_LABEL,
  VENDOR_STATUS_LABEL,
} from '@/domain/vendor-profile';
import { PaymentTermsFields } from '@/components/payment-terms-fields';
import { AttachmentsBox } from '@/components/attachments';
import { saveVendorProfileAction } from '@/app/(app)/purchasing/vendors/profile-actions';

const TABS = ['ข้อมูลทั่วไป', 'ที่อยู่และผู้ติดต่อ', 'ภาษีและชำระเงิน', 'บัญชีธนาคาร', 'เอกสารแนบ'] as const;
const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-normal focus:border-[#2453d4] focus:outline-none';

function Field({ label, children, wide, required }: { label: string; children: ReactNode; wide?: boolean; required?: boolean }) {
  return (
    <label className={`block text-xs font-semibold text-slate-700 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}
      {required && <span className="text-red-500"> *</span>}
      {children}
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Add or edit a supplier: general, address and contacts, tax and payment, bank accounts, attachments */
export function VendorProfileDialog({
  vendorId,
  initial,
  attachments,
  onClose,
}: {
  /** Null to add a new supplier */
  vendorId: string | null;
  initial: VendorProfileValues;
  attachments?: { id: string; url: string; name: string; size: number; uploaderName: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<VendorProfileValues>) => setV((prev) => ({ ...prev, ...patch }));
  const txt = (key: keyof VendorProfileValues) => ({
    value: String(v[key] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set({ [key]: e.target.value } as Partial<VendorProfileValues>),
    className: inputCls,
  });

  const setContact = (i: number, patch: Partial<VendorContact>) =>
    set({ contacts: v.contacts.map((c, j) => (j === i ? { ...c, ...patch } : patch.primary ? { ...c, primary: false } : c)) });
  const setBank = (i: number, patch: Partial<VendorBankAccount>) =>
    set({ bankAccounts: v.bankAccounts.map((b, j) => (j === i ? { ...b, ...patch } : patch.primary ? { ...b, primary: false } : b)) });

  const save = () => {
    if (!v.code.trim() || !v.name.trim()) {
      setTab(0);
      setError('กรุณาระบุรหัสและชื่อซัพพลายเออร์');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await saveVendorProfileAction(vendorId, v);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      if (!vendorId) router.push(`/purchasing/vendors/${r.id}`);
      else router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label={vendorId ? 'แก้ไขซัพพลายเออร์' : 'เพิ่มซัพพลายเออร์ใหม่'}>
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">{vendorId ? 'แก้ไขซัพพลายเออร์' : 'เพิ่มซัพพลายเออร์ใหม่'}</h2>
            <p className="text-xs text-slate-500">ข้อมูลนี้ใช้เป็นค่าเริ่มต้นในหน้า PO</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 px-4 pt-2">
          {TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === i}
              onClick={() => setTab(i)}
              className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium ${tab === i ? 'border-b-2 border-[#2453d4] text-[#2453d4]' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${tab === i ? 'bg-[#2453d4] text-white' : 'bg-slate-200 text-slate-600'}`}>{i + 1}</span>
              {t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          {tab === 0 && (
            <Section title="ข้อมูลทั่วไป">
              <Field label="รหัสซัพพลายเออร์" required>
                <input {...txt('code')} disabled={Boolean(vendorId)} placeholder="เช่น V-001" className={`${inputCls} disabled:bg-slate-100`} />
              </Field>
              <Field label="ชื่อบริษัท / ชื่อบุคคลตามกฎหมาย" required>
                <input {...txt('name')} maxLength={300} />
              </Field>
              <Field label="ชื่อทางการค้า">
                <input {...txt('tradeName')} maxLength={300} />
              </Field>
              <Field label="ประเภทสินค้า / บริการ">
                <input {...txt('suppliedItems')} maxLength={2000} />
              </Field>
              <Field label="เว็บไซต์">
                <input {...txt('website')} maxLength={300} />
              </Field>
              <Field label="LINE ID">
                <input {...txt('lineId')} maxLength={100} />
              </Field>
              <Field label="สถานะ">
                <select {...txt('status')}>
                  {Object.entries(VENDOR_STATUS_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="หมายเหตุ" wide>
                <textarea {...txt('remark')} rows={3} maxLength={2000} />
              </Field>
            </Section>
          )}

          {tab === 1 && (
            <>
              <Section title="ที่อยู่" hint="บันทึกที่อยู่หลักของซัพพลายเออร์">
                <Field label="ที่อยู่ (เลขที่)">
                  <input {...txt('address')} maxLength={500} />
                </Field>
                <Field label="อาคาร / หมู่บ้าน">
                  <input {...txt('building')} />
                </Field>
                <Field label="หมู่">
                  <input {...txt('moo')} />
                </Field>
                <Field label="ซอย">
                  <input {...txt('soi')} />
                </Field>
                <Field label="ถนน">
                  <input {...txt('road')} />
                </Field>
                <Field label="จังหวัด">
                  <input {...txt('province')} list="th-provinces" placeholder="เลือกหรือพิมพ์" />
                  <datalist id="th-provinces">
                    {THAI_PROVINCES.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </Field>
                <Field label="อำเภอ / เขต">
                  <input {...txt('district')} />
                </Field>
                <Field label="ตำบล / แขวง">
                  <input {...txt('subdistrict')} />
                </Field>
                <Field label="รหัสไปรษณีย์">
                  <input {...txt('postcode')} inputMode="numeric" maxLength={5} />
                </Field>
                <Field label="ประเทศ">
                  <input {...txt('country')} />
                </Field>
              </Section>

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">ผู้ติดต่อ</h3>
                  <p className="text-[11px] text-slate-500">รองรับผู้ติดต่อหลายคน</p>
                </div>
                {v.contacts.map((c, i) => (
                  <div key={i} className="space-y-3 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-700">ผู้ติดต่อ {i + 1}</p>
                      {v.contacts.length > 1 && (
                        <button type="button" onClick={() => set({ contacts: v.contacts.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-red-600" title={`ลบผู้ติดต่อ ${i + 1}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="ประเภทผู้ติดต่อ">
                        <select value={c.kind} onChange={(e) => setContact(i, { kind: e.target.value as VendorContact['kind'] })} className={inputCls}>
                          {Object.entries(CONTACT_KIND_LABEL).map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {(
                        [
                          ['name', 'ชื่อผู้ติดต่อ'],
                          ['position', 'ตำแหน่ง'],
                          ['department', 'แผนก'],
                          ['phone', 'โทรศัพท์'],
                          ['mobile', 'มือถือ'],
                          ['email', 'อีเมล'],
                          ['lineId', 'LINE ID'],
                        ] as const
                      ).map(([k, l]) => (
                        <Field key={k} label={l}>
                          <input value={c[k]} onChange={(e) => setContact(i, { [k]: e.target.value })} className={inputCls} />
                        </Field>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-700">
                      <label className="inline-flex items-center gap-1.5">
                        <input type="radio" name="primary-contact" checked={c.primary} onChange={() => setContact(i, { primary: true })} /> ตั้งเป็นรายการหลัก
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={c.receivesPo} onChange={(e) => setContact(i, { receivesPo: e.target.checked })} /> รับใบสั่งซื้อ PO
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={c.receivesAccounting} onChange={(e) => setContact(i, { receivesAccounting: e.target.checked })} /> รับเอกสารบัญชี
                      </label>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => set({ contacts: [...v.contacts, emptyContact(v.contacts.length === 0)] })} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#2453d4] px-3 py-1.5 text-xs font-medium text-[#2453d4] hover:bg-blue-50">
                  <Plus className="h-3.5 w-3.5" /> เพิ่มผู้ติดต่อ
                </button>
              </section>
            </>
          )}

          {tab === 2 && (
            <>
              <Section title="ข้อมูลภาษี" hint="ตรวจเลขประจำตัวผู้เสียภาษีร่วมกับเลขที่สาขา">
                <Field label="ประเภทผู้เสียภาษี" required>
                  <select {...txt('type')}>
                    <option value="COMPANY">นิติบุคคล (ภ.ง.ด.53)</option>
                    <option value="INDIVIDUAL">บุคคลธรรมดา (ภ.ง.ด.3)</option>
                  </select>
                </Field>
                <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)">
                  <input {...txt('taxId')} inputMode="numeric" maxLength={13} />
                </Field>
                <Field label="ประเภทสาขา">
                  <select
                    value={v.branchType}
                    onChange={(e) => set({ branchType: e.target.value as 'HQ' | 'BRANCH', branch: e.target.value === 'HQ' ? '00000' : v.branch })}
                    className={inputCls}
                  >
                    <option value="HQ">สำนักงานใหญ่</option>
                    <option value="BRANCH">สาขา</option>
                  </select>
                </Field>
                <Field label="เลขที่สาขา (5 หลัก)">
                  <input {...txt('branch')} disabled={v.branchType === 'HQ'} inputMode="numeric" maxLength={5} className={`${inputCls} disabled:bg-slate-100`} />
                </Field>
                <label className="flex items-center gap-2 pt-5 text-xs font-semibold text-slate-700">
                  <input type="checkbox" checked={v.vatRegistered} onChange={(e) => set({ vatRegistered: e.target.checked })} /> จดทะเบียน VAT
                </label>
                <Field label="อัตรา VAT เริ่มต้น (%)">
                  <input type="number" min={0} max={100} value={v.defaultVatRate} onChange={(e) => set({ defaultVatRate: Number(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="ประเภทภาษีหัก ณ ที่จ่าย">
                  <input {...txt('whtIncomeType')} placeholder="เช่น ค่าจ้างทำของ / ค่าบริการ / ค่าขนส่ง" />
                </Field>
                <Field label="อัตราหัก ณ ที่จ่าย (%)">
                  <select value={v.defaultWhtRate} onChange={(e) => set({ defaultWhtRate: Number(e.target.value) })} className={inputCls}>
                    {WHT_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ชื่อสำหรับออกใบกำกับภาษี" wide>
                  <input {...txt('taxInvoiceName')} />
                </Field>
              </Section>

              <Section title="เงื่อนไขจัดซื้อและชำระเงิน" hint="ข้อมูลเหล่านี้จะใช้เป็นค่าเริ่มต้นในหน้า PO">
                <Field label="หมวดหมู่ผู้ขาย">
                  <select {...txt('category')}>
                    <option value="">ยังไม่ได้ระบุ</option>
                    {Object.entries(VENDOR_CATEGORY_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="หมวดสินค้า / บริการ">
                  <input {...txt('productCategory')} />
                </Field>
                <Field label="แบรนด์">
                  <input {...txt('brand')} />
                </Field>
                <Field label="ระยะเวลาจัดส่ง (วัน)">
                  <input type="number" min={0} {...txt('leadTimeDays')} />
                </Field>
                <Field label="จำนวนสั่งซื้อขั้นต่ำ">
                  <input type="number" min={0} step="0.001" {...txt('minOrderQty')} />
                </Field>
                <Field label="ยอดสั่งซื้อขั้นต่ำ (บาท)">
                  <input type="number" min={0} step="0.01" {...txt('minOrderValue')} />
                </Field>
                <Field label="ส่วนลดเริ่มต้น (บาท)">
                  <input type="number" min={0} step="0.01" {...txt('defaultDiscount')} />
                </Field>
                <Field label="สกุลเงิน">
                  <select {...txt('currency')}>
                    {['THB', 'USD', 'EUR', 'CNY', 'JPY'].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="รูปแบบ VAT">
                  <select {...txt('vatMode')}>
                    <option value="INCLUSIVE">รวม VAT</option>
                    <option value="EXCLUSIVE">ไม่รวม VAT</option>
                    <option value="NONE">ไม่มี VAT</option>
                  </select>
                </Field>
                <Field label="เงื่อนไขการจัดส่ง">
                  <input {...txt('deliveryTerms')} />
                </Field>
                <Field label="พื้นที่ให้บริการ">
                  <input {...txt('serviceArea')} />
                </Field>
                <label className="flex items-center gap-2 pt-5 text-xs font-semibold text-slate-700">
                  <input type="checkbox" checked={v.recommended} onChange={(e) => set({ recommended: e.target.checked })} /> ซัพพลายเออร์แนะนำ
                </label>
                <Field label="วิธีชำระเงิน">
                  <select value={v.defaultPayMethod} onChange={(e) => set({ defaultPayMethod: e.target.value as PayMethod })} className={inputCls}>
                    {PAY_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAY_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="เครดิต (วัน)">
                  <input type="number" min={0} {...txt('defaultCreditDays')} />
                </Field>
                <Field label="เงื่อนไขการชำระเงิน" wide>
                  <input {...txt('paymentTerms')} placeholder="เช่น ชำระภายใน 30 วันหลังวางบิล" />
                </Field>
                <PaymentTermsFields
                  value={{ billingSchedule: v.billingSchedule, creditBasis: v.creditBasis, chequeSchedule: v.chequeSchedule, payMethod: v.defaultPayMethod }}
                  onChange={(t) => set({ billingSchedule: t.billingSchedule, creditBasis: t.creditBasis, chequeSchedule: t.chequeSchedule })}
                  inputClass={inputCls}
                  hidePayMethod
                />
                <Field label="วงเงินเครดิต (บาท)">
                  <input type="number" min={0} step="0.01" {...txt('creditLimit')} />
                </Field>
                <label className="flex items-center gap-2 pt-5 text-xs font-semibold text-slate-700">
                  <input type="checkbox" checked={v.depositRequired} onChange={(e) => set({ depositRequired: e.target.checked })} /> ต้องมีเงินมัดจำ
                </label>
                {v.depositRequired && (
                  <Field label="เปอร์เซ็นต์มัดจำ">
                    <input type="number" min={0} max={100} step="0.01" {...txt('depositPercent')} />
                  </Field>
                )}
              </Section>
            </>
          )}

          {tab === 3 && (
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">บัญชีธนาคาร</h3>
                <p className="text-[11px] text-slate-500">บัญชีหลักมีได้เพียงหนึ่งบัญชี ใช้แสดงในใบสำคัญจ่าย และการแก้ไขจะถูกบันทึกในประวัติ</p>
              </div>
              {v.bankAccounts.map((b, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-700">บัญชี {i + 1}</p>
                    {v.bankAccounts.length > 1 && (
                      <button type="button" onClick={() => set({ bankAccounts: v.bankAccounts.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-red-600" title={`ลบบัญชี ${i + 1}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="ธนาคาร">
                      <select value={b.bank} onChange={(e) => setBank(i, { bank: e.target.value })} className={inputCls}>
                        <option value="">เลือกธนาคาร</option>
                        {b.bank && !(THAI_BANKS as readonly string[]).includes(b.bank) && <option value={b.bank}>{b.bank}</option>}
                        {THAI_BANKS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="สาขาธนาคาร">
                      <input value={b.branch} onChange={(e) => setBank(i, { branch: e.target.value })} className={inputCls} />
                    </Field>
                    <Field label="ชื่อบัญชี">
                      <input value={b.accountName} onChange={(e) => setBank(i, { accountName: e.target.value })} className={inputCls} />
                    </Field>
                    <Field label="เลขที่บัญชี">
                      <input value={b.accountNo} onChange={(e) => setBank(i, { accountNo: e.target.value })} inputMode="numeric" className={inputCls} />
                    </Field>
                    <Field label="ประเภทบัญชี">
                      <select value={b.accountType} onChange={(e) => setBank(i, { accountType: e.target.value })} className={inputCls}>
                        {BANK_ACCOUNT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="พร้อมเพย์">
                      <input value={b.promptPay} onChange={(e) => setBank(i, { promptPay: e.target.value })} placeholder="เลขบัตรประชาชน / เบอร์โทร" className={inputCls} />
                    </Field>
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                    <input type="radio" name="primary-bank" checked={b.primary} onChange={() => setBank(i, { primary: true })} /> ตั้งเป็นรายการหลัก
                  </label>
                </div>
              ))}
              <button type="button" onClick={() => set({ bankAccounts: [...v.bankAccounts, emptyBankAccount(v.bankAccounts.length === 0)] })} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#2453d4] px-3 py-1.5 text-xs font-medium text-[#2453d4] hover:bg-blue-50">
                <Plus className="h-3.5 w-3.5" /> เพิ่มบัญชีธนาคาร
              </button>
              <p className="text-[11px] text-slate-500">ไฟล์หน้าสมุดบัญชีแนบได้ที่แท็บ &quot;เอกสารแนบ&quot;</p>
            </section>
          )}

          {tab === 4 &&
            (vendorId && attachments ? (
              <AttachmentsBox entityType="VENDOR" entityId={vendorId} items={attachments} />
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                บันทึกซัพพลายเออร์ก่อน แล้วจึงแนบไฟล์ได้ เช่น หน้าสมุดบัญชี, ภ.พ.20, หนังสือรับรองบริษัท
              </p>
            ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 text-xs">
          {error && (
            <p role="alert" className="mr-auto font-medium text-rose-600">
              {error}
            </p>
          )}
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:bg-slate-100">
            ยกเลิก
          </button>
          <button type="button" disabled={pending} onClick={save} className="rounded-lg bg-[#2453d4] px-4 py-2 font-semibold text-white shadow-sm hover:bg-[#1c43ab] disabled:opacity-60">
            {pending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
