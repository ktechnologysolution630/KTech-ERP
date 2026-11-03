'use client';

import React, { useEffect, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { VO_STATUS_LABELS, type VoStatus } from '@/domain/variation-order';
import type { BoqDocumentDto } from '@/server/services/boq';
import type { VoBoqSheet } from '@/server/services/variation-orders';
import { BoqSheetEditor } from '@/components/boq-sheet-editor';
import { loadVoBoqAction } from '@/app/(app)/projects/[id]/vo-actions';

export interface VoBoqRow {
  voId: string;
  voNumber: string;
  title: string;
  status: VoStatus;
  boqNumber: string | null;
  lineCount: number;
  addAmount: number;
}

interface ProjectBoqPanelProps {
  projectId: string;
  projectCode: string;
  projectName: string;
  location?: string;
  mainBoq: BoqDocumentDto | null;
  canEdit: boolean;
  voBoqs?: VoBoqRow[];
}

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Loads a variation order's BOQ and shows it in the sheet editor. */
export function VoBoqEditor({
  projectId,
  projectCode,
  projectName,
  location,
  voId,
  onBack,
}: {
  projectId: string;
  projectCode: string;
  projectName: string;
  location?: string;
  voId: string;
  onBack: () => void;
}) {
  const [sheet, setSheet] = useState<VoBoqSheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadVoBoqAction(projectId, voId).then((r) => {
      if (cancelled) return;
      if (r.ok) setSheet(r.value);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, voId]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        {error}{' '}
        <button type="button" onClick={onBack} className="underline ml-2">
          ย้อนกลับ
        </button>
      </div>
    );
  }
  if (!sheet) return <div className="p-10 text-center text-xs text-slate-400">กำลังโหลด BOQ ของ VO...</div>;
  return (
    <BoqSheetEditor
      projectId={projectId}
      projectCode={projectCode}
      projectName={projectName}
      location={location}
      initialBoq={sheet.boq}
      canEdit={sheet.canEdit}
      vo={{ id: sheet.vo.id, number: sheet.vo.number }}
      onBack={onBack}
    />
  );
}

/**
 * BOQ tab landing view: lists the project's BOQ sets (main BOQ and one per variation order)
 * and opens the sheet editor for the chosen set; "back" returns here.
 */
export function ProjectBoqPanel({
  projectId,
  projectCode,
  projectName,
  location,
  mainBoq,
  canEdit,
  voBoqs = [],
}: ProjectBoqPanelProps) {
  const [open, setOpen] = useState<{ kind: 'MAIN' } | { kind: 'VO'; voId: string } | null>(null);

  if (open?.kind === 'MAIN') {
    return (
      <BoqSheetEditor
        projectId={projectId}
        projectCode={projectCode}
        projectName={projectName}
        location={location}
        initialBoq={mainBoq}
        canEdit={canEdit}
        onBack={() => setOpen(null)}
      />
    );
  }
  if (open?.kind === 'VO') {
    return (
      <VoBoqEditor
        projectId={projectId}
        projectCode={projectCode}
        projectName={projectName}
        location={location}
        voId={open.voId}
        onBack={() => setOpen(null)}
      />
    );
  }

  const itemCount = mainBoq ? mainBoq.lines.filter((l) => !l.isCategory).length : 0;
  const voRows = voBoqs.filter((v) => v.boqNumber !== null);
  const rowProps = (target: { kind: 'MAIN' } | { kind: 'VO'; voId: string }) => ({
    onClick: () => setOpen(target),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(target);
      }
    },
    tabIndex: 0,
    className: 'border-b border-slate-100 hover:bg-blue-50/50 cursor-pointer focus:outline-none focus:bg-blue-50',
  });

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">BOQ</h3>
          <p className="text-xs text-slate-500 mt-0.5">รายการ BOQ ของโครงการ แยก BOQ หลักและ BOQ ที่สร้างจาก VO</p>
        </div>
        {(mainBoq || canEdit) && (
          <button
            type="button"
            onClick={() => setOpen({ kind: 'MAIN' })}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1d44b8] text-white text-xs font-semibold shadow-sm transition"
          >
            {mainBoq ? <FileText className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {mainBoq ? 'เปิด BOQ หลัก' : 'สร้าง BOQ หลัก'}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-[#102d72] text-white text-xs">
            <tr>
              <th className="px-5 py-3 text-left font-semibold">ชุด BOQ</th>
              <th className="px-5 py-3 text-left font-semibold">เลขที่เอกสาร</th>
              <th className="px-5 py-3 text-right font-semibold">จำนวนรายการ</th>
              <th className="px-5 py-3 text-right font-semibold">มูลค่ารวม</th>
            </tr>
          </thead>
          <tbody>
            {!mainBoq && voRows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-14 text-center text-slate-400 text-sm">
                  ยังไม่มี BOQ ในโครงการนี้
                </td>
              </tr>
            )}
            {mainBoq && (
              <tr {...rowProps({ kind: 'MAIN' })}>
                <td className="px-5 py-3 font-semibold text-slate-900">BOQ หลัก</td>
                <td className="px-5 py-3 font-mono text-[#2453d4]">{mainBoq.number}</td>
                <td className="px-5 py-3 text-right font-mono">{itemCount}</td>
                <td className="px-5 py-3 text-right font-mono font-semibold">
                  {mainBoq.grandTotal > 0 ? baht(mainBoq.grandTotal) : '-'}
                </td>
              </tr>
            )}
            {voRows.map((v) => (
              <tr key={v.voId} {...rowProps({ kind: 'VO', voId: v.voId })}>
                <td className="px-5 py-3">
                  <span className="font-semibold text-slate-900">BOQ งานเพิ่ม {v.voNumber}</span>
                  <span className="block text-[11px] text-slate-500">
                    {v.title} · {VO_STATUS_LABELS[v.status]}
                  </span>
                </td>
                <td className="px-5 py-3 font-mono text-[#2453d4]">{v.boqNumber}</td>
                <td className="px-5 py-3 text-right font-mono">{v.lineCount}</td>
                <td className="px-5 py-3 text-right font-mono font-semibold">{v.addAmount > 0 ? baht(v.addAmount) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
