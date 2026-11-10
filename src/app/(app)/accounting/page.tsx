import Link from 'next/link';
import { getDb } from '@/db/client';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { getAccountingOverview } from '@/server/services/accounting';
import { listProjects } from '@/server/services/master';
import { money, selectCls, Stat, THAI_MONTHS } from './shared';

export default async function AccountingOverviewPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const today = bangkokDateString();
  const projectId = sp.projectId === 'OFFICE' ? null : sp.projectId || undefined;
  const [o, projects] = await Promise.all([getAccountingOverview(db, actor, { today, projectId }), listProjects(db, actor)]);
  const max = Math.max(1, ...o.byMonth.flatMap((m) => [m.income, m.expense]));
  const tab = sp.tab === 'OUT' ? 'OUT' : 'IN';
  const recent = o.recent.filter((r) => r.direction === tab).slice(0, 10);
  const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const catTotal = o.categories.reduce((s, c) => s + c.amount, 0) || 1;
  const q = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(sp.projectId ? { projectId: sp.projectId } : {}), ...extra })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">ภาพรวมบัญชี</h1>
        <form className="flex items-center gap-2">
          <select name="projectId" defaultValue={sp.projectId ?? ''} aria-label="โครงการ" className={selectCls}>
            <option value="">ทุกโครงการ</option>
            <option value="OFFICE">สำนักงาน / ส่วนกลาง</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-[#2453d4] px-3 py-2 text-xs font-semibold text-white">แสดง</button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="รายรับเดือนนี้" value={money(o.thisMonth.income)} sub={`${pct(o.incomeChange)} จากเดือนก่อน`} tone="green" />
        <Stat label="รายจ่ายเดือนนี้" value={money(o.thisMonth.expense)} sub={`${pct(o.expenseChange)} จากเดือนก่อน`} tone="red" />
        <Stat label="ลูกหนี้ค้างรับ" value={money(o.arOutstanding)} sub="AR Outstanding" />
        <Stat label="เจ้าหนี้ค้างจ่าย" value={money(o.apOutstanding)} sub="AP Outstanding" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">รายรับ vs รายจ่าย (12 เดือน)</h2>
              <p className="text-[11px] text-slate-500">ยอดรับและจ่ายจริงรายเดือน (หลังหัก ณ ที่จ่าย)</p>
            </div>
            <p className="text-xs text-slate-600">
              YTD รายรับ <b className="text-emerald-700">{money(o.ytdIncome)}</b> · YTD รายจ่าย <b className="text-rose-600">{money(o.ytdExpense)}</b>
            </p>
          </div>
          <div className="mt-4 flex h-48 items-end gap-2" role="img" aria-label="กราฟรายรับและรายจ่าย 12 เดือน">
            {o.byMonth.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-40 w-full items-end justify-center gap-0.5">
                  <div className="w-1/2 rounded-t bg-emerald-500" style={{ height: `${(m.income / max) * 100}%` }} title={`รายรับ ${money(m.income)}`} />
                  <div className="w-1/2 rounded-t bg-rose-400" style={{ height: `${(m.expense / max) * 100}%` }} title={`รายจ่าย ${money(m.expense)}`} />
                </div>
                <span className="text-[10px] text-slate-500">{THAI_MONTHS[Number(m.month.slice(5)) - 1]!.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> รายรับ
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-rose-400" /> รายจ่าย
            </span>
          </div>
        </section>
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">กำไรสุทธิ (YTD)</h2>
            <p className={`text-2xl font-bold ${o.ytdProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{money(o.ytdProfit)}</p>
            <p className="text-xs text-slate-500">อัตรากำไร {o.margin.toFixed(1)}%</p>
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-700">ค่าใช้จ่ายตามหมวด (12 เดือน)</h3>
            {o.categories.length === 0 ? (
              <p className="text-xs text-slate-400">ยังไม่มีรายจ่าย</p>
            ) : (
              <ul className="mt-1 space-y-1.5 text-xs">
                {o.categories.slice(0, 8).map((c) => (
                  <li key={c.name}>
                    <div className="flex justify-between">
                      <span className="text-slate-600">{c.name}</span>
                      <span>{money(c.amount)}</span>
                    </div>
                    <div className="h-1.5 rounded bg-slate-100">
                      <div className="h-1.5 rounded bg-rose-400" style={{ width: `${(c.amount / catTotal) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <div className="flex gap-1 text-xs">
            {(
              [
                ['IN', 'รายรับ'],
                ['OUT', 'รายจ่าย'],
              ] as const
            ).map(([k, l]) => (
              <Link key={k} href={q({ tab: k })} className={`rounded-lg px-3 py-1.5 ${tab === k ? 'bg-[#2453d4] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                เอกสาร{l}
              </Link>
            ))}
          </div>
          <Link href="/accounting/reports" className="text-xs text-[#2453d4] hover:underline">
            ดูทั้งหมด
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead className="bg-[#102d72] text-white">
              <tr>
                {['วันที่', 'ประเภท', 'เลขที่', 'คู่ค้า', 'โครงการ', 'จำนวนเงิน'].map((h) => (
                  <th key={h} className={`px-3 py-2.5 font-medium ${h === 'จำนวนเงิน' ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    ยังไม่มีรายการ
                  </td>
                </tr>
              ) : (
                recent.map((r) => (
                  <tr key={r.key} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">{formatThaiDate(r.date)}</td>
                    <td className="px-3 py-2.5">{r.docType}</td>
                    <td className="px-3 py-2.5">
                      <Link href={r.href} className="font-mono text-[#2453d4] hover:underline">
                        {r.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{r.party || '-'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.projectName}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold ${r.direction === 'IN' ? 'text-emerald-700' : 'text-rose-600'}`}>{money(r.net)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
