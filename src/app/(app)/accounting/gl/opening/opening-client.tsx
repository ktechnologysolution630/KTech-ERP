'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { formatMoneyDisplay } from '@/domain/money';
import {
  addApOpeningAction,
  addArOpeningAction,
  removeApOpeningAction,
  removeArOpeningAction,
  saveOpeningEntryAction,
} from './actions';
import { SearchSelect } from '@/components/search-select';

const field = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none';
const money = (v: number) => formatMoneyDisplay(v.toFixed(2));
const btn = 'inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-white disabled:opacity-50';

type Account = { id: string; code: string; name: string };
type Line = { key: number; accountId: string; debit: string; credit: string };

/** ยอดบัญชียกมา: one balance per account; debits must equal credits */
export function OpeningEntryEditor({
  accounts,
  initial,
  canManage,
}: {
  accounts: Account[];
  initial: { date: string; lines: { accountId: string; debit: number; credit: number }[] };
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [date, setDate] = useState(initial.date);
  const [lines, setLines] = useState<Line[]>(() =>
    (initial.lines.length ? initial.lines : [{ accountId: '', debit: 0, credit: 0 }]).map((l, i) => ({
      key: i,
      accountId: l.accountId,
      debit: l.debit ? String(l.debit) : '',
      credit: l.credit ? String(l.credit) : '',
    })),
  );
  const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = Math.round((debit - credit) * 100) / 100;
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        วันที่ยอดยกมา
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canManage} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
      </label>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="text-slate-500">
            <tr className="border-b border-slate-200 text-left">
              <th className="py-1.5 pr-2 font-medium">บัญชี</th>
              <th className="w-36 py-1.5 pr-2 text-right font-medium">เดบิต</th>
              <th className="w-36 py-1.5 pr-2 text-right font-medium">เครดิต</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-slate-100">
                <td className="py-1 pr-2">
                  <SearchSelect value={l.accountId} onChange={(e) => set(l.key, { accountId: e.target.value })} disabled={!canManage} aria-label="บัญชี" className={field}>
                    <option value="">— เลือกบัญชี —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </SearchSelect>
                </td>
                <td className="py-1 pr-2">
                  <input type="number" step="0.01" min="0" value={l.debit} onChange={(e) => set(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} disabled={!canManage} aria-label="เดบิต" className={`${field} text-right`} />
                </td>
                <td className="py-1 pr-2">
                  <input type="number" step="0.01" min="0" value={l.credit} onChange={(e) => set(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} disabled={!canManage} aria-label="เครดิต" className={`${field} text-right`} />
                </td>
                <td className="py-1 text-right">
                  {canManage && (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="ลบบรรทัด" className="text-slate-400 hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2 pr-2 text-right">รวม</td>
              <td className="py-2 pr-2 text-right tabular-nums">{money(debit)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{money(credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {diff !== 0 && <p className="text-xs text-rose-600">ยังไม่สมดุล ต่างกัน {money(Math.abs(diff))} บาท (ส่วนต่างมักลงบัญชี 3200 กำไรสะสม)</p>}
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((x) => x.key)) + 1, accountId: '', debit: '', credit: '' }])} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
            <Plus className="h-3.5 w-3.5" /> เพิ่มบรรทัด
          </button>
          <button
            type="button"
            disabled={pending || diff !== 0}
            onClick={() =>
              start(async () => {
                const r = await saveOpeningEntryAction({
                  date,
                  lines: lines.filter((l) => l.accountId && (Number(l.debit) || Number(l.credit))).map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
                });
                setMsg(r.ok ? { ok: true, text: 'บันทึกยอดยกมาแล้ว' } : { ok: false, text: r.error });
                router.refresh();
              })
            }
            className={btn}
          >
            บันทึกยอดยกมา
          </button>
        </div>
      )}
    </div>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setError(null);
        onOk?.();
      } else setError(r.error);
      router.refresh();
    });
  return { pending, error, run };
}

