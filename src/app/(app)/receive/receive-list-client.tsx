'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Package, ArrowRight, FileText, CheckCircle2, Clock } from 'lucide-react';

function formatMoney(amount: number | string): string {
  return `฿${Number(amount || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface ProjectReceiveGroup {
  projectId: string;
  projectCode: string;
  projectName: string;
  waitingCount: number;
  partiallyCount: number;
  receivedCount: number;
  totalValue: number;
  pos: {
    id: string;
    number: string;
    vendorName: string;
    status: string;
    deliveryDate: string | null;
    remainingLineCount: number;
    gross: number;
  }[];
}

interface ReceiveListClientProps {
  projectGroups: ProjectReceiveGroup[];
}

export function ReceiveListClient({ projectGroups }: ReceiveListClientProps) {
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  const toggleExpand = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const activeProjectCount = projectGroups.length;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page Header matching Reference Screenshot 3 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">
            โครงการที่มีเอกสารรอรับสินค้า
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            คลิกโครงการเพื่อดูรายการ PO ที่ต้องรับสินค้าในโครงการนั้น
          </p>
        </div>
        <div className="text-xs sm:text-sm font-medium text-slate-500">
          {activeProjectCount} โครงการ
        </div>
      </div>

      {/* Main Table Container matching Reference Screenshot 3 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102d72] text-white">
                <th className="py-3 px-4 font-medium w-2/5">โครงการ</th>
                <th className="py-3 px-4 font-medium text-center">Waiting Receive</th>
                <th className="py-3 px-4 font-medium text-center">Partially Received</th>
                <th className="py-3 px-4 font-medium text-center">Received</th>
                <th className="py-3 px-4 font-medium text-right">มูลค่า</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projectGroups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-20 text-center text-slate-400 text-sm">
                    ไม่มีโครงการที่มีเอกสารรอรับสินค้า
                  </td>
                </tr>
              ) : (
                projectGroups.map((group) => {
                  const isExpanded = !!expandedProjects[group.projectId];
                  return (
                    <React.Fragment key={group.projectId}>
                      <tr
                        onClick={() => toggleExpand(group.projectId)}
                        className="hover:bg-blue-50/50 cursor-pointer transition select-none"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-[#2453d4]" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </span>
                            <div>
                              <div className="font-semibold text-slate-800 text-xs">
                                {group.projectName}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {group.projectCode}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                              group.waitingCount > 0
                                ? 'bg-amber-50 text-amber-700'
                                : 'text-slate-400'
                            }`}
                          >
                            {group.waitingCount}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                              group.partiallyCount > 0
                                ? 'bg-blue-50 text-[#2453d4]'
                                : 'text-slate-400'
                            }`}
                          >
                            {group.partiallyCount}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                              group.receivedCount > 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'text-slate-400'
                            }`}
                          >
                            {group.receivedCount}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-700">
                          {formatMoney(group.totalValue)}
                        </td>
                      </tr>

                      {/* Expandable PO list for this project */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="bg-slate-50 p-4 border-t border-slate-100">
                            <div className="space-y-2">
                              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                รายการใบสั่งซื้อ (PO) ที่รอรับสินค้าในโครงการนี้
                              </div>
                              {group.pos.map((po) => (
                                <div
                                  key={po.id}
                                  className="flex items-center justify-between p-3 rounded-lg bg-white border border-slate-200 hover:border-blue-300 transition"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-7 h-7 rounded bg-blue-50 text-[#2453d4] flex items-center justify-center">
                                      <Package className="w-3.5 h-3.5" />
                                    </div>
                                    <div>
                                      <div className="font-semibold text-slate-800 text-xs">
                                        {po.number}
                                      </div>
                                      <div className="text-[11px] text-slate-500">
                                        {po.vendorName}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-4 text-xs">
                                    <span className="font-mono text-slate-700">
                                      {formatMoney(po.gross)}
                                    </span>
                                    <span className="text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded text-[10px]">
                                      รอรับ {po.remainingLineCount} รายการ
                                    </span>
                                    <Link
                                      href={`/receive/${po.id}`}
                                      className="px-3 py-1 rounded bg-[#2453d4] hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1 transition"
                                    >
                                      <span>บันทึกรับของ</span>
                                      <ArrowRight className="w-3 h-3" />
                                    </Link>
                                  </div>
                                </div>
                              ))}
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
      </div>
    </div>
  );
}
