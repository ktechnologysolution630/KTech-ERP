import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { CheckCircle2, FileText, Plus, Search, ShieldCheck } from 'lucide-react';

export default async function HandoverPage() {
  const actor = await requireUser();
  const db = await getDb();
  const projects = await listProjects(db, actor);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">
            AFTER SERVICE & HANDOVER
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
            ส่งมอบโครงการ
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการเอกสารส่งมอบงาน ตรวจรับงานงวดสุดท้าย และเอกสารปิดโครงการ
          </p>
        </div>

        <button
          type="button"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white text-xs font-medium shadow-xs transition"
        >
          <Plus className="w-4 h-4" />
          <span>สร้างเอกสารส่งมอบ</span>
        </button>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102d72] text-white">
                <th className="py-3 px-4 font-medium">โครงการ</th>
                <th className="py-3 px-4 font-medium">ผู้ว่าจ้าง / ลูกค้า</th>
                <th className="py-3 px-4 font-medium">วันที่ส่งมอบ</th>
                <th className="py-3 px-4 font-medium">สถานะการตรวจรับ</th>
                <th className="py-3 px-4 font-medium">เอกสารแนบ</th>
                <th className="py-3 px-4 font-medium text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-20 text-center text-slate-400 text-sm">
                    ยังไม่มีเอกสารส่งมอบโครงการ
                  </td>
                </tr>
              ) : (
                projects.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{p.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{p.code}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">ลูกค้าทั่วไป</td>
                    <td className="py-3 px-4 text-slate-500">-</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
                        พร้อมส่งมอบ
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">-</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        className="text-[#2453d4] hover:underline font-medium text-xs"
                      >
                        ดูรายละเอียด
                      </button>
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
