'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpDown } from 'lucide-react';

interface PendingDoc {
  id: string;
  docNumber: string;
  type: 'PR' | 'PO';
  customer: string;
  project: string;
  vendor: string;
  date: Date;
  amount: number;
  status: string;
  owner: string;
  link: string;
}

export function ApproveClient({
  pendingPrCount,
  pendingPoCount,
  pendingDocs,
}: {
  pendingPrCount: number;
  pendingPoCount: number;
  pendingDocs: PendingDoc[];
}) {
  const totalCount = pendingDocs.length;

  return (
    <div className="space-y-5 font-sans text-slate-800">
      {/* Header (Image 3) */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">รออนุมัติ</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          รวมเอกสารที่ยังต้องผ่านการตรวจสอบและอนุมัติก่อนดำเนินการต่อ
        </p>
      </div>

      {/* 3 Stat Cards (Image 3) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: ทั้งหมด */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-amber-600 mb-1">ทั้งหมด</div>
          <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">จำนวนเอกสารที่ยังค้างอนุมัติ</div>
        </div>

        {/* Card 2: PR */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-blue-600 mb-1">PR</div>
          <div className="text-2xl font-bold text-slate-900">{pendingPrCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">ใบขอซื้อที่รออนุมัติ</div>
        </div>

        {/* Card 3: AP */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-purple-600 mb-1">AP</div>
          <div className="text-2xl font-bold text-slate-900">0</div>
          <div className="text-[11px] text-slate-400 mt-1">ขออนุมัติจัดซื้อเกิน BOQ</div>
        </div>
      </div>

      {/* Section 1: รายการเอกสารจัดซื้อ (Image 3) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">รายการเอกสารจัดซื้อ</h2>
          <span className="text-xs text-slate-400">{pendingDocs.length} รายการ</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-[#102d72] text-xs text-white [&_th]:border-r [&_th]:border-white/40 [&_th:last-child]:border-r-0">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">
                  <div className="flex items-center gap-1 cursor-pointer">
                    <span>เลขที่เอกสาร</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
                <th className="px-3.5 py-2.5 text-left font-medium">
                  <div className="flex items-center gap-1 cursor-pointer">
                    <span>ประเภท</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
                <th className="px-3.5 py-2.5 text-left font-medium">
                  <div className="flex items-center gap-1 cursor-pointer">
                    <span>ลูกค้า</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
                <th className="px-3.5 py-2.5 text-left font-medium">
                  <div className="flex items-center gap-1 cursor-pointer">
                    <span>โครงการ</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
                <th className="px-3.5 py-2.5 text-left font-medium">
                  <div className="flex items-center gap-1 cursor-pointer">
                    <span>ซัพพลายเออร์</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
                <th className="px-3.5 py-2.5 text-left font-medium">
                  <div className="flex items-center gap-1 cursor-pointer">
                    <span>วันที่</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
                <th className="px-3.5 py-2.5 text-right font-medium">
                  <div className="flex items-center justify-end gap-1 cursor-pointer">
                    <span>มูลค่า</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
                <th className="px-3.5 py-2.5 text-center font-medium">
                  <div className="flex items-center justify-center gap-1 cursor-pointer">
                    <span>สถานะ</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
                <th className="px-3.5 py-2.5 text-left font-medium">
                  <div className="flex items-center gap-1 cursor-pointer">
                    <span>ผู้รับผิดชอบ</span>
                    <ArrowUpDown className="w-3 h-3 text-white/70" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendingDocs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 text-xs">
                    ไม่มีเอกสารรออนุมัติ
                  </td>
                </tr>
              ) : (
                pendingDocs.map((doc) => (
                  <tr key={`${doc.type}-${doc.id}`} className="hover:bg-slate-50 transition">
                    <td className="px-3.5 py-2.5 font-mono font-semibold text-[#2453d4]">
                      <Link href={doc.link} className="hover:underline">
                        {doc.docNumber}
                      </Link>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          doc.type === 'PR' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {doc.type}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-500">{doc.customer}</td>
                    <td className="px-3.5 py-2.5 font-medium text-slate-800">{doc.project}</td>
                    <td className="px-3.5 py-2.5 text-slate-600">{doc.vendor}</td>
                    <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">
                      {new Date(doc.date).toLocaleDateString('th-TH', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-bold text-slate-900">
                      ฿{doc.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3.5 py-2.5 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        รออนุมัติ
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-500">{doc.owner}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: ขออนุมัติสั่งซื้อเพิ่มเติม (Image 3) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">ขออนุมัติสั่งซื้อเพิ่มเติม</h2>
          <p className="text-xs text-slate-500 mt-0.5">รายการสั่งซื้อเกิน BOQ ที่รออนุมัติ</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead className="bg-[#102d72] text-xs text-white">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">เลขที่ / วันที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium">โครงการ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ผู้ขอ</th>
                <th className="px-3.5 py-2.5 text-right font-medium">มูลค่าเกิน BOQ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">เหตุผล</th>
                <th className="px-3.5 py-2.5 text-center font-medium w-24">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400 text-xs">
                  ไม่มีเอกสารขออนุมัติซื้อเพิ่มเติม
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}