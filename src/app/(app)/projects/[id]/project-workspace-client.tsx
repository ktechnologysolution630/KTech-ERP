'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  LayoutGrid,
  FileSpreadsheet,
  FileText,
  TrendingUp,
  FilePlus,
  CheckSquare,
  BarChart2,
  Calendar as CalendarIcon,
  Camera,
  Folder,
  MessageSquare,
  Users,
  Settings,
  CheckCircle2,
  Clock,
  MapPin,
  Building2,
  ExternalLink,
  X,
  Heart,
  Phone,
  Pencil,
  Image as ImageIcon,
} from 'lucide-react';
import { animateStaggerEntrance } from '@/lib/gsap-smooth';
import { ProjectBoqPanel } from '@/components/project-boq-panel';
import type { BoqDocumentDto } from '@/server/services/boq';
import type { ProjectDetailDto } from '@/server/services/master';
import { PROJECT_COVER_PRESETS, PROJECT_STATUS_LABELS } from '@/domain/project';
import { ProjectDetailsForm } from '@/components/project-details-form';
import { ProjectTasksBoard } from '@/components/project-tasks-board';
import { ProjectGanttView } from '@/components/project-gantt-view';
import { isTaskOverdue } from '@/domain/schedule';
import { voCostImpact } from '@/domain/variation-order';
import { CalendarPanel } from '@/components/project-site/calendar-panel';
import { ChatPanel } from '@/components/project-site/chat-panel';
import { ReportsPanel } from '@/components/project-site/reports-panel';
import { FilesPanel } from '@/components/project-site/files-panel';
import { TeamPanel } from '@/components/project-site/team-panel';
import { ProjectCoverPicker } from '@/components/project-cover-picker';
import type { ProjectTaskList } from '@/server/services/tasks';
import { formatThaiDate } from '@/domain/thai';
import { ProjectCashflowView } from '@/components/project-cashflow-view';
import { ProjectCostPerformanceView } from '@/components/project-cost-performance-view';
import { ProjectVoView } from '@/components/project-vo-view';
import type { ProjectVoList } from '@/server/services/variation-orders';

export type WorkspaceTab =
  | 'overview'
  | 'cashflow'
  | 'boq'
  | 'cost-perf'
  | 'vo'
  | 'tasks'
  | 'gantt'
  | 'calendar'
  | 'photos'
  | 'reports'
  | 'docs'
  | 'chat'
  | 'team'
  | 'settings';

interface LinkedPR {
  id: string;
  number: string;
  title: string;
  status: string;
  totalAmount: number;
  createdAt: string;
}

interface LinkedPO {
  id: string;
  number: string;
  vendorName: string | null;
  status: string;
  gross: number;
  deliveryDate: string | null;
}

interface LinkedPRV {
  id: string;
  prvNumber: string;
  title: string;
  vendorName: string;
  category: string;
  totalAmount: number;
  status: string;
  dueDate: string | null;
}

interface ProjectWorkspaceProps {
  project: ProjectDetailDto & { progress?: number };
  initialPrs?: LinkedPR[];
  initialPos?: LinkedPO[];
  initialPrvs?: LinkedPRV[];
  allVendors?: { id: string; name: string; code: string }[];
  allUsers?: { id: string; name: string; email: string }[];
  initialBoq?: BoqDocumentDto | null;
  canEditBoq?: boolean;
  taskList: ProjectTaskList;
  /** Bangkok date `yyyy-mm-dd`, computed on the server so overdue checks match */
  today: string;
  /** Tab to open first, from `?tab=` (e.g. returning from the BOQ sheet) */
  initialTab?: WorkspaceTab;
  voData: ProjectVoList;
  customers?: { id: string; code: string; name: string }[];
  /** Signed-in user id (own chat bubbles, own uploads) */
  me: string;
  meName: string;
  companyLogoUrl: string | null;
  teamCount: number;
  photoCount: number;
}

