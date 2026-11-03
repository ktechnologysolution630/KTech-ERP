'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Folder, Search } from 'lucide-react';
import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@/domain/project';
import type { MilestoneProjectRow } from '@/server/services/milestones';

export type LaborTab = 'payment-milestones' | 'receive-milestones' | 'milestones';

interface LaborPaymentsClientProps {
  tab: LaborTab;
  pay: MilestoneProjectRow[];
  receive: MilestoneProjectRow[];
}

const TAB_LABELS: Record<LaborTab, string> = {
  'payment-milestones': 'แผนงวดงานจ่าย',
  'receive-milestones': 'แผนงวดงานรับ',
  milestones: 'รายงาน',
};

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function LaborPaymentsClient({ tab, pay, receive }: LaborPaymentsClientProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const q = searchTerm.trim().toLowerCase();
  const matches = (p: MilestoneProjectRow) =>
    q === '' || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q);

  const rows = (tab === 'receive-milestones' ? receive : pay).filter(matches);
  const kindParam = tab === 'receive-milestones' ? 'RECEIVE' : 'PAY';

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <nav className="flex items-center gap-2 border-b border-slate-200 pb-2">
        {(Object.keys(TAB_LABELS) as LaborTab[]).map((t) => (
          <Link
            key={t}
            href={`/labor-payments?tab=${t}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              tab === t ? 'bg-blue-50 text-[#2453d4] font-semibold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>

      <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div>
            <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">LABOR & PROGRESS PAYMENT</div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-800 mt-1">ค่าแรงและงวดงาน · {TAB_LABELS[tab]}</h1>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาโครงการ / ลูกค้า..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white placeholder-slate-400 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
            />
          </div>
        </div>

        {tab === 'milestones' ? (
          <MilestoneReport pay={pay.filter(matches)} receive={receive} />
        ) : rows.length === 0 ? (
          <div className="py-24 text-center text-sm text-slate-400">ยังไม่มีโครงการให้แสดง</div>
        ) : (
          <div className="pt-6 overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead className="text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 text-left font-medium">โครงการ</th>
                  <th className="py-2 text-left font-medium">ลูกค้า</th>
                  <th className="py-2 text-left font-medium">สถานะโครงการ</th>
                  <th className="py-2 text-right font-medium">งวด</th>
                  <th className="py-2 text-right font-medium">มูลค่าในแผนงวด</th>
                  <th className="py-2 text-right font-medium">{kindParam === 'PAY' ? 'อนุมัติ/จ่ายแล้ว' : 'อนุมัติ/รับแล้ว'}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3">
                      <Link href={`/labor-payments/${p.id}?kind=${kindParam}`} className="flex items-center gap-2 group">
                        <span className="w-8 h-8 rounded-lg bg-blue-50 text-[#2453d4] flex items-center justify-center shrink-0">
                          <Folder className="w-4 h-4" />
                        </span>
                        <span>
                          <span className="block font-semibold text-slate-800 group-hover:text-[#2453d4]">{p.name}</span>
                          <span className="block font-mono text-[11px] text-slate-400">{p.code}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 text-slate-600">{p.clientName || '-'}</td>
                    <td className="py-3 text-slate-600">
                      {PROJECT_STATUS_LABELS[p.status as ProjectStatus] ?? p.status}
                    </td>
                    <td className="py-3 text-right font-mono">{p.milestoneCount}</td>
                    <td className="py-3 text-right font-mono">{baht(p.planned)}</td>
                    <td className="py-3 text-right font-mono">{baht(p.approvedOrPaid)}</td>
                    <td className="py-3 text-right">
                      <Link
                        href={`/labor-payments/${p.id}?kind=${kindParam}`}
                        className="inline-flex items-center gap-1 text-[#2453d4] hover:underline font-medium"
                      >
                        เปิดแผนงวด <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MilestoneReport({ pay, receive }: { pay: MilestoneProjectRow[]; receive: MilestoneProjectRow[] }) {
  const receiveById = new Map(receive.map((r) => [r.id, r]));
  if (pay.length === 0) return <div className="py-24 text-center text-sm text-slate-400">ยังไม่มีโครงการให้แสดง</div>;
  return (
    <div className="pt-6 overflow-x-auto">
      <table className="w-full text-xs min-w-[760px]">
        <thead className="text-slate-500 border-b border-slate-200">
          <tr>
            <th className="py-2 text-left font-medium">โครงการ</th>
            <th className="py-2 text-right font-medium">งบประมาณ</th>
            <th className="py-2 text-right font-medium">งวดรับ (แผน)</th>
            <th className="py-2 text-right font-medium">รับแล้ว/อนุมัติ</th>
            <th className="py-2 text-right font-medium">งวดจ่าย (แผน)</th>
            <th className="py-2 text-right font-medium">จ่ายแล้ว/อนุมัติ</th>
            <th className="py-2 text-right font-medium">ส่วนต่างตามแผน</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {pay.map((p) => {
            const r = receiveById.get(p.id);
            const margin = (r?.planned ?? 0) - p.planned;
            return (
              <tr key={p.id}>
                <td className="py-3">
                  <span className="block font-semibold text-slate-800">{p.name}</span>
                  <span className="block font-mono text-[11px] text-slate-400">{p.code}</span>
                </td>
                <td className="py-3 text-right font-mono">{baht(p.budget)}</td>
                <td className="py-3 text-right font-mono">{baht(r?.planned ?? 0)}</td>
                <td className="py-3 text-right font-mono">{baht(r?.approvedOrPaid ?? 0)}</td>
                <td className="py-3 text-right font-mono">{baht(p.planned)}</td>
                <td className="py-3 text-right font-mono">{baht(p.approvedOrPaid)}</td>
                <td className={`py-3 text-right font-mono font-semibold ${margin < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {baht(margin)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
