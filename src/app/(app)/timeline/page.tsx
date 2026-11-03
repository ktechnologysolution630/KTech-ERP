'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Filter,
  CheckCircle,
  Clock,
  ArrowRight,
  ChevronRight,
  TrendingUp,
  Building2,
  Folder,
} from 'lucide-react';

interface TimelineProject {
  id: string;
  code: string;
  name: string;
  location: string;
  pm: string;
  startDate: string;
  endDate: string;
  progress: number;
  plannedProgress: number;
  status: 'ACTIVE' | 'COMPLETED' | 'PLANNED';
  startMonthIdx: number; // 0 to 11
  durationMonths: number;
}

export default function TimelinePage() {
  const [status, setStatus] = useState('วางแผน/ดำเนินการ');
  const [pm, setPm] = useState('ทุก Project Manager');
  const [year, setYear] = useState('2569');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortBy, setSortBy] = useState('กำลังดำเนินการ');
  const [activeOnly, setActiveOnly] = useState(false);
  const [period, setPeriod] = useState<'today' | 'month' | 'quarter' | 'year'>('month');

  // Active projects in system
  const [projectsList, setProjectsList] = useState<TimelineProject[]>([
    {
      id: '00000000-0000-4000-8000-000000000001',
      code: 'PJ-0001',
      name: 'อาคารสำนักงานตัวอย่าง',
      location: 'กรุงเทพมหานคร',
      pm: 'สมชาย ตัวอย่าง',
      startDate: '15/09/2569',
      endDate: '18/11/2570',
      progress: 2.2,
      plannedProgress: 12.0,
      status: 'ACTIVE',
      startMonthIdx: 8, // September
      durationMonths: 14,
    },
    {
      id: '45e27b10-98b7-41b4-b39e-204b71410af3',
      code: 'K69-001',
      name: 'โครงการก่อสร้างอาคารสำนักงานใหญ่ K-Tec (พระราม 9)',
      location: 'กรุงเทพมหานคร',
      pm: 'สมชาย ตัวอย่าง',
      startDate: '15/09/2569',
      endDate: '15/11/2570',
      progress: 5.0,
      plannedProgress: 15.0,
      status: 'ACTIVE',
      startMonthIdx: 8,
      durationMonths: 14,
    },
  ]);

  const months = [
    'ม.ค.',
    'ก.พ.',
    'มี.ค.',
    'เม.ย.',
    'พ.ค.',
    'มิ.ย.',
    'ก.ค.',
    'ส.ค.',
    'ก.ย.',
    'ต.ค.',
    'พ.ย.',
    'ธ.ค.',
  ];

  return (
    <div className="space-y-5">
      {/* Page Title & Subtitle */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Timeline โครงการ</h1>
        <p className="text-xs text-slate-500 mt-0.5">แผนงานของโครงการวางแผนและกำลังดำเนินการ</p>
      </div>

      {/* Horizontal Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* สถานะ */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-medium mb-0.5">สถานะ</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white text-slate-700 text-xs focus:outline-hidden focus:border-[#2453d4]"
            >
              <option value="วางแผน/ดำเนินการ">วางแผน/ดำเนินการ</option>
              <option value="เสร็จสิ้น">เสร็จสิ้น</option>
              <option value="ทั้งหมด">ทั้งหมด</option>
            </select>
          </div>

          {/* Project Manager */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-medium mb-0.5">Project Manager</span>
            <select
              value={pm}
              onChange={(e) => setPm(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white text-slate-700 text-xs focus:outline-hidden focus:border-[#2453d4]"
            >
              <option value="ทุก Project Manager">ทุก Project Manager</option>
              <option value="สมชาย ตัวอย่าง">สมชาย ตัวอย่าง</option>
            </select>
          </div>

          {/* ปี */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-medium mb-0.5">ปี</span>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white text-slate-700 text-xs focus:outline-hidden focus:border-[#2453d4]"
            >
              <option value="2569">2569</option>
              <option value="2570">2570</option>
              <option value="ทุกปี">ทุกปี</option>
            </select>
          </div>

          {/* จากวันที่ */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-medium mb-0.5">จากวันที่</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white text-slate-700 text-xs focus:outline-hidden focus:border-[#2453d4]"
            />
          </div>

          {/* ถึงวันที่ */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-medium mb-0.5">ถึงวันที่</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white text-slate-700 text-xs focus:outline-hidden focus:border-[#2453d4]"
            />
          </div>

          {/* Checkbox กำลังดำเนินการเท่านั้น */}
          <label className="flex items-center gap-1.5 pt-4 cursor-pointer text-slate-700">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="rounded border-slate-300 text-[#2453d4] focus:ring-[#2453d4]"
            />
            <span>กำลังดำเนินการเท่านั้น</span>
          </label>
        </div>

        {/* Period Switcher Pills */}
        <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-50 self-end">
          <button
            type="button"
            onClick={() => setPeriod('today')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              period === 'today' ? 'bg-white text-[#2453d4] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            วันนี้
          </button>
          <button
            type="button"
            onClick={() => setPeriod('month')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              period === 'month'
                ? 'bg-white text-[#2453d4] shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            เดือน
          </button>
          <button
            type="button"
            onClick={() => setPeriod('quarter')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              period === 'quarter' ? 'bg-white text-[#2453d4] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ไตรมาส
          </button>
          <button
            type="button"
            onClick={() => setPeriod('year')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              period === 'year' ? 'bg-white text-[#2453d4] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ปี
          </button>
        </div>
      </div>

      {/* Main Card: แผนงานตามช่วงเวลา */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <h2 className="font-bold text-slate-800 text-sm">แผนงานตามช่วงเวลา (ปี 2569)</h2>

          {/* Legends */}
          <div className="flex flex-wrap items-center gap-4 text-slate-600">
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              <span>โครงการเสร็จสิ้นแล้ว</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
              <span>Planned (แผนงาน)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Actual (ทำได้จริง)</span>
            </span>
            <span className="font-semibold text-slate-700 pl-2 border-l border-slate-200">
              {projectsList.length} โครงการ
            </span>
          </div>
        </div>

        {/* Gantt Timeline View */}
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            {/* Months Header Grid */}
            <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 text-[11px] font-mono font-medium text-slate-600">
              {months.map((m, i) => (
                <div
                  key={m}
                  className={`py-2 text-center border-r border-slate-200/80 last:border-r-0 ${
                    i === 10 ? 'bg-blue-100/50 text-blue-700 font-bold' : ''
                  }`}
                >
                  {m}
                </div>
              ))}
            </div>

            {/* Project Rows */}
            <div className="divide-y divide-slate-100">
              {projectsList.map((p) => (
                <div key={p.id} className="p-4 hover:bg-slate-50/60 transition group">
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        {p.code}
                      </span>
                      <Link
                        href={`/projects/${p.id}`}
                        prefetch={false}
                        className="font-bold text-sm text-slate-900 group-hover:text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <span>{p.name}</span>
                        <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-slate-400">PM: {p.pm}</span>
                      <span className="font-mono text-slate-600">
                        {p.startDate} - {p.endDate}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ทำได้ {p.progress}% / แผน {p.plannedProgress}%
                      </span>
                    </div>
                  </div>

                  {/* Gantt Bar Lane */}
                  <div className="grid grid-cols-12 h-6 bg-slate-100/70 rounded-md relative overflow-hidden">
                    {/* Month Vertical Dividers */}
                    {Array.from({ length: 12 }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-full border-r border-slate-200/50 ${
                          idx === 10 ? 'bg-blue-50/40' : ''
                        }`}
                      />
                    ))}

                    {/* Active Bar starting in Sept (col 9) spanning right */}
                    <div
                      className="absolute top-1 bottom-1 rounded bg-[#2453d4] text-white text-[10px] font-semibold flex items-center px-2 shadow-xs transition-all"
                      style={{
                        left: `${(p.startMonthIdx / 12) * 100}%`,
                        width: '33.33%', // Spanning across rest of year
                      }}
                    >
                      <span className="truncate">{p.name}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
