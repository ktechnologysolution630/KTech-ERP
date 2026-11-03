'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, Search, Folder, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { DocStatusBadge } from '@/components/doc-status-badge';
import type { PoStatus } from '@/db/schema';

interface PoItem {
  id: string;
  number: string;
  projectId: string | null;
  projectCode: string;
  projectName: string;
  vendorId: string;
  vendorName: string;
  status: PoStatus;
  gross: string;
  createdAt: Date;
}

interface ProjectStat {
  projectId: string;
  projectCode: string;
  projectName: string;
  prCount: number;
  poCount: number;
  totalDocs: number;
  totalValue: number;
  pos: PoItem[];
}

export function PoListClient({
  projectStats,
  allPos,
}: {
  projectStats: ProjectStat[];
  allPos: PoItem[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'project' | 'all'>('project');

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredProjects = projectStats.filter((p) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return p.projectName.toLowerCase().includes(q) || p.projectCode.toLowerCase().includes(q);
  });

  const filteredAllPos = allPos.filter((p) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      p.number.toLowerCase().includes(q) ||
      p.projectName.toLowerCase().includes(q) ||
      p.vendorName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4 font-sans text-slate-800">
      {/* Header (Image 2) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">ใบสั่งซื้อ PO</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            เอกสารสั่งซื้อที่พร้อมส่งให้ซัพพลายเออร์และติดตามสถานะการรับของ
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Search Box */}
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

          {projectStats.length > 0 && (
            <button
              type="button"
              onClick={() => setViewMode(viewMode === 'project' ? 'all' : 'project')}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              {viewMode === 'project' ? 'มุมมองรายการทั้งหมด' : 'มุมมองแยกตามโครงการ'}
            </button>
          )}

          <Link
            href="/po/new"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1c43ab] text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>สร้างใบสั่งซื้อ PO</span>
          </Link>
        </div>
      </div>

      {/* Main Table Area (Image 2) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {viewMode === 'project' ? (
          /* Grouped by Project (Image 2) */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="bg-[#102d72] text-xs text-white">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">โครงการ</th>
                  <th className="px-4 py-3 text-center font-medium w-24">PR</th>
                  <th className="px-4 py-3 text-center font-medium w-24">PO</th>
                  <th className="px-4 py-3 text-center font-medium w-32">เอกสารทั้งหมด</th>
                  <th className="px-4 py-3 text-right font-medium w-36">มูลค่า</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProjects.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-14 text-center text-slate-400 text-xs">
                      ยังไม่มีโครงการที่มีใบสั่งซื้อ PO
                    </td>
                  </tr>
                ) : (
                  filteredProjects.map((p) => {
                    const isExpanded = !!expandedProjects[p.projectId];
                    return (
                      <React.Fragment key={p.projectId}>
                        <tr
                          onClick={() => toggleProject(p.projectId)}
                          className="hover:bg-slate-50 cursor-pointer transition"
                        >
                          <td className="px-4 py-3 font-semibold text-slate-900 flex items-center gap-2.5">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-[#2453d4]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                            <Folder className="w-4 h-4 text-[#2453d4]" />
                            <div>
                              <span>{p.projectName}</span>
                              <span className="ml-2 font-mono text-[10px] text-slate-400 font-normal">
                                ({p.projectCode})
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-slate-700">{p.prCount}</td>
                          <td className="px-4 py-3 text-center font-bold text-[#2453d4]">{p.poCount}</td>
                          <td className="px-4 py-3 text-center font-bold text-slate-900">{p.totalDocs}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900">
                            ฿{p.totalValue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>

                        {/* Expanded PO items in this project */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="bg-slate-50/70 p-3 pl-10 border-t border-slate-100">
                              <div className="space-y-1.5">
                                <div className="text-[11px] font-semibold text-slate-500 mb-2">
                                  รายการใบสั่งซื้อในโครงการ ({p.pos.length} ฉบับ):
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  {p.pos.map((po) => (
                                    <Link
                                      key={po.id}
                                      href={`/po/${po.id}`}
                                      className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200 hover:border-[#2453d4] hover:shadow-xs transition"
                                    >
                                      <div className="flex items-center gap-3">
                                        <FileText className="w-4 h-4 text-slate-400" />
                                        <span className="font-mono font-bold text-[#2453d4]">{po.number}</span>
                                        <span className="text-slate-600 truncate max-w-xs">
                                          ผู้ขาย: {po.vendorName}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-4">
                                        <span className="font-bold text-slate-900 text-xs">
                                          ฿{Number(po.gross).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                        </span>
                                        <DocStatusBadge status={po.status} />
                                      </div>
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Flat All POs Table */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="bg-[#102d72] text-xs text-white">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">เลขที่ PO</th>
                  <th className="px-4 py-3 text-left font-medium">โครงการ</th>
                  <th className="px-4 py-3 text-left font-medium">ผู้ขาย</th>
                  <th className="px-4 py-3 text-right font-medium">มูลค่ารวม</th>
                  <th className="px-4 py-3 text-left font-medium">วันที่</th>
                  <th className="px-4 py-3 text-center font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAllPos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                      ยังไม่มีรายการใบสั่งซื้อ PO
                    </td>
                  </tr>
                ) : (
                  filteredAllPos.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-mono font-bold text-[#2453d4]">
                        <Link href={`/po/${po.id}`} className="hover:underline">
                          {po.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{po.projectName}</td>
                      <td className="px-4 py-3 text-slate-600">{po.vendorName}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        ฿{Number(po.gross).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(po.createdAt).toLocaleDateString('th-TH', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <DocStatusBadge status={po.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}