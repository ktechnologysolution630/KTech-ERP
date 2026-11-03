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
  AlertTriangle,
  MapPin,
  Building2,
  Star,
  ExternalLink,
  ChevronRight,
  Plus,
  Search,
  Filter,
  DollarSign,
  Download,
  Share2,
  Upload,
  Send,
  Eye,
  Trash2,
  Edit,
  Save,
  X,
  Paperclip,
  Sun,
  Thermometer,
  Droplets,
  Wind,
  Heart,
  Phone,
  Pencil,
  Image as ImageIcon,
} from 'lucide-react';
import { animateStaggerEntrance } from '@/lib/gsap-smooth';
import { ProjectBoqPanel } from '@/components/project-boq-panel';
import type { BoqDocumentDto } from '@/server/services/boq';
import type { ProjectDetailDto } from '@/server/services/master';
import { PROJECT_STATUS_LABELS } from '@/domain/project';
import { ProjectDetailsForm } from '@/components/project-details-form';
import { ProjectTasksBoard } from '@/components/project-tasks-board';
import { ProjectGanttView } from '@/components/project-gantt-view';
import { isTaskOverdue } from '@/domain/schedule';
import { voCostImpact } from '@/domain/variation-order';
import { ProjectCoverPicker } from '@/components/project-cover-picker';
import type { ProjectTaskList } from '@/server/services/tasks';
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
}: ProjectWorkspaceProps) {
  const tasks = taskList.tasks;
  const doneCount = tasks.filter((t) => t.status === 'DONE').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'IN_PROGRESS');
  const overdueTasks = tasks.filter((t) => isTaskOverdue(t, today));
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const contentRef = useRef<HTMLDivElement>(null);

  // Modals state
  const [isBoqModalOpen, setIsBoqModalOpen] = useState(false);
  const [isVoModalOpen, setIsVoModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isEditProjectModalOpen, setIsEditProjectModalOpen] = useState(false);
  const [isCoverPhotoModalOpen, setIsCoverPhotoModalOpen] = useState(false);
  const [isDailyReportModalOpen, setIsDailyReportModalOpen] = useState(false);
  const [isUploadDocModalOpen, setIsUploadDocModalOpen] = useState(false);
  const [isCalendarEventModalOpen, setIsCalendarEventModalOpen] = useState(false);
  const [coverPhoto, setCoverPhoto] = useState<string | null>(project.coverImageUrl || null);

  // New Daily Report Form State
  const [newDailyReport, setNewDailyReport] = useState({
    title: '',
    date: new Date().toISOString().split('T')[0],
    weather: 'แดดจัด ท้องฟ้าแจ่มใส',
    workerCount: 24,
    machinery: 'รถแบ็คโฮ 2 คัน, รถโม่ปูน 4 คัน, เครื่องตอกเสาเข็ม 1 ชุด',
    workSummary: '',
    issues: 'ไม่มีอุปสรรค การจราจรคล่องตัว',
  });

  // Daily Reports List
  const [dailyReportsList, setDailyReportsList] = useState([
    {
      id: 1,
      title: 'รายงานประจำวันช่างควบคุมงาน (Daily Site Log #45)',
      date: '2026-11-02',
      weather: 'แดดจัด 35°C',
      workers: '24 คน',
      summary: 'ดำเนินการขุดดินเปิดปากหลุมฐานราก F1-F4 และสกัดหัวเสาเข็มเจาะ 4 ต้น',
      size: '1.2 MB',
    },
    {
      id: 2,
      title: 'รายงานความก้าวหน้ารายสัปดาห์ (Weekly Progress Report #08)',
      date: '2026-10-31',
      weather: 'มีเมฆมาก 32°C',
      workers: '28 คน',
      summary: 'สรุปผลงานเจาะเสาเข็มครบ 100% เตรียมเทลีนคอนกรีตฐานราก',
      size: '2.4 MB',
    },
    {
      id: 3,
      title: 'รายงานความปลอดภัยประจำเดือน (Safety & Environmental Monthly Log)',
      date: '2026-10-30',
      weather: 'ปกติ',
      workers: '30 คน',
      summary: 'ตรวจสอบอุปกรณ์ดับเพลิง แผงกั้นหลุมขุด และการสวมใส่ PPE 100%',
      size: '1.8 MB',
    },
    {
      id: 4,
      title: 'รายงานผลการทดสอบกำลังอัดคอนกรีต 7 วัน และ 14 วัน',
      date: '2026-10-25',
      weather: 'ปกติ',
      workers: '-',
      summary: 'ผลทดสอบ Cube 280 ksc ผ่านเกณฑ์มาตรฐานทุกตัวอย่าง',
      size: '950 KB',
    },
  ]);

  // Project Documents List
  const [documentsList, setDocumentsList] = useState([
    { id: 1, name: 'แบบสถาปัตยกรรม (Architectural Drawings Rev.02)', count: '14 ไฟล์', category: 'แบบก่อสร้าง' },
    { id: 2, name: 'แบบวิศวกรรมโครงสร้าง (Structural Plans)', count: '8 ไฟล์', category: 'แบบวิศวกรรม' },
    { id: 3, name: 'สัญญาจ้างก่อสร้างและหลักประกันสัญญา', count: '3 ไฟล์', category: 'สัญญาและกฎหมาย' },
    { id: 4, name: 'หนังสือส่งมอบพื้นที่และการอนุญาตเข้าทำงาน', count: '2 ไฟล์', category: 'หนังสือราชการ' },
    { id: 5, name: 'ตาราง BOQ บัญชีราคากลางกรมบัญชีกลาง', count: '1 ไฟล์', category: 'ประมาณราคา' },
  ]);

  // New Doc Form
  const [newDocForm, setNewDocForm] = useState({
    name: '',
    category: 'แบบสถาปัตยกรรม',
    filesCount: '1 ไฟล์ (PDF)',
  });

  // Calendar Events
  const [calendarEvents, setCalendarEvents] = useState([
    { day: 3, title: 'ส่งปูนเทฐานราก', color: 'bg-blue-600' },
    { day: 10, title: 'ตรวจหมุดเขต', color: 'bg-amber-500' },
    { day: 25, title: 'ส่งมอบงวด 1', color: 'bg-purple-600' },
  ]);

  // New Event Form
  const [newEventForm, setNewEventForm] = useState({
    day: 15,
    title: '',
    color: 'bg-blue-600',
  });

  // New Team Member Form
  const [newMemberForm, setNewMemberForm] = useState({
    name: '',
    role: 'วิศวกรโยธา (Civil Engineer)',
    email: '',
    phone: '',
  });

  // Display values for the overview card, derived from the saved project (refreshed after edits)
  const projectInfo = {
    customer: project.clientName || '-',
    group: project.projectGroup || '-',
    contactPerson: project.contactName || '-',
    phone: project.contactPhone || '-',
    location: project.location || '-',
    projectManager: project.pmName ?? '-',
    budget: project.budget.toLocaleString('th-TH'),
    startDate: project.startDate ?? '-',
    endDate: project.endDate ?? '-',
    status: PROJECT_STATUS_LABELS[project.status],
  };

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    {
      id: 1,
      sender: 'วิศวกรสนาม (สมชาย)',
      time: '08:45 น.',
      text: 'วันนี้เริ่มลงเสาเข็มเจาะต้นที่ 12-15 แล้วครับ ดินช่วงล่างแน่นดี ไม่มีน้ำซึม',
      isMe: false,
    },
    {
      id: 2,
      sender: 'คุณสมชาย ตัวอย่าง (PM)',
      time: '09:10 น.',
      text: 'รับทราบครับ ถ่ายรูปเช็คระดับหัวเสาเข็มและส่งรายงานทดสอบ slump test ด้วยนะ',
      isMe: true,
    },
    {
      id: 3,
      sender: 'วิศวกรสนาม (สมชาย)',
      time: '09:12 น.',
      text: 'ผล slump 10 ซม. ผ่านเกณฑ์มาตรฐานครับ เดี๋ยวอัปโหลดผลทดสอบในแท็บเอกสารครับ',
      isMe: false,
    },
  ]);

  // BOQ Items
  const [boqItems, setBoqItems] = useState([
    {
      id: 1,
      category: '1. งานเตรียมการและรื้อถอน',
      item: '1.1 งานปรับพื้นที่และรื้อถอนสิ่งกีดขวางเดิม',
      qty: 1,
      unit: 'งาน',
      matRate: 0,
      labRate: 50000,
      total: 50000,
    },
    {
      id: 2,
      category: '2. งานฐานรากและโครงสร้างใต้ดิน',
      item: '2.1 เสาเข็มเจาะ ค.อ.ล. เส้นผ่านศูนย์กลาง 0.60 ม. ลึก 24 ม.',
      qty: 84,
      unit: 'ต้น',
      matRate: 18500,
      labRate: 4500,
      total: 1932000,
    },
    {
      id: 3,
      category: '2. งานฐานรากและโครงสร้างใต้ดิน',
      item: '2.2 งานคอนกรีตฐานราก (Footing) 280 ksc',
      qty: 240,
      unit: 'ลบ.ม.',
      matRate: 2200,
      labRate: 450,
      total: 636000,
    },
    {
      id: 4,
      category: '3. งานโครงสร้างคอนกรีตเสริมเหล็ก',
      item: '3.1 คอนกรีตเสาและคาน ชั้น 1-3 320 ksc',
      qty: 620,
      unit: 'ลบ.ม.',
      matRate: 2350,
      labRate: 550,
      total: 1798000,
    },
    {
      id: 5,
      category: '3. งานโครงสร้างคอนกรีตเสริมเหล็ก',
      item: '3.2 เหล็กเส้นกลมและข้ออ้อย SD40 (DB12, DB16, DB20, DB25)',
      qty: 48,
      unit: 'ตัน',
      matRate: 26500,
      labRate: 3500,
      total: 1440000,
    },
  ]);

  // Variation Orders (VO)
  const [voList, setVoList] = useState([
    {
      id: 1,
      code: 'VO-001',
      title: 'ปรับเพิ่มความลึกเสาเข็มจาก 21 ม. เป็น 24 ม. ตามสภาพชั้นดินจริง',
      amount: 295000,
      status: 'APPROVED',
      requestDate: '2026-09-20',
      approvedBy: 'ผู้ควบคุมงานศาลฯ',
    },
    {
      id: 2,
      code: 'VO-002',
      title: 'งานเสริมเหล็กโครงสร้างห้องมั่นคงชั้นใต้ดิน',
      amount: 148000,
      status: 'PENDING',
      requestDate: '2026-10-12',
      approvedBy: 'รออนุมัติจากสำนักการโยธา',
    },
  ]);

  // Team Members
  const [teamMembers, setTeamMembers] = useState([
    {
      id: 1,
      name: 'นายสมชาย ตัวอย่าง',
      role: 'Project Manager (ผู้จัดการโครงการ)',
      email: 'pm@ktec.local',
      phone: '081-998-1234',
    },
    {
      id: 2,
      name: 'นายสมชาย วิศวกรรม',
      role: 'Site Engineer (วิศวกรโยธาประจำไซต์)',
      email: 'somchai.eng@ktec.local',
      phone: '089-445-6789',
    },
    {
      id: 3,
      name: 'นายเกียรติศักดิ์ ปลอดภัย',
      role: 'Safety Officer (จป.วิชาชีพ)',
      email: 'safety@ktec.local',
      phone: '086-112-9900',
    },
  ]);

  // New BOQ Form state
  const [newBoq, setNewBoq] = useState({
    category: '2. งานฐานรากและโครงสร้างใต้ดิน',
    item: '',
    qty: 1,
    unit: 'ต้น',
    matRate: 0,
    labRate: 0,
  });


  // New VO Form state
  const [newVo, setNewVo] = useState({
    title: '',
    amount: 0,
    status: 'PENDING',
  });

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

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setChatMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        sender: 'คุณสมชาย ตัวอย่าง (PM)',
        time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.',
        text: chatInput.trim(),
        isMe: true,
      },
    ]);
    setChatInput('');
  };

  const handleAddBoq = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoq.item) return;
    const total = Number(newBoq.qty) * (Number(newBoq.matRate) + Number(newBoq.labRate));
    setBoqItems((prev) => [
      ...prev,
      {
        id: Date.now(),
        category: newBoq.category,
        item: newBoq.item,
        qty: Number(newBoq.qty),
        unit: newBoq.unit,
        matRate: Number(newBoq.matRate),
        labRate: Number(newBoq.labRate),
        total,
      },
    ]);
    setIsBoqModalOpen(false);
    setNewBoq({
      category: '2. งานฐานรากและโครงสร้างใต้ดิน',
      item: '',
      qty: 1,
      unit: 'ต้น',
      matRate: 0,
      labRate: 0,
    });
  };

  const handleAddVo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVo.title) return;
    setVoList((prev) => [
      ...prev,
      {
        id: Date.now(),
        code: `VO-00${prev.length + 1}`,
        title: newVo.title,
        amount: Number(newVo.amount),
        status: newVo.status,
        requestDate: new Date().toISOString().split('T')[0],
        approvedBy: 'รออนุมัติกรรมการตรวจการจ้าง',
      },
    ]);
    setIsVoModalOpen(false);
    setNewVo({ title: '', amount: 0, status: 'PENDING' });
  };

  const handleAddDailyReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDailyReport.title.trim()) return;
    setDailyReportsList((prev) => [
      {
        id: Date.now(),
        title: newDailyReport.title.trim(),
        date: newDailyReport.date,
        weather: newDailyReport.weather,
        workers: `${newDailyReport.workerCount} คน`,
        summary: newDailyReport.workSummary || 'งานคืบหน้าตามแผนงาน',
        size: '1.5 MB',
      },
      ...prev,
    ]);
    setIsDailyReportModalOpen(false);
    setNewDailyReport({
      title: '',
      date: new Date().toISOString().split('T')[0],
      weather: 'แดดจัด ท้องฟ้าแจ่มใส',
      workerCount: 24,
      machinery: 'รถแบ็คโฮ 2 คัน, รถโม่ปูน 4 คัน, เครื่องตอกเสาเข็ม 1 ชุด',
      workSummary: '',
      issues: 'ไม่มีอุปสรรค การจราจรคล่องตัว',
    });
  };

  const handleAddDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocForm.name.trim()) return;
    setDocumentsList((prev) => [
      {
        id: Date.now(),
        name: newDocForm.name.trim(),
        count: newDocForm.filesCount,
        category: newDocForm.category,
      },
      ...prev,
    ]);
    setIsUploadDocModalOpen(false);
    setNewDocForm({
      name: '',
      category: 'แบบสถาปัตยกรรม',
      filesCount: '1 ไฟล์ (PDF)',
    });
  };

  const handleAddCalendarEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventForm.title.trim()) return;
    setCalendarEvents((prev) => [
      ...prev,
      {
        day: Number(newEventForm.day) || 1,
        title: newEventForm.title.trim(),
        color: newEventForm.color,
      },
    ]);
    setIsCalendarEventModalOpen(false);
    setNewEventForm({
      day: 15,
      title: '',
      color: 'bg-blue-600',
    });
  };

  const handleAddTeamMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberForm.name.trim()) return;
    setTeamMembers((prev) => [
      ...prev,
      {
        id: Date.now(),
        name: newMemberForm.name.trim(),
        role: newMemberForm.role,
        email: newMemberForm.email || 'user@ktec.local',
        phone: newMemberForm.phone || '080-000-0000',
      },
    ]);
    setIsTeamModalOpen(false);
    setNewMemberForm({
      name: '',
      role: 'วิศวกรโยธา (Civil Engineer)',
      email: '',
      phone: '',
    });
  };

  // Grand Total for BOQ
  const boqGrandTotal = boqItems.reduce((acc, curr) => acc + curr.total, 0);

  return (
    <div className="space-y-4 pb-12 font-sans antialiased">
      {/* 1. Hero Header Banner matching reference screenshot (media_1793629923741_02626c18.png) */}
      <div className="relative rounded-2xl overflow-hidden bg-slate-900 text-white shadow-md border border-slate-700/50">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-luminosity pointer-events-none"
          style={{
            backgroundImage:
              'url("https://images.unsplash.com/photo-1541888946425-d0fbb18615f3?q=80&w=1600&auto=format&fit=crop")',
          }}
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
                  {projectInfo.startDate} - {projectInfo.endDate}
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
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-xs overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-1 min-w-max text-xs">
          {tabs.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition select-none ${
                  isActive
                    ? 'bg-blue-50 text-[#2453d4] font-semibold border border-blue-200 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
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
            {teamMembers.length}
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
                      <div className="font-bold font-mono text-xs mt-0.5">1Y</div>
                    </div>
                    <div className="p-1 rounded bg-slate-50">
                      <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5">
                        <Users className="w-3 h-3" />
                        <span>สมาชิก</span>
                      </div>
                      <div className="font-bold font-mono text-xs mt-0.5">1</div>
                    </div>
                    <div className="p-1 rounded bg-slate-50">
                      <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5">
                        <Camera className="w-3 h-3" />
                        <span>รูปภาพ</span>
                      </div>
                      <div className="font-bold font-mono text-xs mt-0.5">0</div>
                    </div>
                  </div>

                  {/* TMD Weather widget */}
                  <div className="bg-amber-50/50 rounded-lg p-2.5 border border-amber-200/60 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-amber-800 tracking-wider">
                        TMD WEATHER
                      </span>
                      <Sun className="w-3.5 h-3.5 text-amber-500" />
                    </div>
                    <div className="text-[11px] text-slate-700 font-medium leading-tight">
                      <div>พยากรณ์วันนี้</div>
                      <div className="text-[10px] text-slate-400">กรุงเทพฯ • 3 พ.ย. 2569</div>
                    </div>
                    <div className="flex items-baseline justify-between pt-0.5">
                      <span className="font-bold font-mono text-sm text-slate-900">35° / 24°</span>
                      <span className="text-[10px] text-slate-500">สูงสุด/ต่ำสุด</span>
                    </div>
                    <div className="text-[10px] text-slate-500">ฝนฟ้าคะนอง 10%</div>
                    <div className="grid grid-cols-3 gap-1 pt-1 border-t border-amber-200/50 text-[9px] text-slate-600 text-center">
                      <span className="flex items-center justify-center gap-0.5">
                        <Thermometer className="w-2.5 h-2.5 text-red-500" /> 35°C
                      </span>
                      <span className="flex items-center justify-center gap-0.5">
                        <Droplets className="w-2.5 h-2.5 text-blue-500" /> 20%
                      </span>
                      <span className="flex items-center justify-center gap-0.5">
                        <Wind className="w-2.5 h-2.5 text-slate-500" /> 8 kn
                      </span>
                    </div>
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
                        0%
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
                        strokeDashoffset="126"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
                      <span className="font-mono font-bold text-base text-slate-900">0%</span>
                      <span className="text-[10px] text-slate-400">เสร็จแล้ว</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <span className="text-slate-400 text-[11px]">งานที่เสร็จสิ้น</span>
                    <span className="font-mono font-bold text-slate-800">0/5</span>
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
                  <span className="text-xs font-medium text-slate-500">{project.pmName ? '1 คน' : '0 คน'}</span>
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
            <ProjectCashflowView
              projectId={project.id}
              projectCode={project.code}
              projectName={project.name}
            />
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
              projectCode={project.code}
              projectName={project.name}
              location={projectInfo.location}
              budget={projectInfo.budget}
              startDate="15/09/2569"
              endDate="18/11/2570"
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
        {/* Tab 8: ปฏิทิน (Calendar) */}
        {activeTab === 'calendar' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4 animate-glass-card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900">ปฏิทินงานไซต์ก่อสร้าง (พฤศจิกายน 2026)</h3>
                <p className="text-xs text-slate-500">นัดหมายเทคอนกรีต ส่งมอบวัสดุ และนัดตรวจงาน</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-700">
                  พฤศจิกายน 2026
                </span>
                <button
                  type="button"
                  onClick={() => setIsCalendarEventModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700 transition flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ เพิ่มนัดหมาย</span>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-2 text-center text-xs">
              {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d) => (
                <div key={d} className="font-semibold text-slate-500 py-1">
                  {d}
                </div>
              ))}
              {Array.from({ length: 30 }, (_, i) => i + 1).map((day) => {
                const dayEvents = calendarEvents.filter((ev) => ev.day === day);
                return (
                  <div
                    key={day}
                    className={`min-h-[70px] p-1.5 rounded-lg border text-left flex flex-col justify-between transition ${
                      day === 3
                        ? 'bg-blue-50/80 border-blue-300 font-bold'
                        : 'border-slate-100 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <span className="text-[11px] font-mono text-slate-700">{day}</span>
                    <div className="space-y-1">
                      {dayEvents.map((ev, idx) => (
                        <span
                          key={idx}
                          className={`text-[9px] ${ev.color || 'bg-blue-600'} text-white p-1 rounded leading-tight block truncate`}
                        >
                          {ev.title}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 9: รูปภาพ (Photos) */}
        {activeTab === 'photos' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4 animate-glass-card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900">แกลเลอรี่รูปภาพหน้างาน</h3>
                <p className="text-xs text-slate-500">บันทึกภาพถ่ายประจำวัน ตรวจงานคุณภาพ และความปลอดภัย</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPhotoModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700 transition"
              >
                + อัปโหลดภาพถ่าย
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {[
                { title: 'งานขุดดินฐานรากและหัวเสาเข็ม', date: '2026-11-02', img: 'https://images.unsplash.com/photo-1541888946425-d0fbb18615f3?q=80&w=400' },
                { title: 'ตรวจสอบ Slump Test คอนกรีต', date: '2026-11-01', img: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?q=80&w=400' },
                { title: 'การผูกเหล็กเสริมเสาตอม่อ', date: '2026-10-29', img: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?q=80&w=400' },
                { title: 'ตรวจมาตรการความปลอดภัย PPE ไซต์', date: '2026-10-25', img: 'https://images.unsplash.com/photo-1590381105924-c72589b9ef3f?q=80&w=400' },
              ].map((pic, idx) => (
                <div key={idx} className="group rounded-lg overflow-hidden border border-slate-200 bg-slate-50 relative">
                  <div className="h-36 bg-slate-200 overflow-hidden">
                    <img
                      src={pic.img}
                      alt={pic.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="p-2 space-y-0.5">
                    <div className="text-xs font-medium text-slate-800 line-clamp-1">{pic.title}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{pic.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 10: รายงาน (Reports) */}
        {activeTab === 'reports' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4 animate-glass-card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  รายงานความก้าวหน้าและรายงานประจำวัน (Daily / Weekly Reports)
                </h3>
                <p className="text-xs text-slate-500">
                  เอกสารรายงานส่งผู้ควบคุมงานและผู้ว่าจ้าง พร้อมแบบฟอร์มบันทึกสภาพอากาศและแรงงาน
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDailyReportModalOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-semibold hover:bg-blue-700 transition flex items-center gap-1.5 shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ เขียนรายงานประจำวัน</span>
              </button>
            </div>

            <div className="divide-y divide-slate-100 text-xs">
              {dailyReportsList.map((rep) => (
                <div
                  key={rep.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50 transition px-2 rounded-lg"
                >
                  <div className="flex items-start gap-3">
                    <FileText className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-slate-900">{rep.title}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-2">
                        <span>วันที่: {rep.date}</span>
                        <span>• อากาศ: {rep.weather}</span>
                        <span>• คนงาน: {rep.workers}</span>
                        <span>• ขนาด: {rep.size}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-1 italic">
                        &quot;{rep.summary}&quot;
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => alert(`ดาวน์โหลดรายงาน: ${rep.title}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 transition text-xs self-end sm:self-center shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>ดาวน์โหลด PDF</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 11: เอกสารโครงการ (Docs) */}
        {activeTab === 'docs' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4 animate-glass-card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900">แฟ้มเอกสารโครงการและแบบก่อสร้าง</h3>
                <p className="text-xs text-slate-500">แบบสถาปัตย์ แบบวิศวกรรม สัญญา และหนังสือราชการ</p>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadDocModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700 transition flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ อัปโหลดเอกสาร</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {documentsList.map((f) => (
                <div
                  key={f.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 hover:border-slate-300 transition flex items-center gap-3 cursor-pointer group"
                >
                  <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Folder className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-800 truncate group-hover:text-blue-600">
                      {f.name}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {f.count} • {f.category}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 12: แชทสื่อสารหน้างาน (Chat) */}
        {activeTab === 'chat' && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs flex flex-col h-[520px] animate-glass-card">
            <div className="p-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="font-bold text-xs text-slate-800">
                  ห้องสนทนาไซต์งาน: {project.name}
                </span>
              </div>
              <span className="text-[11px] text-slate-400">สมาชิกออนไลน์ 3 คน</span>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#f8fafc]">
              {chatMessages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.isMe ? 'items-end' : 'items-start'} space-y-1`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span className="font-medium text-slate-600">{m.sender}</span>
                    <span>{m.time}</span>
                  </div>
                  <div
                    className={`max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed ${
                      m.isMe
                        ? 'bg-[#2453d4] text-white rounded-br-xs'
                        : 'bg-white text-slate-800 border border-slate-200 rounded-bl-xs shadow-xs'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
            >
              <button
                type="button"
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="พิมพ์ข้อความสื่อสารกับทีมงานไซต์..."
                className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-[#2453d4] hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <span>ส่ง</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}

        {/* Tab 13: ทีมงาน (Team) */}
        {activeTab === 'team' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4 animate-glass-card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900">ทีมงานผู้รับผิดชอบโครงการ</h3>
                <p className="text-xs text-slate-500">วิศวกร ผู้จัดการโครงการ จป. และทีมงานประจำไซต์</p>
              </div>
              <button
                type="button"
                onClick={() => setIsTeamModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700 transition"
              >
                + เพิ่มสมาชิก
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {teamMembers.map((m) => (
                <div key={m.id} className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-[#102d72] text-white font-bold flex items-center justify-center text-xs">
                      {m.name.slice(0, 2)}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">{m.name}</div>
                      <div className="text-[10px] text-blue-600 font-medium">{m.role}</div>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 space-y-0.5 pt-1 border-t border-slate-100">
                    <div>อีเมล: {m.email}</div>
                    <div>เบอร์ติดต่อ: {m.phone}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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

      {/* MODAL 1: เพิ่มรายการ BOQ */}
      {isBoqModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">+ เพิ่มรายการใน BOQ</h3>
              <button
                type="button"
                onClick={() => setIsBoqModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddBoq} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">หมวดงาน</label>
                <select
                  value={newBoq.category}
                  onChange={(e) => setNewBoq({ ...newBoq, category: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                >
                  <option value="1. งานเตรียมการและรื้อถอน">1. งานเตรียมการและรื้อถอน</option>
                  <option value="2. งานฐานรากและโครงสร้างใต้ดิน">2. งานฐานรากและโครงสร้างใต้ดิน</option>
                  <option value="3. งานโครงสร้างคอนกรีตเสริมเหล็ก">3. งานโครงสร้างคอนกรีตเสริมเหล็ก</option>
                  <option value="4. งานสถาปัตยกรรมและตกแต่ง">4. งานสถาปัตยกรรมและตกแต่ง</option>
                  <option value="5. งานระบบสุขาภิบาลและไฟฟ้า">5. งานระบบสุขาภิบาลและไฟฟ้า</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">ชื่อรายการ</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น เสาเข็มเจาะ ขนาด 0.60 ม."
                  value={newBoq.item}
                  onChange={(e) => setNewBoq({ ...newBoq, item: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">จำนวน</label>
                  <input
                    type="number"
                    min="1"
                    value={newBoq.qty}
                    onChange={(e) => setNewBoq({ ...newBoq, qty: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">หน่วย</label>
                  <input
                    type="text"
                    value={newBoq.unit}
                    onChange={(e) => setNewBoq({ ...newBoq, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">ค่าวัสดุ/หน่วย (฿)</label>
                  <input
                    type="number"
                    value={newBoq.matRate}
                    onChange={(e) => setNewBoq({ ...newBoq, matRate: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">ค่าแรง/หน่วย (฿)</label>
                  <input
                    type="number"
                    value={newBoq.labRate}
                    onChange={(e) => setNewBoq({ ...newBoq, labRate: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsBoqModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#2453d4] hover:bg-blue-700 text-white rounded-lg font-semibold"
                >
                  เพิ่มรายการ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* MODAL 3: บันทึกงานเพิ่ม/ลด (VO) */}
      {isVoModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">+ บันทึกงานเพิ่ม/ลด (VO)</h3>
              <button
                type="button"
                onClick={() => setIsVoModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddVo} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">รายละเอียดงานที่เปลี่ยนแปลง</label>
                <textarea
                  rows={3}
                  required
                  placeholder="เช่น เสริมเหล็กกันซึมพิเศษห้องเก็บสำนวนคดี"
                  value={newVo.title}
                  onChange={(e) => setNewVo({ ...newVo, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">มูลค่างานเพิ่ม/ลด (฿)</label>
                <input
                  type="number"
                  required
                  value={newVo.amount}
                  onChange={(e) => setNewVo({ ...newVo, amount: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsVoModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#2453d4] hover:bg-blue-700 text-white rounded-lg font-semibold"
                >
                  บันทึก VO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

      {/* MODAL 6: สร้างรายงานประจำวัน (Daily Construction Report) */}
      {isDailyReportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
            <div className="px-6 py-4 bg-[#102d72] text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">เขียนรายงานประจำวันช่างควบคุมงาน</h3>
                <p className="text-xs text-blue-200">
                  Daily Construction Progress &amp; Manpower Log
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDailyReportModalOpen(false)}
                className="p-1 rounded text-blue-200 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddDailyReport} className="p-6 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">หัวข้อรายงาน *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น รายงานประจำวันช่างควบคุมงาน (Daily Site Log #46)"
                  value={newDailyReport.title}
                  onChange={(e) =>
                    setNewDailyReport({ ...newDailyReport, title: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">วันที่รายงาน *</label>
                  <input
                    type="date"
                    required
                    value={newDailyReport.date}
                    onChange={(e) =>
                      setNewDailyReport({ ...newDailyReport, date: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">สภาพอากาศหน้างาน</label>
                  <select
                    value={newDailyReport.weather}
                    onChange={(e) =>
                      setNewDailyReport({ ...newDailyReport, weather: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  >
                    <option value="แดดจัด ท้องฟ้าแจ่มใส">แดดจัด ท้องฟ้าแจ่มใส (35°C)</option>
                    <option value="มีเมฆเป็นส่วนมาก">มีเมฆเป็นส่วนมาก (32°C)</option>
                    <option value="ฝนตกเล็กน้อย (ทำงานต่อได้)">ฝนตกเล็กน้อย (ทำงานต่อได้)</option>
                    <option value="ฝนตกหนัก (หยุดงานชั่วคราว)">ฝนตกหนัก (หยุดงานชั่วคราว)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">จำนวนแรงงานหน้างาน (คน)</label>
                  <input
                    type="number"
                    min="1"
                    value={newDailyReport.workerCount}
                    onChange={(e) =>
                      setNewDailyReport({
                        ...newDailyReport,
                        workerCount: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">เครื่องจักรที่เข้าปฏิบัติงาน</label>
                  <input
                    type="text"
                    value={newDailyReport.machinery}
                    onChange={(e) =>
                      setNewDailyReport({ ...newDailyReport, machinery: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">รายละเอียดงานที่ดำเนินการวันนี้ *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="ระบุความก้าวหน้า เช่น เทลีนคอนกรีตฐานราก F1-F4, ผูกเหล็กคานคอดิน B1..."
                  value={newDailyReport.workSummary}
                  onChange={(e) =>
                    setNewDailyReport({ ...newDailyReport, workSummary: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">ปัญหาและอุปสรรค / มาตรการความปลอดภัย</label>
                <input
                  type="text"
                  value={newDailyReport.issues}
                  onChange={(e) =>
                    setNewDailyReport({ ...newDailyReport, issues: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDailyReportModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#2453d4] text-white font-semibold hover:bg-blue-700 transition"
                >
                  บันทึกรายงานประจำวัน
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: อัปโหลดเอกสารโครงการ (Upload Document) */}
      {isUploadDocModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">+ อัปโหลดแฟ้มเอกสารโครงการ</h3>
                <p className="text-xs text-slate-500">แบบก่อสร้าง สัญญา และเอกสารประกอบงาน</p>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadDocModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddDocument} className="p-6 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">ชื่อแฟ้มเอกสาร / หัวข้อแบบ *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น แบบขยายบันไดหนีไฟและช่องเปิด Rev.03"
                  value={newDocForm.name}
                  onChange={(e) => setNewDocForm({ ...newDocForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">หมวดหมู่เอกสาร</label>
                <select
                  value={newDocForm.category}
                  onChange={(e) => setNewDocForm({ ...newDocForm, category: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                >
                  <option value="แบบสถาปัตยกรรม">แบบสถาปัตยกรรม (Architectural)</option>
                  <option value="แบบวิศวกรรมโครงสร้าง">แบบวิศวกรรมโครงสร้าง (Structural)</option>
                  <option value="แบบระบบไฟฟ้าและสุขาภิบาล">แบบระบบไฟฟ้าและสุขาภิบาล (M&amp;E)</option>
                  <option value="สัญญาและกฎหมาย">สัญญาจ้างและหลักประกันสัญญา</option>
                  <option value="หนังสือราชการ">หนังสือราชการ / ส่งมอบงาน</option>
                  <option value="ผลทดสอบวัสดุ">ผลทดสอบ Lab คอนกรีต/เหล็ก</option>
                </select>
              </div>

              <div className="p-4 rounded-xl border-2 border-dashed border-slate-200 text-center hover:border-blue-400 cursor-pointer transition">
                <Folder className="w-8 h-8 text-blue-500 mx-auto mb-1.5" />
                <span className="font-semibold text-slate-700 block">คลิกเลือกไฟล์ หรือลากไฟล์มาวางที่นี่</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">รองรับไฟล์ PDF, DWG, DOCX, ZIP (สูงสุด 50 MB)</span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsUploadDocModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#2453d4] text-white font-semibold hover:bg-blue-700 transition"
                >
                  บันทึกเอกสาร
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 8: เพิ่มนัดหมาย / ตรวจงานไซต์ (Add Calendar Event) */}
      {isCalendarEventModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">+ เพิ่มนัดหมายไซต์งาน</h3>
                <p className="text-xs text-slate-500">นัดหมายเทปูน ตรวจสอบงวดงาน และประชุม</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCalendarEventModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCalendarEvent} className="p-6 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">หัวข้อนัดหมาย *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น นัดเทคอนกรีตคานคอดิน, นัดกรรมการตรวจงาน..."
                  value={newEventForm.title}
                  onChange={(e) => setNewEventForm({ ...newEventForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">วันที่ (พ.ย. 2026)</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    required
                    value={newEventForm.day}
                    onChange={(e) =>
                      setNewEventForm({ ...newEventForm, day: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">แถบสีระบุประเภท</label>
                  <select
                    value={newEventForm.color}
                    onChange={(e) => setNewEventForm({ ...newEventForm, color: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  >
                    <option value="bg-blue-600">สีน้ำเงิน (งานเทปูน/ก่อสร้าง)</option>
                    <option value="bg-amber-500">สีส้ม (ตรวจรับ/ตรวจสอบ)</option>
                    <option value="bg-purple-600">สีม่วง (ส่งมอบงวดงาน)</option>
                    <option value="bg-emerald-600">สีเขียว (ประชุมไซต์งาน)</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCalendarEventModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#2453d4] text-white font-semibold hover:bg-blue-700 transition"
                >
                  เพิ่มลงปฏิทิน
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 9: เพิ่มสมาชิกทีมงาน (Add Team Member) */}
      {isTeamModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">+ เพิ่มสมาชิกทีมงานโครงการ</h3>
                <p className="text-xs text-slate-500">กำหนดหน้าที่ สิทธิ์ และข้อมูลการติดต่อ</p>
              </div>
              <button
                type="button"
                onClick={() => setIsTeamModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddTeamMember} className="p-6 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">ชื่อ-นามสกุล *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น นายธวัชชัย สถาปนิก"
                  value={newMemberForm.name}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">ตำแหน่งหน้าที่</label>
                <select
                  value={newMemberForm.role}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, role: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                >
                  <option value="Site Engineer (วิศวกรโยธาประจำไซต์)">Site Engineer (วิศวกรโยธาประจำไซต์)</option>
                  <option value="Site Architect (สถาปนิกประจำโครงการ)">Site Architect (สถาปนิกประจำโครงการ)</option>
                  <option value="Quantity Surveyor (วิศวกรประมาณราคา QS)">Quantity Surveyor (วิศวกรประมาณราคา QS)</option>
                  <option value="Safety Officer (จป.วิชาชีพ)">Safety Officer (จป.วิชาชีพ)</option>
                  <option value="Foreman (หัวหน้าผู้ควบคุมงาน)">Foreman (หัวหน้าผู้ควบคุมงาน)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">อีเมล</label>
                  <input
                    type="email"
                    placeholder="name@ktec.local"
                    value={newMemberForm.email}
                    onChange={(e) => setNewMemberForm({ ...newMemberForm, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">เบอร์โทรศัพท์</label>
                  <input
                    type="text"
                    placeholder="08X-XXX-XXXX"
                    value={newMemberForm.phone}
                    onChange={(e) => setNewMemberForm({ ...newMemberForm, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTeamModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#2453d4] text-white font-semibold hover:bg-blue-700 transition"
                >
                  เพิ่มสมาชิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
