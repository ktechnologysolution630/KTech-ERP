'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Plus, ShoppingCart, ArrowUpDown } from 'lucide-react';

interface PurchasingDoc {
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

interface PurchasingClientProps {
  stats: {
    pendingPrCount: number;
    issuedPoCount: number;
    pendingReceiveCount: number;
    poTotalThisMonth: number;
  };
  documents: PurchasingDoc[];
}

export function PurchasingClient({ stats, documents }: PurchasingClientProps) {
  const [docFilter, setDocFilter] = useState<'ALL' | 'PR' | 'PO'>('ALL');

  const filteredDocs = documents.filter((d) => {
    if (docFilter === 'PR') return d.type === 'PR';
    if (docFilter === 'PO') return d.type === 'PO';
    return true;
  });

  return (
    <div className="space-y-5 font-sans text-slate-800">
      {/* Page Header (Image 1) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">จัดซื้อ / สั่งซื้อ</h1>

        <div className="flex items-center gap-2.5">
          <Link
            href="/pr/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1c43ab] text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>สร้างใบขอซื้อ PR</span>
          </Link>

          <Link
            href="/po/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition"
          >
            <ShoppingCart className="w-4 h-4 text-slate-500" />
            <span>สร้างใบสั่งซื้อ PO</span>
          </Link>
        </div>
      </div>

      {/* 4 Stat Cards (Image 1) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: PR รออนุมัติ */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-amber-600 mb-1">PR รออนุมัติ</div>
          <div className="text-2xl font-bold text-slate-900">{stats.pendingPrCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">ใบขอซื้อที่ยังรอการอนุมัติจากผู้มีอำนาจ</div>
        </div>

        {/* Card 2: PO ที่ออกแล้ว */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-blue-600 mb-1">PO ที่ออกแล้ว</div>
          <div className="text-2xl font-bold text-slate-900">{stats.issuedPoCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">ใบสั่งซื้อที่ออกให้ซัพพลายเออร์แล้ว</div>
        </div>

        {/* Card 3: รอรับสินค้า */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-cyan-600 mb-1">รอรับสินค้า</div>
          <div className="text-2xl font-bold text-slate-900">{stats.pendingReceiveCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            เอกสารที่ยังต้องติดตามการรับของเข้าหน้างานหรือคลัง
          </div>
        </div>

        {/* Card 4: ยอดสั่งซื้อเดือนนี้ */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-semibold text-emerald-600 mb-1">ยอดสั่งซื้อเดือนนี้</div>
          <div className="text-2xl font-bold text-slate-900">
            {stats.poTotalThisMonth.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">มูลค่ารวมเอกสาร PO ประจำเดือนปัจจุบัน</div>
        </div>
      </div>

      {/* Section: รายการเอกสารจัดซื้อ (Image 1) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">รายการเอกสารจัดซื้อ</h2>

          <div className="flex items-center gap-3">
            {/* Filter pills: ทั้งหมด, PR, PO */}
            <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs">
              <button
                type="button"
                onClick={() => setDocFilter('ALL')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  docFilter === 'ALL'
                    ? 'bg-[#2453d4] text-white shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => setDocFilter('PR')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  docFilter === 'PR'
                    ? 'bg-[#2453d4] text-white shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                PR
              </button>
              <button
                type="button"
                onClick={() => setDocFilter('PO')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  docFilter === 'PO'
                    ? 'bg-[#2453d4] text-white shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                PO
              </button>
            </div>

            <span className="text-xs text-slate-400">{filteredDocs.length} รายการ</span>
          </div>
        </div>

        {/* Navy Table Header (Image 1) */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-xs">
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
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 text-xs">
                    ยังไม่มีเอกสารจัดซื้อในระบบ
                  </td>
                </tr>
              ) : (
                filteredDocs.map((doc) => (
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
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                        {doc.status}
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
    </div>
  );
}