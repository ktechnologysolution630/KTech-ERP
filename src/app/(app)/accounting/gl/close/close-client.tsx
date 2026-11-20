'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closePeriodAction, closeYearAction, reopenLatestAction } from './actions';

const btn = 'rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50';
const field = 'rounded-md border border-slate-300 px-2 py-1.5 text-xs';

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    });
  return { pending, msg, run };
}

const Msg = ({ msg }: { msg: { ok: boolean; text: string } | null }) =>
  msg ? <p className={`text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p> : null;

export function ClosePeriodForm({ defaultMonth }: { defaultMonth: string }) {
  const { pending, msg, run } = useAction();
  const [month, setMonth] = useState(defaultMonth);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-600">
          ปิดงวดถึงสิ้นเดือน <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={field} />
        </label>
        <button
          type="button"
          disabled={pending || !month}
          onClick={() => {
            if (window.confirm(`ปิดงวดถึงสิ้นเดือน ${month}? เอกสารที่ลงวันที่ในงวดนี้จะแก้ไขหรือยกเลิกไม่ได้`)) run(() => closePeriodAction(`${month}-01`));
          }}
          className={`${btn} bg-slate-800 text-white`}
        >
          ปิดงวด
        </button>
      </div>
      <Msg msg={msg} />
    </div>
  );
}

export function CloseYearForm({ year, netProfit }: { year: number; netProfit: number }) {
  const { pending, msg, run } = useAction();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`ปิดบัญชีปี ${year}? ระบบจะโอนรายได้และค่าใช้จ่ายเข้ากำไร(ขาดทุน)สะสม และปิดงวดถึง 31/12/${year}`)) run(() => closeYearAction(year));
        }}
        className={`${btn} bg-[#2453d4] text-white`}
      >
        ปิดบัญชีสิ้นปี {year} ({netProfit >= 0 ? 'กำไร' : 'ขาดทุน'} {Math.abs(netProfit).toLocaleString('th-TH', { minimumFractionDigits: 2 })})
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function ReopenForm() {
  const { pending, msg, run } = useAction();
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่เปิดงวด" aria-label="เหตุผลที่เปิดงวด" className={`${field} w-64`} />
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() => {
            if (window.confirm('เปิดงวดล่าสุดที่ปิดไว้? ถ้าเป็นการปิดสิ้นปี รายการปิดบัญชีจะถูกยกเลิกด้วย')) run(() => reopenLatestAction(reason));
          }}
          className={`${btn} border border-red-200 bg-red-50 text-red-700`}
        >
          เปิดงวดล่าสุด
        </button>
      </div>
      <Msg msg={msg} />
    </div>
  );
}
