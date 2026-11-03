'use client';

import React, { useState } from 'react';
import { Search, Plus, X, Users, Building2 } from 'lucide-react';
import { saveVendorAction } from '@/app/(app)/master/actions';

interface VendorItem {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  creditDays: string;
  deliveryDays: string;
  totalPurchases: number;
  docCount: number;
  openPosCount: number;
}

export function PurchasingVendorsClient({ initialVendors }: { initialVendors: VendorItem[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [creditDays, setCreditDays] = useState('30');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filtered = initialVendors.filter((v) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4 font-sans text-slate-800">
      {/* Header (Image 5) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">ซัพพลายเออร์</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการรายชื่อผู้ขาย เงื่อนไขการชำระเงิน ระยะเวลาจัดส่ง และมูลค่าการสั่งซื้อสะสม
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Search box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหา..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-[#2453d4] w-48"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1c43ab] text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>เพิ่มซัพพลายเออร์ใหม่</span>
          </button>
        </div>
      </div>

      {/* Navy Table (Image 5) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-xs">
            <thead className="bg-[#102d72] text-xs text-white [&_th]:border-r [&_th]:border-white/40 [&_th:last-child]:border-r-0">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">ซัพพลายเออร์</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ผู้ติดต่อ</th>
                <th className="px-3.5 py-2.5 text-center font-medium">เงื่อนไขการชำระเงิน</th>
                <th className="px-3.5 py-2.5 text-center font-medium">ระยะเวลาจัดส่ง</th>
                <th className="px-3.5 py-2.5 text-right font-medium">ยอดซื้อรวม</th>
                <th className="px-3.5 py-2.5 text-center font-medium">เอกสาร</th>
                <th className="px-3.5 py-2.5 text-center font-medium">เปิดค้าง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-slate-400 text-xs">
                    ยังไม่มีซัพพลายเออร์
                  </td>
                </tr>
              ) : (
                filtered.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50 transition">
                    <td className="px-3.5 py-2.5">
                      <div className="font-bold text-slate-900">{v.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{v.code}</div>
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-600">{v.contactPerson}</td>
                    <td className="px-3.5 py-2.5 text-center text-slate-700 font-medium">
                      {v.creditDays}
                    </td>
                    <td className="px-3.5 py-2.5 text-center text-slate-500">{v.deliveryDays}</td>
                    <td className="px-3.5 py-2.5 text-right font-bold text-slate-900">
                      ฿{v.totalPurchases.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3.5 py-2.5 text-center font-semibold text-[#2453d4]">
                      {v.docCount}
                    </td>
                    <td className="px-3.5 py-2.5 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          v.openPosCount > 0
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {v.openPosCount}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: เพิ่มซัพพลายเออร์ใหม่ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#2453d4]" />
                เพิ่มซัพพลายเออร์ใหม่
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              action={async (formData) => {
                setIsSubmitting(true);
                formData.set('code', code);
                formData.set('name', name);
                formData.set('taxId', taxId);
                formData.set('type', 'COMPANY');
                formData.set('branch', '00000');
                formData.set('defaultCreditDays', creditDays);
                formData.set('defaultWhtRate', '0');

                await saveVendorAction(formData);
                setShowModal(false);
                setIsSubmitting(false);
                window.location.reload();
              }}
              className="p-5 space-y-3.5 text-xs"
            >
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  รหัสซัพพลายเออร์ <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  placeholder="เช่น V-001 หรือ SUP-2569"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  ชื่อร้านค้า / บริษัทซัพพลายเออร์ <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  placeholder="เช่น บริษัท ดูโฮม จำกัด (มหาชน)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    เลขผู้เสียภาษี (Tax ID)
                  </label>
                  <input
                    placeholder="เลข 13 หลัก"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    เครดิตเทอม (วัน)
                  </label>
                  <input
                    type="number"
                    value={creditDays}
                    onChange={(e) => setCreditDays(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !code || !name}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#2453d4] hover:bg-[#1c43ab] shadow-sm transition disabled:opacity-60"
                >
                  {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกซัพพลายเออร์'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}