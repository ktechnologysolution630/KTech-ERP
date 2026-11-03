import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { getPrvs } from '@/server/services/prv';
import { Receipt, Plus, FileText, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { GsapReveal } from '@/components/gsap-animator';

export default async function PrvListPage() {
  const user = await requireUser();

  const db = await getDb();
  const prvsList = await getPrvs(db);

  const pendingApprovalCount = prvsList.filter(
    (p) => p.status === 'SUBMITTED' || p.status === 'PM_VERIFIED',
  ).length;
  const approvedCount = prvsList.filter((p) => p.status === 'APPROVED' || p.status === 'PV_CREATED').length;
  const totalAmount = prvsList.reduce((sum, p) => sum + Number(p.netAmount), 0);

  const categoryLabels: Record<string, string> = {
    CONTRACTOR_PROGRESS: 'งวดงานผู้รับเหมา',
    PO_ADVANCE: 'มัดจำล่วงหน้า PO',
    PO_CREDIT: 'ค่าของเครดิต PO',
    EXPENSE: 'ค่าใช้จ่ายทั่วไป',
    PETTY_CASH: 'เบิกเงินสดย่อย',
  };

  const statusLabels: Record<string, { label: string; color: string }> = {
    DRAFT: { label: 'ร่างเอกสาร', color: 'bg-slate-100 text-slate-700' },
    SUBMITTED: { label: 'ส่งขอเบิก (รอ PM ตรวจ)', color: 'bg-blue-100 text-blue-800' },
    PM_VERIFIED: { label: 'PM ตรวจแล้ว (รอเจ้าของอนุมัติ)', color: 'bg-amber-100 text-amber-800' },
    APPROVED: { label: 'อนุมัติแล้ว (ส่งการเงิน)', color: 'bg-emerald-100 text-emerald-800' },
    PV_CREATED: { label: 'ออก PV แล้ว', color: 'bg-purple-100 text-purple-800' },
    REJECTED: { label: 'ไม่อนุมัติ', color: 'bg-rose-100 text-rose-800' },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center text-white shadow-md shadow-amber-500/20">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              ใบขอเบิกเงิน & เสนอจ่าย (PRV)
            </h1>
            <p className="text-xs text-slate-500">
              Payment Request Voucher · ขอเบิกงวดผู้รับเหมา (Payment Certificate), มัดจำ และค่าใช้จ่าย
            </p>
          </div>
        </div>

        <Link
          href="/prv/new"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition"
        >
          <Plus className="h-3.5 w-3.5" />
          เปิดใบขอเบิกเงินใหม่ (PRV)
        </Link>
      </div>

      {/* KPI Stats */}
      <GsapReveal className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>เอกสารรอตรวจ / รออนุมัติ</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-700">{pendingApprovalCount} ใบ</div>
          <p className="text-[11px] text-slate-400 mt-0.5">PM และเจ้าของตรวจสอบ</p>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>อนุมัติจ่ายแล้ว / ออก PV</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700">{approvedCount} ใบ</div>
          <p className="text-[11px] text-slate-400 mt-0.5">ส่งต่อให้ฝ่ายบัญชีจ่ายเงิน</p>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>ยอดขอเบิกสุทธิสะสม</span>
            <Receipt className="h-4 w-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            ฿{totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">หัก Retention & WHT แล้ว</p>
        </div>
      </GsapReveal>

      {/* List Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#102d72] text-white">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">เลขที่ PRV</th>
                <th className="px-3.5 py-2.5 text-left font-medium">วันที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ประเภท</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ผู้รับเงิน / ผู้ขอเบิก</th>
                <th className="px-3.5 py-2.5 text-left font-medium">โครงการ</th>
                <th className="px-3.5 py-2.5 text-right font-medium">ยอดขอเบิก</th>
                <th className="px-3.5 py-2.5 text-right font-medium">ยอดจ่ายสุทธิ</th>
                <th className="px-3.5 py-2.5 text-center font-medium">สถานะ</th>
                <th className="px-3.5 py-2.5 text-center font-medium">ดูเอกสาร</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prvsList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400">
                    ยังไม่มีรายการใบขอเบิกเงิน (PRV) ในระบบ
                  </td>
                </tr>
              ) : (
                prvsList.map((p) => {
                  const st = statusLabels[p.status] || { label: p.status, color: 'bg-slate-100' };
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-3.5 py-2.5 font-mono font-semibold text-blue-700">
                        <Link href={`/prv/${p.id}`} className="hover:underline">
                          {p.prvNumber}
                        </Link>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{p.date}</td>
                      <td className="px-3.5 py-2.5 text-slate-700">
                        {categoryLabels[p.category] || p.category}
                        {p.installmentNo ? ` (งวดที่ ${p.installmentNo})` : ''}
                      </td>
                      <td className="px-3.5 py-2.5 font-medium text-slate-900">{p.payeeName}</td>
                      <td className="px-3.5 py-2.5 text-slate-600">{p.projectName}</td>
                      <td className="px-3.5 py-2.5 text-right text-slate-600">
                        ฿{Number(p.totalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-bold text-emerald-700">
                        ฿{Number(p.netAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3.5 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-center">
                        <Link
                          href={`/prv/${p.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[11px]"
                        >
                          <FileText className="h-3 w-3" />
                          เปิดดู
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
