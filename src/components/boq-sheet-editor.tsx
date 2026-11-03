'use client';

import React, { useRef, useState, useTransition } from 'react';
import { downloadWorkbook, readSpreadsheetRows } from '@/lib/spreadsheet';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Bold,
  FileSpreadsheet,
  Upload,
  Download,
  Printer,
  Trash2,
  Save,
  Calendar,
  CheckCircle2,
  AlertCircle,
  X,
  FileText,
} from 'lucide-react';
import { computeBoqLine } from '@/domain/boq';
import { bangkokDateString } from '@/domain/thai';
import type { BoqDocumentDto } from '@/server/services/boq';
import { saveBoqAction } from '@/app/(app)/projects/[id]/boq/actions';
import { saveVoBoqAction } from '@/app/(app)/projects/[id]/vo-actions';
import type { SaveBoqInput } from '@/server/services/boq';
import {
  BoqLineGrid,
  makeCategoryRow,
  makeItemRow,
  makeSubItemRow,
  rowsFromDto,
  rowsToLines,
  toRowInput,
  type BoqRow,
} from '@/components/boq-line-grid';

export type { BoqRow };

const BOQ_IMPORT_COLUMNS = ['ลำดับ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วยวัสดุ', 'ราคาต่อหน่วยค่าแรง', 'หมายเหตุ'] as const;

interface BoqSheetEditorProps {
  projectId: string;
  projectCode: string;
  projectName: string;
  location?: string;
  /** Saved main BOQ, or null when the project has none yet. */
  initialBoq: BoqDocumentDto | null;
  canEdit: boolean;
  onBack?: () => void;
  /** Set when editing a variation order's BOQ instead of the main BOQ */
  vo?: { id: string; number: string };
}

function formatSavedTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BoqSheetEditor({
  projectId,
  projectCode,
  projectName,
  location = '',
  initialBoq,
  canEdit,
  onBack,
  vo,
}: BoqSheetEditorProps) {
  // Save status state
  const [isPending, startTransition] = useTransition();
  const [isSaved, setIsSaved] = useState(initialBoq !== null);
  const [saveTime, setSaveTime] = useState<string | null>(
    initialBoq ? formatSavedTime(initialBoq.updatedAt) : null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(
    initialBoq?.updatedAt ?? null,
  );
  const [activeSheetTab, setActiveSheetTab] = useState<'boq' | 'home'>('boq');

  // Metadata form
  const [meta, setMeta] = useState({
    docNo: initialBoq?.number ?? `${projectCode}-BOQ (ออกเลขเมื่อบันทึก)`,
    revision: initialBoq?.revision ?? 0,
    docDate: initialBoq?.estimateDate ?? bangkokDateString(),
    projectName: initialBoq?.projectTitle || projectName,
    location: initialBoq?.location || location,
    owner: initialBoq?.owner ?? '',
    workDetail: initialBoq?.workDetail ?? '',
    estimator: initialBoq?.estimator ?? '',
  });

  // Financial percentages
  const [overheadPercent, setOverheadPercent] = useState<number>(initialBoq?.overheadPercent ?? 0);
  const [discountAmount, setDiscountAmount] = useState<number>(initialBoq?.discountAmount ?? 0);
  const [vatPercent, setVatPercent] = useState<number>(initialBoq?.vatPercent ?? 7);
  const [remarks, setRemarks] = useState<string>(initialBoq?.remarks ?? '');

  // Rows of BOQ
  const [rows, setRows] = useState<BoqRow[]>(() => rowsFromDto(initialBoq));

  // Selected Row for formatting (Bold toggle)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const editable = canEdit && !isPending;

  const markDirty = () => {
    setIsSaved(false);
    setSaveError(null);
  };

  const handleAddCategory = () => {
    setRows((prev) => [...prev, makeCategoryRow(prev)]);
    markDirty();
  };

  const handleAddItem = () => {
    setRows((prev) => [...prev, makeItemRow()]);
    markDirty();
  };

  const handleAddSubItem = () => {
    setRows((prev) => [...prev, makeSubItemRow()]);
    markDirty();
  };

  // Toggle Bold
  const handleToggleBold = () => {
    if (!selectedRowId) {
      alert('กรุณาคลิกเลือกแถวในตารางที่ต้องการจัดรูปแบบตัวหนาก่อนครับ');
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.id === selectedRowId ? { ...r, isBold: !r.isBold } : r)),
    );
    markDirty();
  };

  // Reset / Clear All (takes effect in the database only after saving)
  const handleResetAll = () => {
    if (confirm('คุณต้องการลบรายการในตาราง BOQ ทั้งหมดหรือไม่? (มีผลเมื่อกดบันทึก)')) {
      setRows([]);
      markDirty();
    }
  };

  // Save BOQ
  const handleSave = () => {
    setSaveError(null);
    startTransition(async () => {
      const save = (input: SaveBoqInput) =>
        vo ? saveVoBoqAction(projectId, vo.id, input) : saveBoqAction(projectId, input);
      const result = await save({
        baseUpdatedAt,
        revision: meta.revision,
        estimateDate: meta.docDate || null,
        projectTitle: meta.projectName,
        location: meta.location,
        owner: meta.owner,
        workDetail: meta.workDetail,
        estimator: meta.estimator,
        overheadPercent,
        discountAmount,
        vatPercent,
        remarks,
        lines: rowsToLines(rows),
      });
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setRows(rowsFromDto(result.boq));
      setBaseUpdatedAt(result.boq.updatedAt);
      setMeta((m) => ({ ...m, docNo: result.boq.number }));
      setSaveTime(formatSavedTime(result.boq.updatedAt));
      setIsSaved(true);
    });
  };

  // Export to CSV
  const handleExport = () => {
    const headers = [
      'ลำดับ',
      'รายการ',
      'จำนวน',
      'หน่วย',
      'ราคาต่อหน่วยวัสดุ',
      'จำนวนเงินวัสดุ',
      'ราคาต่อหน่วยค่าแรง',
      'จำนวนเงินค่าแรง',
      'รวมเป็นเงิน',
      'หมายเหตุ',
    ];
    const csvRows = [headers.join(',')];

    rows.forEach((r) => {
      const amounts = computeBoqLine(toRowInput(r));
      csvRows.push(
        [
          `"${r.no}"`,
          `"${r.description.replace(/"/g, '""')}"`,
          r.qty,
          `"${r.unit}"`,
          r.matRate === '' ? 0 : r.matRate,
          amounts.material.toFixed(2),
          r.labRate === '' ? 0 : r.labRate,
          amounts.labor.toFixed(2),
          amounts.total.toFixed(2),
          `"${r.note.replace(/"/g, '""')}"`,
        ].join(','),
      );
    });

    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${meta.docNo}_BOQ.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Template (same column names the import reads and the export writes)
  const handleTemplate = () => {
    void downloadWorkbook('BOQ_Template.xlsx', [...BOQ_IMPORT_COLUMNS], [
      ['1', 'หมวดงานที่ 1 งานโครงสร้าง', '', '', '', '', ''],
      ['1.1', 'คอนกรีตผสมเสร็จ 240 ksc', 10, 'ลบ.ม.', 2200, 350, ''],
      ['1.2', 'เหล็กเสริม DB12', 500, 'กก.', 28, 6, 'รวมค่าดัด'],
    ]);
  };

  // Import .xlsx/.csv: a row with no quantity and no prices is a category heading
  const importInputRef = useRef<HTMLInputElement>(null);
  const handleImportFile = async (file: File) => {
    setSaveError(null);
    try {
      const sheet = await readSpreadsheetRows(file);
      const num = (v: string | undefined) => {
        const n = Number(String(v ?? '').replace(/,/g, ''));
        return v === undefined || v.trim() === '' || !Number.isFinite(n) ? '' : n;
      };
      const imported: BoqRow[] = sheet
        .filter((r) => (r['รายการ'] ?? '').trim() !== '')
        .map((r) => {
          const qty = num(r['จำนวน']);
          const matRate = num(r['ราคาต่อหน่วยวัสดุ']);
          const labRate = num(r['ราคาต่อหน่วยค่าแรง']);
          const isCategory = qty === '' && matRate === '' && labRate === '';
          return {
            ...(isCategory ? makeCategoryRow([]) : makeItemRow()),
            no: (r['ลำดับ'] ?? '').trim(),
            description: r['รายการ'].trim(),
            ...(isCategory ? {} : { qty, unit: (r['หน่วย'] ?? '').trim(), matRate, labRate }),
            note: (r['หมายเหตุ'] ?? '').trim(),
          };
        });
      if (imported.length === 0) {
        setSaveError(`ไม่พบรายการในไฟล์ — ต้องมีคอลัมน์ ${BOQ_IMPORT_COLUMNS.join(', ')}`);
        return;
      }
      setRows((prev) => [...prev, ...imported]);
      markDirty();
    } catch {
      setSaveError('อ่านไฟล์ไม่ได้ กรุณาใช้ไฟล์ .xlsx หรือ .csv ตามเทมเพลต');
    }
  };

  return (
    <div className="bg-[#f1f5f9] min-h-screen text-slate-800 font-sans antialiased text-xs pb-16">
      {/* 1. Top Breadcrumb & Status Ribbon (Matching Screenshot) */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between shadow-2xs sticky top-14 z-20">
        <div className="flex items-center gap-2 text-slate-700">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-slate-500 hover:text-slate-800 p-1 rounded hover:bg-slate-100 transition"
              title="ย้อนกลับ"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <Link
              href={`/projects/${projectId}?tab=boq`}
              prefetch={false}
              className="text-slate-500 hover:text-slate-800 p-1 rounded hover:bg-slate-100 transition"
              title="ย้อนกลับ"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
          )}
          <span className="font-semibold text-slate-900">{vo ? `BOQ งานเพิ่ม ${vo.number}` : 'BOQ หลัก'}</span>
          <span className="text-slate-400">·</span>
          <span className="font-mono text-slate-600 font-medium">{meta.docNo}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">แบบแสดงรายการ ปริมาณงาน และราคา</span>
        </div>

        {/* Right Status Indicator */}
        <div className="flex items-center gap-2">
          {!canEdit && (
            <span className="text-slate-500 font-medium text-xs bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
              ดูอย่างเดียว
            </span>
          )}
          {saveError ? (
            <span
              role="alert"
              className="flex items-center gap-1 text-red-700 font-medium text-xs bg-red-50 px-2.5 py-1 rounded-md border border-red-200"
            >
              <AlertCircle className="w-3.5 h-3.5 text-red-500" />
              <span>{saveError}</span>
            </span>
          ) : isPending ? (
            <span className="flex items-center gap-1 text-blue-700 font-medium text-xs bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
              <span>กำลังบันทึก...</span>
            </span>
          ) : isSaved ? (
            <span className="flex items-center gap-1.5 text-emerald-700 font-medium text-xs bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>บันทึกแล้ว {saveTime && `(${saveTime} น.)`}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600 font-medium text-xs bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              <span>ยังไม่ได้บันทึก</span>
            </span>
          )}
        </div>
      </div>

      {/* 2. Top Tab Ribbon (BOQ / หน้าแรก) */}
      <div className="bg-white border-b border-slate-200 px-6 pt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveSheetTab('boq')}
          className={`px-5 py-2 font-bold text-xs rounded-t-lg transition flex items-center gap-1.5 ${
            activeSheetTab === 'boq'
              ? 'bg-[#15803d] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>BOQ</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSheetTab('home')}
          className={`px-5 py-2 font-medium text-xs rounded-t-lg transition ${
            activeSheetTab === 'home'
              ? 'bg-slate-200 text-slate-900 font-bold'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>หน้าแรก</span>
        </button>
      </div>

      {/* 3. Action Ribbon Toolbar (Matching Excel/reference Toolbar Exactly) */}
      <div className="bg-white border-b border-slate-200 px-6 py-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* 1. + หมวด BOQ */}
          <button
            type="button"
            onClick={handleAddCategory}
            disabled={!editable}
            className="disabled:opacity-50 flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition"
            title="เพิ่มหมวดหมู่งาน"
          >
            <Plus className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
            <span className="text-[11px] font-semibold mt-0.5">หมวด BOQ</span>
          </button>

          {/* 2. + รายการ เพิ่มรายการ */}
          <button
            type="button"
            onClick={handleAddItem}
            disabled={!editable}
            className="disabled:opacity-50 flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition"
            title="เพิ่มรายการหลัก"
          >
            <Plus className="w-4 h-4 text-blue-600 stroke-[2.5]" />
            <span className="text-[11px] font-semibold mt-0.5">รายการ</span>
            <span className="text-[9px] text-slate-400">เพิ่มรายการ</span>
          </button>

          {/* 3. + รายการย่อย */}
          <button
            type="button"
            onClick={handleAddSubItem}
            disabled={!editable}
            className="disabled:opacity-50 flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition"
            title="เพิ่มรายการย่อย"
          >
            <Plus className="w-4 h-4 text-indigo-600 stroke-[2.5]" />
            <span className="text-[11px] font-semibold mt-0.5">รายการย่อย</span>
          </button>

          {/* 4. B ตัวหนา จัดรูปแบบ */}
          <button
            type="button"
            onClick={handleToggleBold}
            disabled={!editable}
            className="disabled:opacity-50 flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition"
            title="ทำตัวหนาแถวที่เลือก"
          >
            <span className="font-serif font-black text-sm text-slate-800">B</span>
            <span className="text-[11px] font-semibold mt-0.5">ตัวหนา</span>
            <span className="text-[9px] text-slate-400">จัดรูปแบบ</span>
          </button>

          <div className="h-8 w-px bg-slate-200 mx-1" />

          {/* 5. Template BOQ */}
          <button
            type="button"
            onClick={handleTemplate}
            className="flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition"
            title="ดาวน์โหลดเทมเพลต BOQ"
          >
            <div className="w-5 h-5 rounded bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px]">
              X
            </div>
            <span className="text-[11px] font-semibold mt-0.5">Template BOQ</span>
          </button>

          {/* 6. Import ไฟล์และดราฟต์ */}
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={!editable}
            className="disabled:opacity-50 flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition"
            title="นำเข้าไฟล์"
          >
            <div className="w-5 h-5 rounded bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px]">
              X↓
            </div>
            <span className="text-[11px] font-semibold mt-0.5">Import</span>
            <span className="text-[9px] text-slate-400">ไฟล์และดราฟต์</span>
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            aria-label="นำเข้าไฟล์ BOQ"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = '';
            }}
          />

          {/* 7. Export */}
          <button
            type="button"
            onClick={handleExport}
            className="flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition"
            title="ส่งออก Excel/CSV"
          >
            <div className="w-5 h-5 rounded bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px]">
              X↑
            </div>
            <span className="text-[11px] font-semibold mt-0.5">Export</span>
          </button>

          {/* 8. พิมพ์ */}
          <button
            type="button"
            onClick={() => window.print()}
            className="flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition"
            title="พิมพ์เอกสาร / PDF"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span className="text-[11px] font-semibold mt-0.5">พิมพ์</span>
          </button>

          <div className="h-8 w-px bg-slate-200 mx-1" />

          {/* 9. ลบ BOQ ทั้งหมด รีเซ็ต */}
          <button
            type="button"
            onClick={handleResetAll}
            disabled={!editable}
            className="disabled:opacity-50 flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 transition"
            title="ล้างข้อมูลทั้งหมด"
          >
            <Trash2 className="w-4 h-4 text-red-500" />
            <span className="text-[11px] font-semibold mt-0.5">ลบ BOQ ทั้งหมด</span>
            <span className="text-[9px] text-red-400">รีเซ็ต</span>
          </button>

          {/* 10. บันทึก BOQ */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!editable || isSaved}
            className="flex flex-col items-center justify-center px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
            title="บันทึกข้อมูล BOQ"
          >
            <Save className="w-4 h-4" />
            <span className="text-[11px] font-bold mt-0.5">{isPending ? 'กำลังบันทึก' : 'บันทึก'}</span>
            <span className="text-[9px] text-emerald-100">BOQ</span>
          </button>
        </div>
      </div>

      {/* 4. Main Construction Document Paper (Pixel-Perfect Matching Sheet) */}
      {/* Read-only users and in-flight saves cannot edit the sheet */}
      <fieldset disabled={!editable} className="contents">
      <div className="max-w-[1240px] mx-auto p-4 sm:p-6 lg:p-8">
        <div className="bg-white border-2 border-slate-700 shadow-md rounded-xs overflow-hidden">
          {/* Header Title Banner: Navy Blue */}
          <div className="bg-[#102d72] text-white text-center py-2.5 px-4 font-bold text-sm tracking-wide border-b-2 border-slate-700">
            บัญชีรายการวัสดุและค่าแรงงานก่อสร้าง (Bill Of Quantities)
          </div>

          {/* Project Metadata Two-Column Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x border-b-2 border-slate-700 text-xs">
            {/* Left Column */}
            <div className="p-3 sm:p-4 space-y-2">
              <div className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-4 font-semibold text-slate-800">โครงการ</span>
                <input
                  type="text"
                  value={meta.projectName}
                  onChange={(e) => {
                    setMeta({ ...meta, projectName: e.target.value });
                    markDirty();
                  }}
                  className="col-span-8 px-2 py-1 border border-slate-300 rounded font-medium focus:border-blue-600 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-4 font-semibold text-slate-800">สถานที่ก่อสร้าง</span>
                <input
                  type="text"
                  value={meta.location}
                  onChange={(e) => {
                    setMeta({ ...meta, location: e.target.value });
                    markDirty();
                  }}
                  className="col-span-8 px-2 py-1 border border-slate-300 rounded focus:border-blue-600 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-4 font-semibold text-slate-800">เจ้าของโครงการ</span>
                <input
                  type="text"
                  value={meta.owner}
                  onChange={(e) => {
                    setMeta({ ...meta, owner: e.target.value });
                    markDirty();
                  }}
                  className="col-span-8 px-2 py-1 border border-slate-300 rounded focus:border-blue-600 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-4 font-semibold text-slate-800">รายละเอียดของงาน</span>
                <input
                  type="text"
                  value={meta.workDetail}
                  onChange={(e) => {
                    setMeta({ ...meta, workDetail: e.target.value });
                    markDirty();
                  }}
                  placeholder="........................................................"
                  className="col-span-8 px-2 py-1 border border-slate-300 rounded focus:border-blue-600 focus:outline-hidden"
                />
              </div>
            </div>

            {/* Right Column */}
            <div className="p-3 sm:p-4 space-y-2">
              <div className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-5 font-semibold text-slate-800">เลขที่เอกสาร</span>
                <input
                  type="text"
                  value={meta.docNo}
                  readOnly
                  title="ระบบออกเลขที่เอกสารให้อัตโนมัติ"
                  className="col-span-7 px-2 py-1 border border-slate-200 rounded font-mono font-medium bg-slate-50 text-slate-600"
                />
              </div>

              <div className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-5 font-semibold text-slate-800">แก้ไขครั้งที่</span>
                <div className="col-span-7 flex items-center gap-1 font-mono">
                  <span className="text-slate-500">Rev.</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    step={1}
                    value={meta.revision}
                    onChange={(e) => {
                      setMeta({ ...meta, revision: Math.max(0, Math.trunc(Number(e.target.value) || 0)) });
                      markDirty();
                    }}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono focus:border-blue-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-5 font-semibold text-slate-800">ประมาณการเมื่อวันที่</span>
                <div className="col-span-7 relative flex items-center">
                  <input
                    type="date"
                    value={meta.docDate}
                    onChange={(e) => {
                      setMeta({ ...meta, docDate: e.target.value });
                      markDirty();
                    }}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono focus:border-blue-600 focus:outline-hidden pr-7"
                  />
                  <Calendar className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
                </div>
              </div>

              <div className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-5 font-semibold text-slate-800">ผู้ประมาณการ</span>
                <input
                  type="text"
                  value={meta.estimator}
                  onChange={(e) => {
                    setMeta({ ...meta, estimator: e.target.value });
                    markDirty();
                  }}
                  placeholder="........................................................"
                  className="col-span-7 px-2 py-1 border border-slate-300 rounded focus:border-blue-600 focus:outline-hidden"
                />
              </div>
            </div>
          </div>

          <BoqLineGrid
            rows={rows}
            onRowsChange={(update) => {
              setRows(update);
              markDirty();
            }}
            selectedRowId={selectedRowId}
            onSelectRow={setSelectedRowId}
            overheadPercent={overheadPercent}
            onOverheadPercentChange={(v) => {
              setOverheadPercent(v);
              markDirty();
            }}
            discountAmount={discountAmount}
            onDiscountAmountChange={(v) => {
              setDiscountAmount(v);
              markDirty();
            }}
            vatPercent={vatPercent}
            onVatPercentChange={(v) => {
              setVatPercent(v);
              markDirty();
            }}
            remarks={remarks}
            onRemarksChange={(v) => {
              setRemarks(v);
              markDirty();
            }}
          />
        </div>

        {/* Floating Quick Action Button on the right (as seen in screenshot) */}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleAddItem}
            className="px-4 py-2 bg-white hover:bg-blue-50 border border-blue-200 text-[#2453d4] shadow-sm rounded-lg font-semibold text-xs flex items-center gap-1.5 transition"
          >
            <Plus className="w-4 h-4 text-blue-600" />
            <span>+ ดำเนินการเพิ่ม</span>
          </button>
        </div>
      </div>
      </fieldset>
    </div>
  );
}
