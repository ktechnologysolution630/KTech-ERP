import Link from 'next/link';
import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getBankRecView, listCashAccounts, listReconciliations } from '@/server/services/bank-rec';
import { money, selectCls } from '../../shared';
import { BankRecClient } from './bank-rec-client';

export default async function BankRecPage({ searchParams }: { searchParams: Promise<{ account?: string; date?: string }> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const accounts = await listCashAccounts(db, actor);
  const account = accounts.find((a) => a.id === sp.account) ?? accounts.find((a) => a.isBank) ?? accounts[0];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : bangkokDateString();
  const [view, history] = account ? await Promise.all([getBankRecView(db, actor, account.id, date), listReconciliations(db, actor, account.id)]) : [null, []];

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <Link href="/accounting/gl" className="text-xs text-brand hover:underline">
          ← สมุดรายวันและบัญชีแยกประเภท
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">กระทบยอดเงินฝากธนาคาร</h1>
        <p className="text-xs text-slate-500">ติ๊กรายการที่ปรากฏใน Statement ของธนาคาร จนยอดตรงกัน รายการที่เหลือคือเช็คจ่ายที่ยังไม่ขึ้นเงินหรือเงินฝากระหว่างทาง</p>
      </div>
      <form className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          บัญชี
          <select name="account" defaultValue={account?.id} className={`${selectCls} ml-1`}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          วันที่ Statement
          <input type="date" name="date" defaultValue={date} className={`${selectCls} ml-1`} />
        </label>
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
          แสดง
        </button>
      </form>
      {view ? <BankRecClient key={`${view.account.id}-${date}`} view={view} canManage={can(actor, 'gl.manage')} /> : <p className="text-sm text-slate-500">ยังไม่มีบัญชีเงินสด/ธนาคารในผังบัญชี</p>}
      {history.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">ประวัติการกระทบยอด</h2>
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1.5 pr-2 font-medium">วันที่ Statement</th>
                <th className="py-1.5 pr-2 text-right font-medium">ยอด Statement</th>
                <th className="py-1.5 pr-2 text-right font-medium">ยอดตามบัญชี</th>
                <th className="py-1.5 pr-2 text-right font-medium">รายการ</th>
                <th className="py-1.5 pr-2 font-medium">ผู้บันทึก</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2">{h.statementDate}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{money(h.statementBalance)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{money(h.bookBalance)}</td>
                  <td className="py-1.5 pr-2 text-right">{h.lines}</td>
                  <td className="py-1.5 pr-2">{h.by ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
