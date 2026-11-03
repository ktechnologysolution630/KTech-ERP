import React from 'react';
import { requireUser } from '@/server/auth/current-user';
import { Check, CreditCard, Shield, Zap, Download } from 'lucide-react';

export default async function BillingPage() {
  const actor = await requireUser();

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">
          SUBSCRIPTION & BILLING
        </div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
          Subscription & Billing
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          จัดการแพ็กเกจการใช้งาน ข้อมูลการเรียกเก็บเงิน และประวัติใบเสร็จรับเงิน
        </p>
      </div>

      {/* Plan Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base text-slate-800">K Tec ERP Enterprise Plan</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-[#2453d4]">
                  ACTIVE
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">รอบบิลรายปี • ต่ออายุวันที่ 31 ธ.ค. 2570</p>
            </div>
            <div className="text-right">
              <span className="text-xl font-bold text-slate-800">฿24,900</span>
              <span className="text-xs text-slate-400"> / ปี</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-400 text-[11px]">ผู้ใช้งาน (Seats)</span>
              <div className="text-base font-bold text-slate-800 mt-0.5">15 / ไม่จำกัด</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-400 text-[11px]">โครงการที่เปิดอยู่</span>
              <div className="text-base font-bold text-slate-800 mt-0.5">5 / ไม่จำกัด</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-400 text-[11px]">พื้นที่จัดเก็บข้อมูล</span>
              <div className="text-base font-bold text-slate-800 mt-0.5">1.2 GB / 50 GB</div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="text-xs font-semibold text-slate-700">ฟีเจอร์ที่รวมอยู่ในแพ็กเกจ:</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>ระบบสต็อกสินค้าและรายงานเคลื่อนไหว</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>ระบบจัดซื้อ PR, PO, อนุมัติ และตรวจรับของ</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>ระบบค่าแรง งวดงาน และใบสั่งจ่ายเงิน (PRV)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>ระบบบัญชี ใบแจ้งหนี้ ใบสำคัญจ่าย และ 50 ทวี</span>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Method Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-slate-500" />
            <span>ช่องทางการชำระเงิน</span>
          </h3>

          <div className="p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-5 rounded bg-blue-700 text-white font-bold text-[9px] flex items-center justify-center">
                VISA
              </div>
              <div>
                <div className="font-semibold text-slate-800">•••• 4242</div>
                <div className="text-[10px] text-slate-400">หมดอายุ 12/28</div>
              </div>
            </div>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              ค่าเริ่มต้น
            </span>
          </div>

          <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 space-y-1">
            <div className="font-medium text-slate-700">ที่อยู่ออกใบกำกับภาษี:</div>
            <div>บริษัท เค เทค เอ็นจิเนียริ่ง จำกัด</div>
            <div>เลขประจำตัวผู้เสียภาษี: 0105562089123</div>
          </div>
        </div>
      </div>

      {/* Invoices History Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 font-semibold text-xs text-slate-800">
          ประวัติการชำระเงินและใบเสร็จ
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102d72] text-white">
                <th className="py-3 px-4 font-medium">เลขที่ใบเสร็จ</th>
                <th className="py-3 px-4 font-medium">วันที่</th>
                <th className="py-3 px-4 font-medium">รอบบิล</th>
                <th className="py-3 px-4 font-medium">ยอดชำระ</th>
                <th className="py-3 px-4 font-medium">สถานะ</th>
                <th className="py-3 px-4 font-medium text-right">ดาวน์โหลด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="hover:bg-slate-50 transition">
                <td className="py-3 px-4 font-mono font-medium text-slate-800">INV-2026-001</td>
                <td className="py-3 px-4 text-slate-600">1 ม.ค. 2569</td>
                <td className="py-3 px-4 text-slate-600">รายปี (2569 - 2570)</td>
                <td className="py-3 px-4 font-mono text-slate-700">฿24,900.00</td>
                <td className="py-3 px-4">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700">
                    ชำระแล้ว
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <button type="button" className="text-[#2453d4] hover:underline flex items-center gap-1 ml-auto text-xs font-medium">
                    <Download className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
