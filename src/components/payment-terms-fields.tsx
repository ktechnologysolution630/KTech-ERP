'use client';

import { useState } from 'react';
import {
  CREDIT_BASES,
  CREDIT_BASIS_LABEL,
  PAY_METHOD_LABEL,
  PAY_METHODS,
  WEEKDAY_LABEL,
  formatSchedule,
  parseSchedule,
  type CreditBasis,
  type PayMethod,
  type Schedule,
} from '@/domain/payment-terms';

const DEFAULT_INPUT = 'w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none';

/**
 * Picks a day schedule: any day, days of the month ("5, 20") or weekdays.
 * Keeps the stored form ('', 'M:5,20', 'W:1') in a hidden input named `name`, or reports it through onChange.
 */
export function ScheduleField({
  label,
  name,
  value,
  onChange,
  anyLabel = 'ทุกวัน (ไม่กำหนดรอบ)',
  inputClass = DEFAULT_INPUT,
}: {
  label: string;
  name?: string;
  value: string;
  onChange?: (v: string) => void;
  anyLabel?: string;
  inputClass?: string;
}) {
  const initial = parseSchedule(value);
  const [kind, setKind] = useState<Schedule['kind']>(initial.kind);
  const [monthText, setMonthText] = useState(initial.kind === 'MONTH_DAYS' ? initial.days.join(', ') : '');
  const [weekdays, setWeekdays] = useState<number[]>(initial.kind === 'WEEKDAYS' ? initial.days : []);

  const build = (k: Schedule['kind'], mt: string, wd: number[]): string => {
    if (k === 'MONTH_DAYS') {
      const days = mt
        .split(/[,\s]+/)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
      return days.length ? formatSchedule({ kind: 'MONTH_DAYS', days: [...new Set(days)].sort((a, b) => a - b) }) : '';
    }
    if (k === 'WEEKDAYS') return wd.length ? formatSchedule({ kind: 'WEEKDAYS', days: [...wd].sort((a, b) => a - b) }) : '';
    return '';
  };
  const current = build(kind, monthText, weekdays);
  const update = (k: Schedule['kind'], mt: string, wd: number[]) => {
    setKind(k);
    setMonthText(mt);
    setWeekdays(wd);
    onChange?.(build(k, mt, wd));
  };

  return (
    <div className="block font-semibold text-slate-700">
      {label}
      {name && <input type="hidden" name={name} value={current} />}
      <div className="mt-1 flex flex-col gap-1.5 font-normal">
        <select value={kind} onChange={(e) => update(e.target.value as Schedule['kind'], monthText, weekdays)} className={inputClass} aria-label={`${label}: แบบ`}>
          <option value="ANY">{anyLabel}</option>
          <option value="MONTH_DAYS">ระบุวันที่ของเดือน</option>
          <option value="WEEKDAYS">ระบุวันในสัปดาห์</option>
        </select>
        {kind === 'MONTH_DAYS' && (
          <input
            value={monthText}
            onChange={(e) => update(kind, e.target.value, weekdays)}
            placeholder="เช่น 25 หรือ 5, 20 (31 = สิ้นเดือน)"
            aria-label={`${label}: วันที่`}
            className={inputClass}
          />
        )}
        {kind === 'WEEKDAYS' && (
          <div className="flex flex-wrap gap-1" role="group" aria-label={`${label}: วันในสัปดาห์`}>
            {WEEKDAY_LABEL.map((d, i) => {
              const on = weekdays.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update(kind, monthText, on ? weekdays.filter((x) => x !== i) : [...weekdays, i])}
                  className={`rounded-md border px-2 py-1 text-[11px] ${on ? 'border-[#2453d4] bg-[#2453d4] text-white' : 'border-slate-300 bg-white text-slate-600'}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}
        {kind !== 'ANY' && !current && <span className="text-[11px] text-amber-700">ยังไม่ได้เลือกวัน ระบบจะถือว่าเป็นทุกวัน</span>}
      </div>
    </div>
  );
}

export interface PaymentTermsValue {
  billingSchedule: string;
  creditBasis: CreditBasis;
  chequeSchedule: string;
  payMethod: PayMethod;
}

/**
 * Billing day, what credit counts from, cheque day and the usual way to pay.
 * Uncontrolled (hidden inputs with `names`) for plain forms, or controlled through onChange.
 */
export function PaymentTermsFields({
  value,
  onChange,
  names,
  inputClass = DEFAULT_INPUT,
  hidePayMethod = false,
}: {
  /** The PO asks for the pay method in its own footer */
  hidePayMethod?: boolean;
  value: PaymentTermsValue;
  onChange?: (v: PaymentTermsValue) => void;
  /** Form field names; leave out for a controlled use */
  names?: { billingSchedule: string; creditBasis: string; chequeSchedule: string; payMethod: string };
  inputClass?: string;
}) {
  const [v, setV] = useState(value);
  const set = (patch: Partial<PaymentTermsValue>) => {
    const next = { ...v, ...patch };
    setV(next);
    onChange?.(next);
  };
  return (
    <>
      <ScheduleField label="รอบวางบิล" name={names?.billingSchedule} value={v.billingSchedule} onChange={(s) => set({ billingSchedule: s })} anyLabel="วางบิลได้ทุกวัน" inputClass={inputClass} />
      <label className="block font-semibold text-slate-700">
        เริ่มนับเครดิต
        <select name={names?.creditBasis} value={v.creditBasis} onChange={(e) => set({ creditBasis: e.target.value as CreditBasis })} className={`${inputClass} mt-1 font-normal`}>
          {CREDIT_BASES.map((b) => (
            <option key={b} value={b}>
              {CREDIT_BASIS_LABEL[b]}
            </option>
          ))}
        </select>
      </label>
      <ScheduleField label="รอบรับเช็ค / รอบจ่าย" name={names?.chequeSchedule} value={v.chequeSchedule} onChange={(s) => set({ chequeSchedule: s })} anyLabel="ไม่กำหนดรอบ" inputClass={inputClass} />
      {!hidePayMethod && (
      <label className="block font-semibold text-slate-700">
        วิธีจ่ายตั้งต้น
        <select name={names?.payMethod} value={v.payMethod} onChange={(e) => set({ payMethod: e.target.value as PayMethod })} className={`${inputClass} mt-1 font-normal`}>
          {PAY_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAY_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      )}
    </>
  );
}
