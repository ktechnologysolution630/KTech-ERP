'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Filter, CheckCircle, Table as TableIcon, Plus, Folder, Building2, Calendar, MapPin, ArrowRight } from 'lucide-react';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, isProjectClosed, type ProjectStatus } from '@/domain/project';
import { CreateProjectDialog } from '@/components/create-project-dialog';

interface Project {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  clientName: string;
  location: string;
  budget: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: Date;
}

const STATUS_BADGE: Record<ProjectStatus, string> = {
  PLANNING: 'bg-sky-50 text-sky-700 border border-sky-200',
  IN_PROGRESS: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  ON_HOLD: 'bg-amber-50 text-amber-700 border border-amber-200',
  COMPLETED: 'bg-slate-100 text-slate-600 border border-slate-200',
  CANCELLED: 'bg-red-50 text-red-600 border border-red-200',
};

export function ProjectsClient({
  initialProjects,
  canCreate,
}: {
  initialProjects: Project[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [showModal, setShowModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'ALL'>('ALL');

  const filtered = initialProjects.filter((p) => {
    if (statusFilter !== 'ALL') {
      if (p.status !== statusFilter) return false;
    } else if (!showCompleted && isProjectClosed(p.status)) {
      return false;
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Projects Toolbar (Image 2) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหาโครงการ..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:border-[#2453d4]"
            />
          </div>

          {/* Status filter */}
          <label
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition ${
              statusFilter === 'ALL' ? 'border-slate-200 bg-white text-slate-700' : 'border-[#2453d4] bg-blue-50 text-[#2453d4]'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span className="sr-only">ตัวกรองสถานะ</span>
            <select
              aria-label="ตัวกรองสถานะ"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'ALL')}
              className="bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="ALL">ตัวกรอง: ทุกสถานะ</option>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          {/* Completed toggle */}
          <button
            type="button"
            onClick={() => setShowCompleted(!showCompleted)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition ${
              showCompleted
                ? 'border-[#2453d4] bg-blue-50 text-[#2453d4]'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>โครงการเสร็จสิ้นแล้ว</span>
          </button>

          {/* View Mode toggle */}
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'table' ? 'grid' : 'table')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <TableIcon className="w-3.5 h-3.5 text-slate-500" />
            <span>{viewMode === 'table' ? 'มุมมองตาราง' : 'มุมมองการ์ด'}</span>
          </button>
        </div>

        {/* Primary Action Button */}
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1d44b8] text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>สร้างโครงการ</span>
          </button>
        )}
      </div>

      {/* Main Content Area */}
      {filtered.length === 0 ? (
        /* Empty State (Image 2) */
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
            <Folder className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            {initialProjects.length === 0 ? 'ยังไม่มีโครงการในฐานข้อมูล' : 'ไม่พบโครงการที่ตรงกับตัวกรอง'}
          </h3>
          {canCreate && initialProjects.length === 0 && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1d44b8] text-white text-xs font-semibold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>สร้างโครงการ</span>
            </button>
          )}
        </div>
      ) : viewMode === 'table' ? (
        /* Table View */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <table className="w-full text-xs">
            <thead className="bg-[#102d72] text-white">
              <tr>
                <th className="px-4 py-3 text-left font-medium">รหัสโครงการ</th>
                <th className="px-4 py-3 text-left font-medium">ชื่อโครงการ</th>
                <th className="px-4 py-3 text-left font-medium">ลูกค้า</th>
                <th className="px-4 py-3 text-right font-medium">งบประมาณ</th>
                <th className="px-4 py-3 text-left font-medium">สถานะ</th>
                <th className="px-4 py-3 text-left font-medium">วันที่บันทึก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className="hover:bg-blue-50/50 cursor-pointer transition select-none"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-[#2453d4]">
                    <div className="flex items-center gap-1.5">
                      <span>{p.code}</span>
                      <ArrowRight className="w-3 h-3 text-[#2453d4] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-4 py-3 text-slate-600">{p.clientName || '-'}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">
                    {p.budget > 0 ? p.budget.toLocaleString('th-TH') : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_BADGE[p.status]}`}
                    >
                      {PROJECT_STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(p.createdAt).toLocaleDateString('th-TH', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Grid Cards View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/projects/${p.id}`)}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md hover:border-blue-400 cursor-pointer transition space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-mono font-bold text-[#2453d4]">{p.code}</span>
                  <h4 className="text-sm font-bold text-slate-900 mt-0.5">{p.name}</h4>
                </div>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${STATUS_BADGE[p.status]}`}
                >
                  {PROJECT_STATUS_LABELS[p.status]}
                </span>
              </div>
              {(p.clientName || p.location) && (
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  {p.clientName && (
                    <div className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      <span>{p.clientName}</span>
                    </div>
                  )}
                  {p.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>{p.location}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    {new Date(p.createdAt).toLocaleDateString('th-TH', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <span className="text-[#2453d4] font-medium flex items-center gap-1">
                  เข้าสู่โครงการ <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <CreateProjectDialog onClose={() => setShowModal(false)} />}
    </div>
  );
}