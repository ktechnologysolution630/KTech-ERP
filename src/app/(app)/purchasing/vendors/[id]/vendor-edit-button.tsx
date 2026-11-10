'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X } from 'lucide-react';
import { WHT_RATES } from '@/domain/money';
import { type CreditBasis, type PayMethod } from '@/domain/payment-terms';
import { PaymentTermsFields } from '@/components/payment-terms-fields';
import { updateVendorAction } from './actions';

export interface VendorFormValues {
  id: string;
  name: string;
  type: 'COMPANY' | 'INDIVIDUAL';
  taxId: string | null;
  branch: string;
  address: string;
  altAddress: string;
  contactPerson: string;
  phone: string;
  email: string;
  fax: string;
  suppliedItems: string;
  defaultCreditDays: number;
  defaultWhtRate: number;
  billingSchedule: string;
  creditBasis: CreditBasis;
  chequeSchedule: string;
  defaultPayMethod: PayMethod;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
}

const inputClass = 'w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none';

function TextField({ label, name, value, wide, required, maxLength }: { label: string; name: keyof VendorFormValues; value: string | null; wide?: boolean; required?: boolean; maxLength?: number }) {
  return (
    <label className={`block font-semibold text-slate-700 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}
      {required && <span className="text-red-500"> *</span>}
      <input name={name} defaultValue={value ?? ''} required={required} maxLength={maxLength} className={`${inputClass} mt-1 font-normal`} />
    </label>
  );
}

export function VendorEditButton({ vendor: v }: { vendor: VendorFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await updateVendorAction(v.id, new FormData(e.currentTarget));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1c43ab]"
      >
        <Pencil className="h-4 w-4" />
        แก้ไขข้อมูล
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-sm font-bold text-slate-900">แก้ไขข้อมูลผู้ขาย</h3>
              <button type="button" aria-label="ปิด" onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={save} className="text-xs">
              <div className="grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
                <TextField label="ชื่อผู้ขาย" name="name" value={v.name} wide required maxLength={300} />
                <label className="block font-semibold text-slate-700">
                  ประเภท
                  <select name="type" defaultValue={v.type} className={`${inputClass} mt-1 font-normal`}>
                    <option value="COMPANY">นิติบุคคล (ภ.ง.ด.53)</option>
                    <option value="INDIVIDUAL">บุคคลธรรมดา (ภ.ง.ด.3)</option>
                  </select>
                </label>
                <TextField label="ผู้ติดต่อ" name="contactPerson" value={v.contactPerson} maxLength={200} />
                <TextField label="เลขประจำตัวประชาชน / ผู้เสียภาษี (13 หลัก)" name="taxId" value={v.taxId} maxLength={13} />
                <TextField label="สาขา (5 หลัก)" name="branch" value={v.branch} maxLength={5} />
                <TextField label="ที่อยู่" name="address" value={v.address} wide maxLength={500} />
                <TextField label="ที่อยู่สำรอง" name="altAddress" value={v.altAddress} wide maxLength={500} />
                <TextField label="โทร / MOBILE" name="phone" value={v.phone} maxLength={200} />
                <TextField label="E-Mail" name="email" value={v.email} maxLength={200} />
                <TextField label="FAX" name="fax" value={v.fax} maxLength={100} />
                <label className="block font-semibold text-slate-700">
                  เครดิต (วัน)
                  <input name="defaultCreditDays" type="number" min={0} step={1} required defaultValue={v.defaultCreditDays} className={`${inputClass} mt-1 font-normal`} />
                </label>
                <label className="block font-semibold text-slate-700">
                  หัก ณ ที่จ่าย
                  <select name="defaultWhtRate" defaultValue={v.defaultWhtRate} className={`${inputClass} mt-1 font-normal`}>
                    {WHT_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}%
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 font-bold text-slate-800">เงื่อนไขวางบิล / รับเช็ค</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <PaymentTermsFields
                      value={{ billingSchedule: v.billingSchedule, creditBasis: v.creditBasis, chequeSchedule: v.chequeSchedule, payMethod: v.defaultPayMethod }}
                      names={{ billingSchedule: 'billingSchedule', creditBasis: 'creditBasis', chequeSchedule: 'chequeSchedule', payMethod: 'defaultPayMethod' }}
                      inputClass={inputClass}
                    />
                  </div>
                </div>
                <TextField label="ธนาคาร" name="bankName" value={v.bankName} />
                <TextField label="เลขที่บัญชี" name="bankAccountNo" value={v.bankAccountNo} />
                <TextField label="ชื่อบัญชี" name="bankAccountName" value={v.bankAccountName} wide />
                <label className="block font-semibold text-slate-700 sm:col-span-2">
                  รายการสินค้า
                  <textarea name="suppliedItems" rows={3} maxLength={2000} defaultValue={v.suppliedItems} className={`${inputClass} mt-1 font-normal`} />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
                {error && <p className="mr-auto text-rose-600">{error}</p>}
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 font-medium text-slate-600 transition hover:bg-slate-100">
                  ยกเลิก
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-[#2453d4] px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-[#1c43ab] disabled:opacity-60">
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
