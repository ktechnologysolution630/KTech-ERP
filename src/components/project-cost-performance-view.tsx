'use client';

import React, { useState } from 'react';
import {
  TrendingUp,
  Plus,
  Edit2,
  Trash2,
  Printer,
  Download,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  X,
  Building2,
  Calendar,
  MapPin,
  User,
  DollarSign,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
} from 'lucide-react';

export interface CostCategoryItem {
  id: string;
  name: string;
  bac: number; // Budget at Completion (แผนงบประมาณ)
  pv: number;  // Planned Value (งานตามแผน)
  ev: number;  // Earned Value (ทำได้จริง)
  ac: number;  // Actual Cost (ต้นทุนจริง)
}

interface ProjectCostPerformanceViewProps {
  projectId: string;
  projectCode?: string;
  projectName?: string;
  location?: string;
  budget?: string;
  startDate?: string;
  endDate?: string;
  projectManager?: string;
}

export function ProjectCostPerformanceView({
  projectId,
  projectCode = 'PJ-0001',
  projectName = 'อาคารสำนักงานตัวอย่าง',
  location = 'กรุงเทพมหานคร',
  budget = '48,954,000',
  startDate = '15/09/2569',
  endDate = '18/11/2570',
  projectManager = 'สมชาย ตัวอย่าง',
}: ProjectCostPerformanceViewProps) {
  // Initial items based on reference screenshot
  const [categories, setCategories] = useState<CostCategoryItem[]>([
    {
      id: 'cat-1',
      name: 'งานปรับปรุงอาคารตัวอย่าง',
      bac: 48954000,
      pv: 48954000,
      ev: 1070000,
      ac: 0,
    },
  ]);

  // Modal State for Adding / Editing Category
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    bac: 0,
    pv: 0,
    ev: 0,
    ac: 0,
  });

  // Calculate Totals and EVM Indicators
  const totalBac = categories.reduce((sum, item) => sum + item.bac, 0);
  const totalPv = categories.reduce((sum, item) => sum + item.pv, 0);
  const totalEv = categories.reduce((sum, item) => sum + item.ev, 0);
  const totalAc = categories.reduce((sum, item) => sum + item.ac, 0);

  // Variances
  const totalCv = totalEv - totalAc; // Cost Variance
  const totalSv = totalEv - totalPv; // Schedule Variance

  // Indices
  const cpi = totalAc > 0 ? totalEv / totalAc : 0.0; // Cost Performance Index
  const spi = totalPv > 0 ? totalEv / totalPv : 0.0; // Schedule Performance Index

  // Estimate at Completion (EAC)
  const eac = cpi > 0 ? totalBac / cpi : 0;

  // Percentage calculations
  const evPercentOfBac = totalBac > 0 ? ((totalEv / totalBac) * 100).toFixed(1) : '0.0';
  const acPercentOfBac = totalBac > 0 ? ((totalAc / totalBac) * 100).toFixed(1) : '0.0';
  const pvPercentOfBac = totalBac > 0 ? ((totalPv / totalBac) * 100).toFixed(1) : '0.0';

  const formatNumber = (num: number) => {
    return num.toLocaleString('th-TH');
  };

  const handleOpenAddModal = () => {
    setEditingId(null);
    setCategoryForm({
      name: '',
      bac: 0,
      pv: 0,
      ev: 0,
      ac: 0,
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: CostCategoryItem) => {
    setEditingId(item.id);
    setCategoryForm({
      name: item.name,
      bac: item.bac,
      pv: item.pv,
      ev: item.ev,
      ac: item.ac,
    });
    setIsModalOpen(true);
  };

  const handleSaveCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) return;

    if (editingId) {
      setCategories((prev) =>
        prev.map((item) =>
          item.id === editingId
            ? {
                ...item,
                name: categoryForm.name.trim(),
                bac: Number(categoryForm.bac) || 0,
                pv: Number(categoryForm.pv) || 0,
                ev: Number(categoryForm.ev) || 0,
                ac: Number(categoryForm.ac) || 0,
              }
            : item,
        ),
      );
    } else {
      const newItem: CostCategoryItem = {
        id: `cat-${Date.now()}`,
        name: categoryForm.name.trim(),
        bac: Number(categoryForm.bac) || 0,
        pv: Number(categoryForm.pv) || 0,
        ev: Number(categoryForm.ev) || 0,
        ac: Number(categoryForm.ac) || 0,
      };
      setCategories((prev) => [...prev, newItem]);
    }
    setIsModalOpen(false);
  };

  const handleDeleteCategory = (id: string) => {
    if (confirm('คุณต้องการลบหมวดงานนี้ใช่หรือไม่?')) {
      setCategories((prev) => prev.filter((item) => item.id !== id));
    }
  };

  // Timeline intervals for S-Curve chart
  const timelineDates = [
    '15/09/2569',
    '15/11/2569',
    '15/01/2570',
    '15/03/2570',
    '15/05/2570',
    '15/07/2570',
    '15/09/2570',
    '18/11/2570',
  ];

  return (
    <div className="space-y-4">
      {/* Action Header Button Bar (Matching reference: Blue button on top right) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>พิมพ์รายงาน</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleOpenAddModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] text-white text-xs font-semibold hover:bg-blue-700 active:scale-98 transition shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>+ เพิ่มหมวดต้นทุน</span>
        </button>
      </div>

      {/* Main Document Card Container (Matching reference Report Exactly) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 max-w-6xl mx-auto space-y-6">
        {/* Document Header */}
        <div className="text-center pt-2">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            แบบรายงานประสิทธิภาพต้นทุนโครงการ
          </h2>
          <div className="w-16 h-1 bg-[#2453d4] rounded-full mx-auto mt-2" />
        </div>

        {/* Project Info Header Box */}
        <div className="bg-slate-50/70 border border-slate-200/90 rounded-xl p-4 sm:p-5 text-xs text-slate-700">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-8">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium w-24">โครงการ:</span>
                <span className="font-semibold text-slate-900">{projectName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium w-24">ผู้จัดการงาน:</span>
                <span className="font-medium text-slate-800">{projectManager}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium w-24">ระยะเวลา:</span>
                <span className="font-mono text-slate-800">
                  {startDate} - {endDate}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium w-24">สถานที่ก่อสร้าง:</span>
                <span className="font-medium text-slate-800">{location}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium w-24">ณ วันที่:</span>
                <span className="font-mono text-slate-800">03/11/2569</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium w-24">งบประมาณ:</span>
                <span className="font-mono font-bold text-slate-900">{budget} บาท</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 1: สรุปค่าดัชนีมูลค่างานที่ทำได้ (EVM Summary) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="inline-block px-2.5 py-1 rounded bg-blue-50 text-[#2453d4] border border-blue-200 text-xs font-bold">
                สรุปค่าดัชนีมูลค่างานที่ทำได้
              </span>
            </div>
            <span className="text-[11px] text-slate-400">หน่วย: บาท (THB)</span>
          </div>

          {/* Top 4 KPI Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 border border-slate-200 rounded-xl overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-200 bg-white">
            {/* Card 1: BAC */}
            <div className="p-4 sm:p-5 space-y-2 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500">งบประมาณตามแผน (BAC)</div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900 mt-1">
                  {formatNumber(totalBac)}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>ค่าจริง {pvPercentOfBac}%</span>
                <span>ใช้จ่าย {acPercentOfBac}%</span>
              </div>
              <div className="text-[10px] text-slate-400">งบประมาณเดิมจากสัญญา</div>
            </div>

            {/* Card 2: AC */}
            <div className="p-4 sm:p-5 space-y-2 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500">ต้นทุนจริง (AC)</div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900 mt-1">
                  {formatNumber(totalAc)}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                {acPercentOfBac}% ของงบประมาณ
              </div>
              <div className="text-[10px] text-slate-400">ยอดใช้จ่ายจริงที่บันทึกแล้ว</div>
            </div>

            {/* Card 3: EV */}
            <div className="p-4 sm:p-5 space-y-2 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500">มูลค่างานที่ทำได้จริง (EV)</div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900 mt-1">
                  {formatNumber(totalEv)}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                {evPercentOfBac}% ของงบประมาณ
              </div>
              <div className="text-[10px] text-slate-400">มูลค่างานที่ตรวจรับแล้ว</div>
            </div>

            {/* Card 4: CPI Semi-circle Gauge */}
            <div className="p-4 sm:p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  ดัชนีประสิทธิภาพด้านต้นทุน (CPI)
                </span>
              </div>
              <div className="text-right text-[10px] text-slate-400">
                ดัชนีประสิทธิภาพด้านกำหนดเวลา (SPI):{' '}
                <span className="font-mono font-bold text-slate-700">{spi.toFixed(2)}</span>
              </div>

              {/* Semi-circular Speedometer Gauge */}
              <div className="py-2 flex flex-col items-center justify-center relative">
                <svg className="w-36 h-20 overflow-visible" viewBox="0 0 100 55">
                  {/* Gauge Background Zones (Red, Yellow, Green, Blue) */}
                  <path
                    d="M 10 50 A 40 40 0 0 1 30 18"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 30 18 A 40 40 0 0 1 50 10"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="8"
                  />
                  <path
                    d="M 50 10 A 40 40 0 0 1 70 18"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="8"
                  />
                  <path
                    d="M 70 18 A 40 40 0 0 1 90 50"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  {/* Indicator Needle */}
                  <circle cx="50" cy="50" r="4" fill="#0f172a" />
                  <line
                    x1="50"
                    y1="50"
                    x2={50 - 32 * Math.cos((cpi > 2 ? 2 : cpi) * (Math.PI / 2))}
                    y2={50 - 32 * Math.sin((cpi > 2 ? 2 : cpi) * (Math.PI / 2))}
                    stroke="#0f172a"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="text-center mt-1">
                  <div className="font-mono font-bold text-lg text-slate-900">{cpi.toFixed(2)}</div>
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                      cpi >= 1.0
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {cpi >= 1.0 ? 'ตามเป้าหมาย' : 'ต่ำกว่าเป้าหมาย'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom 3 EVM Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 border border-slate-200 rounded-xl overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-200 bg-white">
            {/* Metric 1: CV */}
            <div className="p-4 space-y-1">
              <div className="text-xs font-semibold text-slate-500">ผลต่างต้นทุน (CV)</div>
              <div
                className={`text-xl font-bold font-mono ${
                  totalCv >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {totalCv >= 0 ? `+${formatNumber(totalCv)}` : formatNumber(totalCv)}
              </div>
              <div className="text-[11px] text-slate-500">มูลค่า EV - AC</div>
              <div className="text-[10px] text-slate-400">คำนวณจากข้อมูลจริงที่ได้รับ</div>
            </div>

            {/* Metric 2: SV */}
            <div className="p-4 space-y-1">
              <div className="text-xs font-semibold text-slate-500">ผลต่างตามแผนงาน (SV)</div>
              <div
                className={`text-xl font-bold font-mono ${
                  totalSv >= 0 ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                {totalSv >= 0 ? `+${formatNumber(totalSv)}` : formatNumber(totalSv)}
              </div>
              <div className="text-[11px] text-slate-500">มูลค่า EV - PV</div>
              <div className="text-[10px] text-slate-400">คำนวณจากข้อมูลจริงที่ได้รับ</div>
            </div>

            {/* Metric 3: EAC */}
            <div className="p-4 space-y-1">
              <div className="text-xs font-semibold text-slate-500">
                ประมาณการต้นทุนเมื่อแล้วเสร็จ (EAC)
              </div>
              <div className="text-xl font-bold font-mono text-slate-900">{formatNumber(eac)}</div>
              <div className="text-[11px] text-slate-500">งบประมาณ = EV / CPI</div>
              <div className="text-[10px] text-slate-400">
                ข้อมูลที่ต้องการเพิ่มเติม {formatNumber(totalBac)}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Two Comparison Charts (Matching reference Screenshot) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left Chart: S-Curve Progress vs Plan vs Actual */}
          <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                  เส้นทางการคืบหน้า : เปรียบเทียบแผนงาน/งานที่ทำได้/การจ่ายจริง
                </h4>
                <p className="text-[11px] text-slate-400">
                  ความคืบหน้ารวมสะสมจากสัญญาและข้อเท็จจริงที่อนุมัติแล้วเสร็จ
                </p>
              </div>
            </div>

            {/* Legend pills */}
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 text-blue-600 font-medium">
                <span className="w-3 h-0.5 bg-blue-600 rounded-full" />
                <span>ตามแผน (PV)</span>
              </span>
              <span className="flex items-center gap-1.5 text-sky-500 font-medium">
                <span className="w-3 h-0.5 bg-sky-400 rounded-full" />
                <span>สัญญา</span>
              </span>
              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <span className="w-3 h-0.5 bg-emerald-600 rounded-full" />
                <span>งานที่ทำได้ (EV)</span>
              </span>
              <span className="flex items-center gap-1.5 text-amber-500 font-medium">
                <span className="w-3 h-0.5 bg-amber-500 rounded-full" />
                <span>จ่ายจริง (AC)</span>
              </span>
            </div>

            {/* SVG S-Curve Chart */}
            <div className="h-52 w-full pt-2">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 500 180">
                {/* Horizontal Grid lines */}
                {[0, 25, 50, 75, 100].map((val, idx) => {
                  const y = 160 - (val / 100) * 140;
                  return (
                    <g key={val}>
                      <line
                        x1="40"
                        y1={y}
                        x2="480"
                        y2={y}
                        stroke="#f1f5f9"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <text
                        x="32"
                        y={y + 3}
                        fontSize="9"
                        textAnchor="end"
                        fill="#94a3b8"
                        className="font-mono"
                      >
                        {val}%
                      </text>
                    </g>
                  );
                })}

                {/* S-Curve Path: Planned Value (Blue) */}
                <path
                  d="M 50 160 Q 150 155, 220 120 T 380 40 T 470 20"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* S-Curve Path: Contract Baseline (Sky) */}
                <path
                  d="M 50 160 Q 160 158, 230 125 T 390 45 T 470 22"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                />

                {/* Earned Value Curve (Green) */}
                <path
                  d="M 50 160 Q 90 159, 130 157"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <circle cx="130" cy="157" r="4" fill="#10b981" />

                {/* Actual Cost Curve (Amber) */}
                <path
                  d="M 50 160 L 130 160"
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <circle cx="130" cy="160" r="3.5" fill="#f59e0b" />

                {/* X-Axis dates */}
                {timelineDates.map((date, idx) => {
                  const x = 50 + (idx / (timelineDates.length - 1)) * 420;
                  return (
                    <text
                      key={date}
                      x={x}
                      y="175"
                      fontSize="8"
                      textAnchor="middle"
                      fill="#94a3b8"
                      className="font-mono"
                    >
                      {date.slice(0, 5)}
                    </text>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Right Chart: Performance Index Trend (CPI / SPI) */}
          <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3 flex flex-col justify-between">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                    แนวโน้มดัชนีประสิทธิภาพตามเวลา
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    ตัวเลขแสดงสถานะการใช้เงินเปรียบเทียบกับผลงานตามช่วงเวลา
                  </p>
                </div>
              </div>

              {/* Legend pills */}
              <div className="flex items-center gap-3 text-[11px] mt-2">
                <span className="flex items-center gap-1.5 text-blue-600 font-medium">
                  <span className="w-3 h-0.5 bg-blue-600 rounded-full" />
                  <span>ต้นทุน (CPI)</span>
                </span>
                <span className="flex items-center gap-1.5 text-amber-500 font-medium">
                  <span className="w-3 h-0.5 bg-amber-500 rounded-full" />
                  <span>แผนงาน (SPI)</span>
                </span>
              </div>

              {/* Chart */}
              <div className="h-44 w-full pt-2">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 500 150">
                  {/* Grid Lines for Index: 0.0, 0.5, 1.0, 1.5, 2.0 */}
                  {[0.0, 0.5, 1.0, 1.5, 2.0].map((val) => {
                    const y = 130 - (val / 2.0) * 110;
                    return (
                      <g key={val}>
                        <line
                          x1="35"
                          y1={y}
                          x2="480"
                          y2={y}
                          stroke={val === 1.0 ? '#cbd5e1' : '#f1f5f9'}
                          strokeWidth={val === 1.0 ? '1.5' : '1'}
                          strokeDasharray={val === 1.0 ? 'none' : '3 3'}
                        />
                        <text
                          x="28"
                          y={y + 3}
                          fontSize="9"
                          textAnchor="end"
                          fill="#94a3b8"
                          className="font-mono"
                        >
                          {val.toFixed(1)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Benchmark 1.0 Label */}
                  <text x="475" y={130 - (1.0 / 2.0) * 110 - 4} fontSize="8" textAnchor="end" fill="#64748b">
                    เป้าหมาย (1.0)
                  </text>

                  {/* CPI Line */}
                  <path
                    d="M 50 130 L 120 130"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <circle cx="120" cy="130" r="3.5" fill="#2563eb" />

                  {/* SPI Line */}
                  <path
                    d="M 50 130 Q 80 129, 120 128"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <circle cx="120" cy="128" r="3.5" fill="#f59e0b" />
                </svg>
              </div>
            </div>

            {/* Bottom Current Index summary */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs px-2">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">ดัชนีต้นทุนปัจจุบัน:</span>
                <span className="font-mono font-bold text-blue-600">{cpi.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">ดัชนีแผนงานปัจจุบัน:</span>
                <span className="font-mono font-bold text-amber-600">{spi.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Cost Breakdown Table (Matching Bottom of Screenshot) */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">ประสิทธิภาพต้นทุนตามหมวดงาน</h3>
            <span className="text-xs text-slate-500">รวม {categories.length} รายการ</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 text-slate-600 border-b border-slate-200 font-semibold">
                  <th className="py-3 px-4 min-w-[200px]">หมวดงาน</th>
                  <th className="py-3 px-3 text-right">แผนงบประมาณ (BAC)</th>
                  <th className="py-3 px-3 text-right">งานตามแผน (PV)</th>
                  <th className="py-3 px-3 text-right">ทำได้จริง (EV)</th>
                  <th className="py-3 px-3 text-right">ต้นทุนจริง (AC)</th>
                  <th className="py-3 px-3 text-right">ผลต่างต้นทุน (CV)</th>
                  <th className="py-3 px-3 text-center">ดัชนีต้นทุน (CPI)</th>
                  <th className="py-3 px-3 text-center">ดัชนีแผนงาน (SPI)</th>
                  <th className="py-3 px-3 text-center w-20">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {categories.map((cat) => {
                  const itemCv = cat.ev - cat.ac;
                  const itemCpi = cat.ac > 0 ? (cat.ev / cat.ac).toFixed(2) : '0.00';
                  const itemSpi = cat.pv > 0 ? (cat.ev / cat.pv).toFixed(2) : '0.00';

                  return (
                    <tr key={cat.id} className="hover:bg-blue-50/30 transition">
                      <td className="py-3 px-4 font-sans font-medium text-slate-900">
                        {cat.name}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-700">
                        {formatNumber(cat.bac)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-700">
                        {formatNumber(cat.pv)}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-slate-900">
                        {formatNumber(cat.ev)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-700">
                        {formatNumber(cat.ac)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-semibold ${
                          itemCv >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {itemCv >= 0 ? `+${formatNumber(itemCv)}` : formatNumber(itemCv)}
                      </td>
                      <td className="py-3 px-3 text-center text-slate-800">{itemCpi}</td>
                      <td className="py-3 px-3 text-center text-slate-800">{itemSpi}</td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1 font-sans">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(cat)}
                            className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition"
                            title="แก้ไขหมวดงาน"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {categories.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat.id)}
                              className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition"
                              title="ลบหมวดงาน"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold text-slate-900 border-t-2 border-slate-200 font-mono">
                  <td className="py-3 px-4 font-sans">รวมงบประมาณทั้งสิ้น</td>
                  <td className="py-3 px-3 text-right">{formatNumber(totalBac)}</td>
                  <td className="py-3 px-3 text-right">{formatNumber(totalPv)}</td>
                  <td className="py-3 px-3 text-right">{formatNumber(totalEv)}</td>
                  <td className="py-3 px-3 text-right">{formatNumber(totalAc)}</td>
                  <td
                    className={`py-3 px-3 text-right ${
                      totalCv >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {totalCv >= 0 ? `+${formatNumber(totalCv)}` : formatNumber(totalCv)}
                  </td>
                  <td className="py-3 px-3 text-center">{cpi.toFixed(2)}</td>
                  <td className="py-3 px-3 text-center">{spi.toFixed(2)}</td>
                  <td className="py-3 px-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Modal: Add/Edit Cost Category */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  {editingId ? 'แก้ไขหมวดต้นทุน' : 'เพิ่มหมวดต้นทุนโครงการ'}
                </h3>
                <p className="text-xs text-slate-500">
                  กำหนดค่างานตามแผน (PV), ผลงานที่ทำได้ (EV), และต้นทุนจริง (AC)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="p-6 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">ชื่อหมวดงาน / รายการ *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น งานโครงสร้างใต้ดิน, งานสถาปัตยกรรม, งานระบบไฟฟ้า"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">แผนงบประมาณ (BAC) บาท</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={categoryForm.bac}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, bac: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">งานตามแผนสะสม (PV) บาท</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={categoryForm.pv}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, pv: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">ผลงานทำได้จริง (EV) บาท</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={categoryForm.ev}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, ev: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">ต้นทุนจ่ายจริง (AC) บาท</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={categoryForm.ac}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, ac: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#2453d4] text-white font-semibold hover:bg-blue-700 transition"
                >
                  {editingId ? 'บันทึกการแก้ไข' : 'เพิ่มหมวดต้นทุน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
