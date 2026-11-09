'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, CreditCard, FileText, Plus, Receipt, Wallet } from 'lucide-react';
import { loadCashflowAction } from '@/app/(app)/projects/[id]/site-actions';
import { formatMoneyDisplay } from '@/domain/money';
import { useSiteLoader } from './project-site/use-site-loader';

interface ProjectCashflowViewProps {
  projectId: string;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DONUT_COLORS = ['#2453d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

const monthLabel = (key: string) => TH_MONTHS[Number(key.slice(5, 7)) - 1];
const thaiDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
};
const minus = (n: number) => (n > 0 ? `-${formatMoneyDisplay(n)}` : formatMoneyDisplay(0));
const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};

function KpiCard({ label, value, hint, icon, tone }: { label: string; value: number; hint: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 font-medium">{label}</span>
        <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${tone}`}>{icon}</div>
      </div>
      <div className="mt-2">
        <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900">{formatMoneyDisplay(value)}</div>
        <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
      </div>
    </div>
  );
}

export function ProjectCashflowView({ projectId }: ProjectCashflowViewProps) {
  const { data, error } = useSiteLoader(() => loadCashflowAction(projectId), [projectId]);

  if (error) {
    return <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-600">{error}</div>;
  }
  if (!data) {
    return <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-400">กำลังโหลดข้อมูลการเงินโครงการ…</div>;
  }

  const maxBar = Math.max(1, ...data.monthly.flatMap((m) => [m.income, m.expense]));
  const cumValues = data.monthly.map((m) => m.cumulative);
  const cumMax = Math.max(0, ...cumValues);
  const cumMin = Math.min(0, ...cumValues);
  const cumSpan = cumMax - cumMin || 1;
  const cumY = (v: number) => 45 - ((v - cumMin) / cumSpan) * 40;
  const cumPoints = data.monthly.map((m, i) => `${(i / 11) * 100},${cumY(m.cumulative)}`).join(' ');

  const expenseTotal = data.expenseGroups.reduce((a, g) => a + g.amount, 0);
  const CIRC = 2 * Math.PI * 14;
  // Each donut slice starts where the slices before it end
  const donutSlices = data.expenseGroups.reduce<{ len: number; offset: number }[]>((acc, g) => {
    const prev = acc[acc.length - 1];
    acc.push({ len: expenseTotal > 0 ? (g.amount / expenseTotal) * CIRC : 0, offset: prev ? prev.offset + prev.len : 0 });
    return acc;
  }, []);

  const margin = data.received > 0 ? ((data.net / data.received) * 100).toFixed(1) : null;

  return (
    <div className="space-y-4 text-xs text-slate-800">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">รายรับรายจ่ายโครงการ</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            รายรับจากใบเสร็จลูกค้า (AR) · รายจ่ายจากใบสำคัญจ่ายที่จ่ายแล้ว (PV) ของโครงการนี้
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.canCreateIncome && (
            <Link
              href={`/ar/invoices/new?projectId=${projectId}`}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> วางบิลลูกค้า
            </Link>
          )}
          {data.canCreateExpense && (
            <Link
              href={`/prv/new?projectId=${projectId}`}
              className="px-3.5 py-1.5 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> ขอเบิกจ่าย (PRV)
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="ได้เงินจริง"
          value={data.received}
          hint={`วางบิลแล้ว ${formatMoneyDisplay(data.billed)} · ค้างรับ ${formatMoneyDisplay(data.receivable)}`}
          icon={<Receipt className="w-3.5 h-3.5" />}
          tone="bg-emerald-50 border-emerald-200 text-emerald-600"
        />
        <KpiCard
          label="รายได้รวมเดือนนี้"
          value={data.thisMonth.income}
          hint={`จ่ายเดือนนี้ ${formatMoneyDisplay(data.thisMonth.expense)}`}
          icon={<FileText className="w-3.5 h-3.5" />}
          tone="bg-blue-50 border-blue-200 text-blue-600"
        />
        <KpiCard
          label="จ่ายจริง"
          value={data.paid}
          hint={`ตั้งหนี้รอจ่าย ${formatMoneyDisplay(data.payableOpen)} · PO ผูกพัน ${formatMoneyDisplay(data.poCommitted)}`}
          icon={<CreditCard className="w-3.5 h-3.5" />}
          tone="bg-red-50 border-red-200 text-red-600"
        />
        <KpiCard
          label="คงเหลือสุทธิ"
          value={data.net}
          hint={`มูลค่าสัญญา/งบ ${formatMoneyDisplay(data.contractValue)} · ประกันผลงานถูกหัก ${formatMoneyDisplay(data.retentionHeld)}`}
          icon={<Wallet className="w-3.5 h-3.5" />}
          tone="bg-emerald-50 border-emerald-200 text-emerald-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">รายรับ/รายจ่าย (12 เดือน)</h3>
              <p className="text-xs text-slate-400 mt-0.5">เปรียบเทียบเงินเข้า-ออกรายเดือนของโครงการนี้</p>
            </div>
            <div className="text-[11px] font-mono text-slate-500">สูงสุด {compact(maxBar)}</div>
          </div>
          <div className="mt-5 h-48 flex items-end gap-1 border-b border-slate-200">
            {data.monthly.map((m) => (
              <div key={m.month} className="flex-1 h-full flex flex-col justify-end items-center group relative">
                <div className="flex items-end gap-0.5 h-full w-full justify-center">
                  <div className="w-2.5 sm:w-3.5 bg-[#2453d4] rounded-t-sm" style={{ height: `${(m.income / maxBar) * 100}%` }} />
                  <div className="w-2.5 sm:w-3.5 bg-red-500 rounded-t-sm" style={{ height: `${(m.expense / maxBar) * 100}%` }} />
                </div>
                <div className="pointer-events-none opacity-0 group-hover:opacity-100 absolute -top-2 -translate-y-full bg-slate-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10 font-mono">
                  รับ {formatMoneyDisplay(m.income)} · จ่าย {formatMoneyDisplay(m.expense)}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-1 mt-1.5">
            {data.monthly.map((m) => (
              <span key={m.month} className="flex-1 text-center text-[10px] text-slate-400">
                {monthLabel(m.month)}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-center gap-6 mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#2453d4]" /> รายรับ
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-red-500" /> รายจ่าย
            </span>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col">
          <div className="text-xs text-slate-500 font-medium">กำไรเงินสดสะสม</div>
          <div className={`text-xl sm:text-2xl font-bold font-mono mt-0.5 ${data.net >= 0 ? 'text-slate-900' : 'text-rose-600'}`}>
            {formatMoneyDisplay(data.net)}
          </div>
          <div className={`text-xs font-semibold mt-0.5 flex items-center gap-1 ${data.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {data.net >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {margin === null ? 'ยังไม่มีรายรับ' : `อัตรากำไรเงินสด ${margin}%`}
          </div>
          <div className="mt-4 text-[11px] space-y-1.5 text-slate-600">
            <div className="flex justify-between"><span>รับเงินแล้ว</span><span className="font-mono">{formatMoneyDisplay(data.received)}</span></div>
            <div className="flex justify-between"><span>จ่ายเงินแล้ว</span><span className="font-mono">{minus(data.paid)}</span></div>
            <div className="flex justify-between"><span>ค้างรับจากลูกค้า</span><span className="font-mono">{formatMoneyDisplay(data.receivable)}</span></div>
            <div className="flex justify-between"><span>ค้างจ่าย (ตั้งหนี้แล้ว)</span><span className="font-mono">{minus(data.payableOpen)}</span></div>
            <div className="flex justify-between pt-1.5 border-t border-slate-100 font-semibold text-slate-800">
              <span>คาดการณ์หลังเคลียร์ค้างรับ/จ่าย</span>
              <span className="font-mono">{formatMoneyDisplay(data.net + data.receivable - data.payableOpen)}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900">กระแสเงินสดสะสม</h3>
          <p className="text-xs text-slate-400 mt-0.5">ยอดเงินสดคงเหลือสะสมของโครงการ ณ สิ้นแต่ละเดือน</p>
          <div className="mt-4 h-40 relative">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 100 50" preserveAspectRatio="none">
              <line x1="0" x2="100" y1={cumY(0)} y2={cumY(0)} stroke="#cbd5e1" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
              <polyline points={cumPoints} fill="none" stroke="#2563eb" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="absolute left-0 top-0 text-[10px] font-mono text-slate-400">{compact(cumMax)}</div>
            <div className="absolute left-0 bottom-0 text-[10px] font-mono text-slate-400">{compact(cumMin)}</div>
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            {data.monthly.filter((_, i) => i % 2 === 1).map((m) => (
              <span key={m.month}>{monthLabel(m.month)}</span>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900">สัดส่วนการเบิกจ่ายตามประเภท</h3>
          <p className="text-xs text-slate-400 mt-0.5">จากใบสำคัญจ่ายที่จ่ายแล้ว</p>
          {expenseTotal === 0 ? (
            <div className="py-10 text-center text-slate-400">ยังไม่มีการจ่ายเงินในโครงการนี้</div>
          ) : (
            <>
              <div className="py-4 flex justify-center">
                <svg className="w-32 h-32 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#f1f5f9" strokeWidth="5" />
                  {data.expenseGroups.map((g, i) => {
                    const { len, offset } = donutSlices[i];
                    return (
                      <circle
                        key={g.label}
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                        strokeWidth="5"
                        strokeDasharray={`${len} ${CIRC - len}`}
                        strokeDashoffset={-offset}
                      />
                    );
                  })}
                </svg>
              </div>
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                {data.expenseGroups.map((g, i) => (
                  <div key={g.label} className="flex items-center justify-between text-[11px] text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      {g.label}
                    </span>
                    <span className="font-mono">
                      {formatMoneyDisplay(g.amount)} · {((g.amount / expenseTotal) * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">รายการล่าสุด</h3>
          <p className="text-xs text-slate-400 mt-0.5">{data.entries.length} รายการ</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#102d72] text-white">
              <tr>
                <th className="py-3 px-4 font-medium">วันที่</th>
                <th className="py-3 px-4 font-medium">เลขที่</th>
                <th className="py-3 px-4 font-medium">ประเภท</th>
                <th className="py-3 px-4 font-medium">ผู้รับ/ผู้จ่าย</th>
                <th className="py-3 px-4 font-medium text-right">ยอดเงิน</th>
                <th className="py-3 px-4 font-medium text-center">สถานะ</th>
                <th className="py-3 px-4 font-medium text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    ยังไม่มีรายการรับ-จ่ายของโครงการนี้
                  </td>
                </tr>
              )}
              {data.entries.map((e) => (
                <tr key={e.key} className="hover:bg-slate-50">
                  <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{thaiDate(e.date)}</td>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-800">{e.docNo}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        e.kind === 'INCOME' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
                      }`}
                    >
                      {e.kind === 'INCOME' ? 'รายรับ' : 'รายจ่าย'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-800 font-medium">{e.party}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">{formatMoneyDisplay(e.amount)}</td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border ${
                        e.status === 'DONE' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {e.label}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Link href={e.href} className="text-[#2453d4] hover:underline font-medium">
                      เปิด
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
