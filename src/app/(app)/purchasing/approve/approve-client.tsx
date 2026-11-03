'use client';

import React from 'react';
import Link from 'next/link';
import { ApDecisionButtons } from '@/components/boq-overrun-panel';
import { PurchasingDocTable, type PurchasingDocRow } from '@/components/purchasing-doc-table';
import type { BoqOverrunRequestDto } from '@/server/services/boq-overrun';

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ApproveClient({
  pendingPrCount,
  pendingDocs,
  overruns,
  canDecideOverrun,
}: {
  pendingPrCount: number;
  pendingDocs: PurchasingDocRow[];
  overruns: BoqOverrunRequestDto[];
  canDecideOverrun: boolean;
}) {
  return (
    <div className="space-y-5 font-sans text-slate-800">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">รออนุมัติ</h1>
        <p className="text-xs text-slate-500 mt-0.5">รวมเอกสารที่ยังต้องผ่านการตรวจสอบและอนุมัติก่อนดำเนินการต่อ</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-amber-600 mb-1">ทั้งหมด</div>
          <div className="text-2xl font-bold text-slate-900">{pendingDocs.length + overruns.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">จำนวนเอกสารที่ยังค้างอนุมัติ</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-blue-600 mb-1">PR / PO</div>
          <div className="text-2xl font-bold text-slate-900">
            {pendingPrCount} / {pendingDocs.length - pendingPrCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">ใบขอซื้อ / ใบสั่งซื้อที่รออนุมัติ</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-purple-600 mb-1">AP</div>
          <div className="text-2xl font-bold text-slate-900">{overruns.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">ขออนุมัติจัดซื้อเกิน BOQ</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">รายการเอกสารจัดซื้อ</h2>
          <span className="text-xs text-slate-400">{pendingDocs.length} รายการ</span>
        </div>
        <PurchasingDocTable docs={pendingDocs} showStatus={false} emptyText="ไม่มีเอกสารรออนุมัติ" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">ขออนุมัติสั่งซื้อเพิ่มเติม</h2>
          <p className="text-xs text-slate-500 mt-0.5">รายการสั่งซื้อเกิน BOQ ที่รออนุมัติ</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead className="bg-[#102d72] text-xs text-white">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">เลขที่ / วันที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium">โครงการ / PO</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ผู้ขอ</th>
                <th className="px-3.5 py-2.5 text-right font-medium">มูลค่าเกิน BOQ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">เหตุผล</th>
                <th className="px-3.5 py-2.5 text-left font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overruns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400 text-xs">
                    ไม่มีเอกสารขออนุมัติซื้อเพิ่มเติม
                  </td>
                </tr>
              ) : (
                overruns.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3.5 py-2.5">
                      <div className="font-mono font-semibold">{r.number}</div>
                      <div className="text-slate-400">{new Date(r.createdAt).toLocaleDateString('th-TH')}</div>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div>{r.projectName}</div>
                      <Link href={`/po/${r.poId}`} className="font-mono text-[#2453d4] hover:underline">
                        {r.poNumber}
                      </Link>
                    </td>
                    <td className="px-3.5 py-2.5">{r.requestedByName}</td>
                    <td className="px-3.5 py-2.5 text-right font-mono font-semibold">{baht(r.overAmount)}</td>
                    <td className="px-3.5 py-2.5 text-slate-600 max-w-xs">{r.reason}</td>
                    <td className="px-3.5 py-2.5">
                      {canDecideOverrun ? <ApDecisionButtons request={r} /> : <span className="text-slate-400">รอเจ้าของอนุมัติ</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
