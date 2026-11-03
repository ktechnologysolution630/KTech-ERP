import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { ShieldCheck, Plus, Search, AlertCircle } from 'lucide-react';

export default async function WarrantyPage() {
  const actor = await requireUser();
  const db = await getDb();
  const projects = await listProjects(db, actor);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">
            WARRANTY & DEFECTS
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
            ใบรับประกันผลงาน
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการการรับประกันผลงานหลังส่งมอบ ระยะเวลารับประกัน และรายการแจ้งซ่อม (Defect)
          </p>
        </div>

        <button
          type="button"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white text-xs font-medium shadow-xs transition"
        >
          <Plus className="w-4 h-4" />
          <span>ออกใบรับประกันผลงาน</span>
        </button>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102d72] text-white">
                <th className="py-3 px-4 font-medium">โครงการ</th>
                <th className="py-3 px-4 font-medium">เลขที่ใบรับประกัน</th>
                <th className="py-3 px-4 font-medium">ระยะเวลารับประกัน</th>
                <th className="py-3 px-4 font-medium">วันสิ้นสุดรับประกัน</th>
                <th className="py-3 px-4 font-medium">สถานะ</th>
                <th className="py-3 px-4 font-medium text-center">แจ้งซ่อม (Defect)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-20 text-center text-slate-400 text-sm">
                    ยังไม่มีใบรับประกันผลงาน
                  </td>
                </tr>
              ) : (
                projects.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{p.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{p.code}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">WAR-{p.code}-01</td>
                    <td className="py-3 px-4 text-slate-600">1 ปี (โครงสร้าง 5 ปี)</td>
                    <td className="py-3 px-4 text-slate-600">31 ธ.ค. 2570</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700">
                        อยู่ในระยะประกัน
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-slate-400">0 รายการ</span>
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