export function ProjectWorkspaceClient({
  project,
  initialPrs = [],
  initialPos = [],
  initialPrvs = [],
  allVendors = [],
  allUsers = [],
  initialBoq = null,
  canEditBoq = false,
  taskList,
  today,
  initialTab = 'overview',
  voData,
  customers = [],
  me,
  meName,
  companyLogoUrl,
  teamCount,
  photoCount,
}: ProjectWorkspaceProps) {
  const tasks = taskList.tasks;
  const doneCount = tasks.filter((t) => t.status === 'DONE').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'IN_PROGRESS');
  const overdueTasks = tasks.filter((t) => isTaskOverdue(t, today));
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const contentRef = useRef<HTMLDivElement>(null);

  const [isEditProjectModalOpen, setIsEditProjectModalOpen] = useState(false);
  const [isCoverPhotoModalOpen, setIsCoverPhotoModalOpen] = useState(false);
  const [coverPhoto, setCoverPhoto] = useState<string | null>(project.coverImageUrl || null);

  // Contract period from the project dates (Bangkok "today" from the server)
  const schedule = (() => {
    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    const elapsed = project.startDate ? Math.max(0, Math.round(day(today) - day(project.startDate))) : null;
    if (!project.startDate || !project.endDate) return { elapsed, total: null, remaining: null, timePercent: 0 };
    const total = Math.max(1, Math.round(day(project.endDate) - day(project.startDate)));
    const remaining = Math.round(day(project.endDate) - day(today));
    return { elapsed, total, remaining, timePercent: Math.min(100, Math.max(0, Math.round(((elapsed ?? 0) / total) * 100))) };
  })();

  // Display values for the overview card, derived from the saved project (refreshed after edits)
  const projectInfo = {
    customer: project.clientName || '-',
    group: project.projectGroup || '-',
    contactPerson: project.contactName || '-',
    phone: project.contactPhone || '-',
    location: project.location || '-',
    projectManager: project.pmName ?? '-',
    budget: project.budget.toLocaleString('th-TH'),
    startDate: project.startDate ? formatThaiDate(project.startDate) : '-',
    endDate: project.endDate ? formatThaiDate(project.endDate) : '-',
    status: PROJECT_STATUS_LABELS[project.status],
  };

  useEffect(() => {
    if (!contentRef.current) return;
    const targets = contentRef.current.querySelectorAll('.animate-glass-card');
    animateStaggerEntrance(targets, { y: 12, stagger: 0.04, duration: 0.3 });
  }, [activeTab]);

  const tabs: { key: WorkspaceTab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'ภาพรวม', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { key: 'cashflow', label: 'รายรับรายจ่ายโครงการ', icon: <FileSpreadsheet className="w-3.5 h-3.5" /> },
    { key: 'boq', label: 'BOQ', icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'cost-perf', label: 'Cost Performance', icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { key: 'vo', label: 'งานเพิ่ม/ลด (VO)', icon: <FilePlus className="w-3.5 h-3.5" /> },
    { key: 'tasks', label: 'งาน', icon: <CheckSquare className="w-3.5 h-3.5" /> },
    { key: 'gantt', label: 'แกนต์ / S-Curve', icon: <BarChart2 className="w-3.5 h-3.5" /> },
    { key: 'calendar', label: 'ปฏิทิน', icon: <CalendarIcon className="w-3.5 h-3.5" /> },
    { key: 'photos', label: 'รูปภาพ', icon: <Camera className="w-3.5 h-3.5" /> },
    { key: 'reports', label: 'รายงาน', icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'docs', label: 'เอกสารโครงการ', icon: <Folder className="w-3.5 h-3.5" /> },
    { key: 'chat', label: 'แชท', icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { key: 'team', label: 'ทีมงาน', icon: <Users className="w-3.5 h-3.5" /> },
    { key: 'settings', label: 'ตั้งค่า', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-4 pb-12 font-sans antialiased">
      {/* 1. Hero Header Banner matching reference screenshot (media_1793629923741_02626c18.png) */}
      <div className="relative rounded-2xl overflow-hidden bg-slate-900 text-white shadow-md border border-slate-700/50">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-luminosity pointer-events-none"
          style={{ backgroundImage: `url("${coverPhoto || PROJECT_COVER_PRESETS[0]}")` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/60 to-transparent" />

        <div className="relative z-10 p-5 sm:p-6 md:p-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-3">
            <Link
              href="/projects"
              prefetch={false}
              className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition font-medium group"
            >
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
              <span>โครงการทั้งหมด</span>
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-black/60 border border-white/20 text-white backdrop-blur-xs">
                {project.code}
              </span>
              <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                {projectInfo.status}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-600/40 text-blue-200 border border-blue-400/40">
                เกินกำหนด {overdueTasks.length}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-sm">
              {project.name}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 pt-1">
              <span className="flex items-center gap-1.5 opacity-90">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{projectInfo.customer}</span>
              </span>
              <span className="flex items-center gap-1.5 opacity-90">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>{projectInfo.location}</span>
              </span>
              <span className="flex items-center gap-1.5 opacity-90">
                <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {project.startDate || project.endDate
                    ? `${projectInfo.startDate} - ${projectInfo.endDate}`
                    : 'ยังไม่กำหนดระยะเวลา'}
                </span>
              </span>
            </div>
          </div>

          {/* Floating Glass Card: ความคืบหน้า 0% */}
          <div className="liquid-glass-clean !bg-white/95 text-slate-900 p-4 rounded-xl shadow-lg border border-white/60 w-full sm:w-64 shrink-0">
            <div className="flex items-center justify-between text-xs font-semibold mb-1">
              <span className="text-slate-600">ความคืบหน้า</span>
              <span className="font-mono text-sm font-bold text-[#2453d4]">
                {project.progress ?? 0}%
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-[#2453d4] rounded-full transition-all duration-500"
                style={{ width: `${project.progress ?? 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Horizontal Sub-Navigation Tabs Ribbon (14 Tabs) */}
      <div className="relative rounded-xl border border-[#1e2a4a] bg-gradient-to-r from-[#0b1430] via-[#13224a] to-[#0b1430] p-1.5 shadow-lg shadow-slate-900/20 overflow-x-auto scrollbar-thin">
        {/* Thin champagne highlight along the top edge */}
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#d4b26a]/70 to-transparent" />
        <div className="flex items-center gap-1 min-w-max text-xs">
          {tabs.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition select-none ${
                  isActive
                    ? 'bg-gradient-to-b from-[#f3dfa8] to-[#c9a253] text-[#1a1408] font-semibold shadow-md shadow-black/30 ring-1 ring-[#f6e7bd]/60'
                    : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. 4-Card Summary KPI Row (Matching Image Exactly) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1 hover:border-slate-300 transition">
          <div className="text-xs font-medium text-slate-500">เสร็จสิ้น</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
            {doneCount}/{tasks.length}
          </div>
          <div className="text-[11px] text-slate-400">งานที่ปิดแล้ว</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1 hover:border-slate-300 transition">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>กำลังดำเนินการ</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">{inProgressTasks.length}</div>
          <div className="text-[11px] text-slate-400">งานที่ค้างทำ</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1 hover:border-slate-300 transition">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>เกินกำหนด</span>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-amber-600 font-mono">{overdueTasks.length}</div>
          <div className="text-[11px] text-slate-400">ต้องติดตาม</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1 hover:border-slate-300 transition">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>ทีมงาน</span>
            <Users className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
            {teamCount}
          </div>
          <div className="text-[11px] text-slate-400">สมาชิกที่ได้รับมอบหมาย</div>
        </div>
      </div>

      {/* 4. Dynamic Main Content Area */}
      <div ref={contentRef} className="space-y-4">
        {/* Tab 1: ภาพรวม (Overview - Matching User Reference Screenshot 100%) */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Column (5 Cols) */}
            <div className="lg:col-span-5 space-y-4 animate-glass-card">
              {/* Card 1: สถานะการทำงาน */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">สถานะการทำงาน</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      สรุปงานที่กำลังดำเนินการและรายการที่ต้องติดตาม
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('tasks')}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                  >
                    เปิดดูงาน
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* กำลังดำเนินการ */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span>กำลังดำเนินการ</span>
                      <span className="text-slate-400">{inProgressTasks.length}</span>
                    </div>
                    {inProgressTasks.length === 0 ? (
                      <div className="py-12 text-center text-slate-400 text-xs bg-slate-50/60 rounded-lg border border-dashed border-slate-200">
                        ไม่มีงานที่กำลังดำเนินการ
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {inProgressTasks.slice(0, 5).map((task) => (
                          <div
                            key={task.id}
                            className="p-3 rounded-lg border border-slate-200 bg-white space-y-1"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-medium text-slate-800 line-clamp-1">{task.title}</span>
                              <span className="text-[10px] font-mono text-slate-500 shrink-0">{task.progress}%</span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              กำหนดส่ง {task.dueDate ?? '-'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* เกินกำหนด */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span>เกินกำหนด</span>
                      <span className="text-amber-600 font-bold">{overdueTasks.length}</span>
                    </div>
                    <div className="space-y-2">
                      {overdueTasks.length === 0 && (
                        <div className="py-12 text-center text-slate-400 text-xs bg-slate-50/60 rounded-lg border border-dashed border-slate-200">
                          ไม่มีงานเกินกำหนด
                        </div>
                      )}
                      {overdueTasks.slice(0, 5).map((task) => (
                        <div
                          key={task.id}
                          className="p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition bg-white space-y-1"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-medium text-slate-800 line-clamp-1">
                              {task.title}
                            </span>
                            <span className="text-[10px] font-bold text-red-600 shrink-0">
                              เกินกำหนด
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            -- กำหนดส่ง {task.dueDate}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: ข้อมูลโครงการ (Matching Screenshot 100%) */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-slate-600" />
                    <h3 className="text-sm font-bold text-slate-900">ข้อมูลโครงการ</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditProjectModalOpen(true)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                  >
                    <Pencil className="w-3 h-3 text-slate-500" />
                    <span>แก้ไข</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-4 gap-x-2 text-xs">
                  {/* Row 1 */}
                  <div>
                    <span className="text-slate-400 text-[11px] block">ลูกค้า</span>
                    <span className="font-bold text-slate-800 line-clamp-2 mt-0.5">
                      {projectInfo.customer}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">กลุ่มโปรเจค</span>
                    <span className="text-slate-700 font-medium block mt-0.5">{projectInfo.group}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">ผู้ติดต่อ</span>
                    <span className="text-slate-700 font-medium block mt-0.5">{projectInfo.contactPerson}</span>
                  </div>

                  {/* Row 2 */}
                  <div>
                    <span className="text-slate-400 text-[11px] flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" />
                      <span>โทรศัพท์</span>
                    </span>
                    <span className="text-slate-700 font-medium block mt-0.5">{projectInfo.phone}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      <span>สถานที่</span>
                    </span>
                    <span className="text-slate-800 font-semibold block mt-0.5">{projectInfo.location}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">ผู้จัดการโครงการ</span>
                    <span className="text-slate-800 font-bold block mt-0.5">{projectInfo.projectManager}</span>
                  </div>

                  {/* Row 3 */}
                  <div>
                    <span className="text-slate-400 text-[11px] block">งบประมาณ</span>
                    <span className="font-mono font-bold text-slate-900 text-sm block mt-0.5">
                      {projectInfo.budget}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] flex items-center gap-1">
                      <CalendarIcon className="w-3 h-3 text-slate-400" />
                      <span>วันที่เริ่ม</span>
                    </span>
                    <span className="font-mono text-slate-700 block mt-0.5">{projectInfo.startDate}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] flex items-center gap-1">
                      <CalendarIcon className="w-3 h-3 text-slate-400" />
                      <span>วันที่สิ้นสุด</span>
                    </span>
                    <span className="font-mono text-slate-700 block mt-0.5">{projectInfo.endDate}</span>
                  </div>

                  {/* Row 4 */}
                  <div className="col-span-3 pt-1 border-t border-slate-100">
                    <span className="text-slate-400 text-[11px] block">สถานะ</span>
                    <span className="font-bold text-slate-900 block mt-0.5">{projectInfo.status}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column (7 Cols) */}
            <div className="lg:col-span-7 space-y-4 animate-glass-card">
              {/* Satellite Map */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs relative">
                <div className="absolute top-3 left-3 z-10">
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(project.location || project.name)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1 rounded bg-white/95 backdrop-blur-xs text-xs font-semibold text-slate-700 shadow-md hover:bg-white transition"
                  >
                    <span>Open in Maps</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="h-64 sm:h-72 w-full bg-slate-900 relative">
                  {project.location ? (
                    <iframe
                      title={`แผนที่ ${project.location}`}
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(project.location)}&t=k&z=12&output=embed`}
                      className="w-full h-full border-0 brightness-95"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                      ยังไม่ได้ระบุสถานที่ก่อสร้าง
                    </div>
                  )}
                </div>
              </div>

              {/* 3 Middle Cards: สถานที่ (Weather) | เพิ่มรูปโครงการ | ความคืบหน้า (Radial Gauge) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Card A: สถานที่ */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-sm">สถานที่</span>
                      <Heart className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    </div>
                    <div className="text-xs text-slate-700 font-semibold">{projectInfo.location}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{project.code}</div>
                  </div>

                  {/* 3 stats */}
                  <div className="grid grid-cols-3 gap-1 pt-2 border-t border-slate-100 text-center text-slate-700">
                    <div className="p-1 rounded bg-slate-50">
                      <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5">
                        <CalendarIcon className="w-3 h-3" />
                        <span>อายุ</span>
                      </div>
                      <div className="font-bold font-mono text-xs mt-0.5">{schedule.elapsed === null ? '-' : `${schedule.elapsed} วัน`}</div>
                    </div>
                    <button type="button" onClick={() => setActiveTab('team')} className="p-1 rounded bg-slate-50 hover:bg-slate-100">
                      <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5">
                        <Users className="w-3 h-3" />
                        <span>สมาชิก</span>
                      </div>
                      <div className="font-bold font-mono text-xs mt-0.5">{teamCount}</div>
                    </button>
                    <button type="button" onClick={() => setActiveTab('photos')} className="p-1 rounded bg-slate-50 hover:bg-slate-100">
                      <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5">
                        <Camera className="w-3 h-3" />
                        <span>รูปภาพ</span>
                      </div>
                      <div className="font-bold font-mono text-xs mt-0.5">{photoCount}</div>
                    </button>
                  </div>

                  {/* Contract period */}
                  <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200 space-y-1.5 text-[11px]">
                    <div className="font-semibold text-slate-700">ระยะเวลาสัญญา</div>
                    {schedule.total === null ? (
                      <div className="text-slate-400">ยังไม่ได้กำหนดวันเริ่ม-สิ้นสุด</div>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">ทั้งหมด</span>
                          <span className="font-mono font-semibold">{schedule.total} วัน</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">{(schedule.remaining ?? 0) >= 0 ? 'เหลือ' : 'เกินกำหนด'}</span>
                          <span className={`font-mono font-semibold ${(schedule.remaining ?? 0) < 0 ? 'text-red-600' : ''}`}>
                            {Math.abs(schedule.remaining ?? 0)} วัน
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div className="h-full bg-amber-500" style={{ width: `${schedule.timePercent}%` }} />
                        </div>
                        <div className="text-[10px] text-slate-400">เวลาผ่านไป {schedule.timePercent}% · ผลงาน {project.progress ?? 0}%</div>
                      </>
                    )}
                  </div>
                </div>

                {/* Card B: เพิ่มรูปโครงการ */}
                <div
                  onClick={() => project.canEdit && setIsCoverPhotoModalOpen(true)}
                  className={`bg-[#f5f5f4] transition rounded-xl border border-slate-200/80 p-4 shadow-xs flex flex-col items-center justify-center text-center min-h-[220px] group ${
                    project.canEdit ? 'hover:bg-[#eaeae8] cursor-pointer' : ''
                  }`}
                >
                  {coverPhoto ? (
                    <div className="w-full h-full rounded-lg overflow-hidden relative">
                      <img src={coverPhoto} alt="Project Cover" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-semibold transition">
                        เปลี่ยนรูป
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 text-blue-600 flex items-center justify-center shadow-xs mb-2 group-hover:scale-105 transition-transform">
                        <ImageIcon className="w-6 h-6 text-blue-600" />
                      </div>
                      <span className="font-semibold text-xs text-blue-600 group-hover:underline">
                        เพิ่มรูปโครงการ
                      </span>
                      <span className="text-[11px] text-slate-400 mt-1">ยังไม่มีรูปโครงการ</span>
                    </>
                  )}
                </div>

                {/* Card C: ความคืบหน้า (Semi-circular radial gauge) */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between min-h-[220px]">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-sm">ความคืบหน้า</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-200">
                        {project.progress ?? 0}%
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      ภาพรวมสถานะของโครงการนี้
                    </p>
                  </div>

                  {/* Half-donut Semi-circle Radial Gauge */}
                  <div className="py-2 flex items-center justify-center relative">
                    <svg className="w-32 h-16 overflow-visible" viewBox="0 0 100 55">
                      <path
                        d="M 10 50 A 40 40 0 0 1 90 50"
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="10"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 10 50 A 40 40 0 0 1 90 50"
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray="126"
                        strokeDashoffset={126 - (126 * (project.progress ?? 0)) / 100}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
                      <span className="font-mono font-bold text-base text-slate-900">{project.progress ?? 0}%</span>
                      <span className="text-[10px] text-slate-400">ถ่วงน้ำหนักตามมูลค่างาน</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <span className="text-slate-400 text-[11px]">งานที่เสร็จสิ้น</span>
                    <span className="font-mono font-bold text-slate-800">
                      {doneCount}/{tasks.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom: ทีมงาน */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">ทีมงาน</h3>
                    <p className="text-xs text-slate-400 mt-0.5">ทีมงานโครงการ</p>
                  </div>
                  <button type="button" onClick={() => setActiveTab('team')} className="text-xs font-medium text-[#2453d4] hover:underline">
                    {teamCount} คน · ดูทีมงาน
                  </button>
                </div>

                {project.pmName ? (
                  <div className="flex items-center gap-3 pt-1">
                    <div className="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-sm text-slate-700 shadow-2xs">
                      {project.pmName.slice(0, 2)}
                    </div>
                    <div className="text-xs">
                      <div className="font-bold text-slate-900">{project.pmName}</div>
                      <div className="text-blue-600 font-medium text-[11px]">ผู้จัดการโครงการ (PM)</div>
                      <div className="text-slate-400 text-[10px] font-mono">
                        {allUsers.find((u) => u.id === project.pmUserId)?.email ?? ''}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 pt-1">ยังไม่ได้กำหนดผู้จัดการโครงการ</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: รายรับรายจ่ายโครงการ (Cash Flow - Matching reference Layout Exactly) */}
        {activeTab === 'cashflow' && (
          <div className="animate-glass-card">
            <ProjectCashflowView projectId={project.id} />
          </div>
        )}

        {/* Tab 3: BOQ (Full Sheet Editor matching user reference image) */}
        {activeTab === 'boq' && (
          <div className="animate-glass-card">
            <ProjectBoqPanel
              projectId={project.id}
              projectCode={project.code}
              projectName={project.name}
              location={project.location}
              mainBoq={initialBoq}
              canEdit={canEditBoq}
              voBoqs={voData.vos.map((v) => ({
                voId: v.id,
                voNumber: v.number,
                title: v.title,
                status: v.status,
                boqNumber: v.boqNumber,
                lineCount: v.boqLineCount,
                // Same basis as the main BOQ's grand total: including VAT
                addAmount: voCostImpact(v.addAmount, 0, v.vatPercent).netWithVat.toNumber(),
              }))}
            />
          </div>
        )}

        {/* Tab 4: Cost Performance (EVM - Matching reference Screenshot media_1793676743058_4bd26ae3.png) */}
        {activeTab === 'cost-perf' && (
          <div className="animate-glass-card">
            <ProjectCostPerformanceView
              projectId={project.id}
              projectName={project.name}
              location={projectInfo.location}
              startDate={projectInfo.startDate}
              endDate={projectInfo.endDate}
              projectManager={projectInfo.projectManager}
            />
          </div>
        )}

        {/* Tab 5: งานเพิ่ม/ลด (VO) - Matching reference Screenshot media_1793676877859_b0f738bb.png */}
        {activeTab === 'vo' && (
          <div className="animate-glass-card">
            <ProjectVoView data={voData} location={project.location} />
          </div>
        )}

        {/* Tab 6: งาน (Tasks) - kanban backed by project_tasks */}
        {activeTab === 'tasks' && (
          <ProjectTasksBoard
            projectId={project.id}
            tasks={tasks}
            canManage={taskList.canManage}
            canUpdateProgress={taskList.canUpdateProgress}
            users={allUsers}
            today={today}
          />
        )}

        {/* Tab 7: แกนต์ / S-Curve - derived from the same tasks */}
        {activeTab === 'gantt' && <ProjectGanttView tasks={tasks} today={today} />}
        {activeTab === 'calendar' && <CalendarPanel projectId={project.id} today={today} />}
        {activeTab === 'photos' && <FilesPanel projectId={project.id} kind="PHOTO" me={me} />}
        {activeTab === 'reports' && (
          <ReportsPanel
            project={{ id: project.id, name: project.name, location: project.location, group: project.projectGroup, startDate: project.startDate, endDate: project.endDate }}
            today={today}
            preparedBy={meName}
            logoUrl={companyLogoUrl}
            // Only leaf tasks carry progress; a parent just groups its children
            tasks={tasks.filter((t) => !tasks.some((c) => c.parentId === t.id)).map((t) => ({ id: t.id, wbs: t.wbs, title: t.title, progress: t.progress }))}
          />
        )}
        {activeTab === 'docs' && <FilesPanel projectId={project.id} kind="FILE" me={me} />}
        {activeTab === 'chat' && <ChatPanel projectId={project.id} me={me} />}
        {activeTab === 'team' && <TeamPanel projectId={project.id} />}

        {/* Tab 14: ตั้งค่า (Settings) */}
        {activeTab === 'settings' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6 max-w-3xl animate-glass-card">
            <div>
              <h3 className="text-base font-bold text-slate-900">ตั้งค่าข้อมูลโครงการ</h3>
              <p className="text-xs text-slate-500">แก้ไขรายละเอียดสัญญา วันเริ่ม-สิ้นสุด และเงื่อนไขการส่งมอบ</p>
            </div>

            <ProjectDetailsForm project={project} users={allUsers} customers={customers} />
          </div>
        )}
      </div>

      {/* MODAL 4: แก้ไขข้อมูลโครงการ */}
      {isEditProjectModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">แก้ไขข้อมูลโครงการ</h3>
              <button
                type="button"
                onClick={() => setIsEditProjectModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ProjectDetailsForm
              project={project}
              users={allUsers}
              customers={customers}
              onSaved={() => setIsEditProjectModalOpen(false)}
              onCancel={() => setIsEditProjectModalOpen(false)}
            />
          </div>
        </div>
      )}

      {/* MODAL 5: เพิ่มรูปโครงการ */}
      {isCoverPhotoModalOpen && (
        <ProjectCoverPicker
          projectId={project.id}
          current={coverPhoto}
          onClose={() => setIsCoverPhotoModalOpen(false)}
          onChanged={setCoverPhoto}
        />
      )}

    </div>
  );
}
