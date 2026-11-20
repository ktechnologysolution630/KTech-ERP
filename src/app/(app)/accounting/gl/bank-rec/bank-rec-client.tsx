'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoneyDisplay } from '@/domain/money';
import type { BankRecView } from '@/server/services/bank-rec';
import { saveBankRecAction, undoBankRecAction } from './actions';

const money = (v: number) => formatMoneyDisplay(v.toFixed(2));
const r2 = (v: number) => Math.round(v * 100) / 100;

export function BankRecClient({ view, canManage }: { view: BankRecView; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [statement, setStatement] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const tickedSum = useMemo(() => r2(view.open.filter((l) => ticked.has(l.id)).reduce((s, l) => s + l.amount, 0)), [ticked, view.open]);
  const reconciled = r2(view.reconciledBalance + tickedSum);
  const statementNum = statement === '' ? null : Number(statement);
  const diff = statementNum === null ? null : r2(statementNum - reconciled);
  const outstanding = view.open.filter((l) => !ticked.has(l.id));
  const toggle = (id: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box label="ยอดตามบัญชี (Book)" value={money(view.bookBalance)} />
        <Box label="กระทบยอดแล้ว + ที่เลือก" value={money(reconciled)} />
        <label className="rounded-xl border border-slate-200 bg-white p-3">
          <span className="text-xs text-slate-500">ยอดตาม Statement ธนาคาร</span>
          <input type="number" step="0.01" value={statement} onChange={(e) => setStatement(e.target.value)} disabled={!canManage} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" />
        </label>
        <Box label="ผลต่าง" value={diff === null ? '-' : money(diff)} tone={diff === null ? undefined : diff === 0 ? 'green' : 'red'} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr className="text-left">
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="เลือกทั้งหมด"
                  disabled={!canManage || view.open.length === 0}
                  checked={view.open.length > 0 && ticked.size === view.open.length}
                  onChange={(e) => setTicked(e.target.checked ? new Set(view.open.map((l) => l.id)) : new Set())}
                />
              </th>
              <th className="px-2 py-2 font-medium">วันที่</th>
              <th className="px-2 py-2 font-medium">เอกสาร</th>
              <th className="px-2 py-2 font-medium">รายการ</th>
              <th className="px-2 py-2 text-right font-medium">ฝาก/รับ</th>
              <th className="px-3 py-2 text-right font-medium">ถอน/จ่าย</th>
            </tr>
          </thead>
          <tbody>
            {view.open.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  ไม่มีรายการค้างกระทบยอดถึงวันที่นี้
                </td>
              </tr>
            )}
            {view.open.map((l) => (
              <tr key={l.id} className={`border-t border-slate-100 ${ticked.has(l.id) ? 'bg-emerald-50' : ''}`}>
                <td className="px-3 py-1.5">
                  <input type="checkbox" aria-label={`เลือก ${l.number}`} disabled={!canManage} checked={ticked.has(l.id)} onChange={() => toggle(l.id)} />
                </td>
                <td className="px-2 py-1.5">{l.date}</td>
                <td className="px-2 py-1.5 font-medium">{l.number}</td>
                <td className="px-2 py-1.5">
                  {l.description}
                  {l.partyName && <span className="block text-[10px] text-slate-400">{l.partyName}</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.amount > 0 ? money(l.amount) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.amount < 0 ? money(-l.amount) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {outstanding.length > 0 && ticked.size > 0 && (
        <p className="text-xs text-slate-500">
          รายการที่ยังไม่ติ๊ก {outstanding.length} รายการ จะถือเป็นรายการระหว่างทาง (เช็คยังไม่ขึ้นเงิน / เงินฝากยังไม่เข้า) และไปรอกระทบใน Statement ถัดไป
        </p>
      )}
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || diff !== 0}
            onClick={() =>
              start(async () => {
                const r = await saveBankRecAction({ accountId: view.account.id, statementDate: view.statementDate, statementBalance: statementNum ?? 0, lineIds: [...ticked] });
                setMsg(r.ok ? { ok: true, text: 'บันทึกการกระทบยอดแล้ว' } : { ok: false, text: r.error });
                if (r.ok) {
                  setTicked(new Set());
                  setStatement('');
                }
                router.refresh();
              })
            }
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            บันทึกการกระทบยอด
          </button>
          {view.lastStatement && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`ยกเลิกการกระทบยอด Statement ${view.lastStatement!.date}?`)) return;
                start(async () => {
                  const r = await undoBankRecAction(view.account.id);
                  setMsg(r.ok ? { ok: true, text: 'ยกเลิกการกระทบยอดล่าสุดแล้ว' } : { ok: false, text: r.error });
                  router.refresh();
                });
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs text-slate-700"
            >
              ยกเลิก Statement ล่าสุด ({view.lastStatement.date})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Box({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