/** ลูกหนี้คงค้างยกมา */
export function ArOpeningForm({ customers, defaultDate }: { customers: { id: string; code: string; name: string }[]; defaultDate: string }) {
  const { pending, error, run } = useRun();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        run(
          () =>
            addArOpeningAction({
              customerId: String(fd.get('customerId')),
              number: String(fd.get('number')),
              docDate: String(fd.get('docDate')),
              dueDate: String(fd.get('dueDate')),
              gross: Number(fd.get('gross')),
              note: String(fd.get('note') ?? ''),
            }),
          () => form.reset(),
        );
      }}
      className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs sm:grid-cols-6"
    >
      <SearchSelect name="customerId" required aria-label="ลูกค้า" className={`${field} col-span-2`}>
        <option value="">— ลูกค้า —</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} {c.name}
          </option>
        ))}
      </SearchSelect>
      <input name="number" required placeholder="เลขที่บิลเดิม" aria-label="เลขที่บิลเดิม" className={field} />
      <input name="docDate" type="date" required defaultValue={defaultDate} aria-label="วันที่บิล" className={field} />
      <input name="dueDate" type="date" required defaultValue={defaultDate} aria-label="ครบกำหนด" className={field} />
      <input name="gross" type="number" step="0.01" min="0.01" required placeholder="ยอดค้าง" aria-label="ยอดค้าง" className={`${field} text-right`} />
      <input name="note" placeholder="หมายเหตุ" aria-label="หมายเหตุ" className={`${field} col-span-2 sm:col-span-5`} />
      <button type="submit" disabled={pending} className={btn}>
        <Plus className="h-3.5 w-3.5" /> เพิ่ม
      </button>
      {error && <p className="col-span-full text-rose-600">{error}</p>}
    </form>
  );
}

/** เจ้าหนี้คงค้างยกมา */
export function ApOpeningForm({ vendors, defaultDate }: { vendors: { id: string; code: string; name: string }[]; defaultDate: string }) {
  const { pending, error, run } = useRun();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        run(
          () =>
            addApOpeningAction({
              vendorId: String(fd.get('vendorId')),
              docNo: String(fd.get('docNo')),
              dueDate: String(fd.get('dueDate')),
              gross: Number(fd.get('gross')),
              vat: Number(fd.get('vat') || 0),
            }),
          () => form.reset(),
        );
      }}
      className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs sm:grid-cols-6"
    >
      <SearchSelect name="vendorId" required aria-label="ผู้ขาย" className={`${field} col-span-2`}>
        <option value="">— ผู้ขาย —</option>
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>
            {v.code} {v.name}
          </option>
        ))}
      </SearchSelect>
      <input name="docNo" required placeholder="เลขที่บิลเดิม" aria-label="เลขที่บิลเดิม" className={field} />
      <input name="dueDate" type="date" required defaultValue={defaultDate} aria-label="ครบกำหนด" className={field} />
      <input name="gross" type="number" step="0.01" min="0.01" required placeholder="ยอดค้างรวม VAT" aria-label="ยอดค้างรวม VAT" className={`${field} text-right`} />
      <input name="vat" type="number" step="0.01" min="0" placeholder="VAT ในยอด" aria-label="VAT ในยอด" className={`${field} text-right`} />
      <button type="submit" disabled={pending} className={`${btn} sm:col-start-6`}>
        <Plus className="h-3.5 w-3.5" /> เพิ่ม
      </button>
      {error && <p className="col-span-full text-rose-600">{error}</p>}
    </form>
  );
}

export function RemoveOpeningButton({ id, kind }: { id: string; kind: 'AR' | 'AP' }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-rose-600">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm('ลบรายการยกมานี้?')) run(() => (kind === 'AR' ? removeArOpeningAction(id) : removeApOpeningAction(id)));
        }}
        aria-label="ลบ"
        className="text-slate-400 hover:text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
