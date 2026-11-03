'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, FileSpreadsheet, Pencil, Plus } from 'lucide-react';
import { VO_STATUSES, VO_STATUS_LABELS, isVoEditable, type VoStatus } from '@/domain/variation-order';
import type { ProjectVoList } from '@/server/services/variation-orders';
import { VoFormDialog } from '@/components/vo-form-dialog';
import {
  cancelVoAction,
  decideVoAction,
  submitVoAction,
  type VoActionResult,
} from '@/app/(app)/projects/[id]/vo-actions';

interface Props {
  data: ProjectVoList;
  location?: string;
}

const STATUS_BADGE: Record<VoStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-400 line-through',
};

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ProjectVoView({ data, location = '' }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** undefined = closed, null = new VO, string = existing VO */
  const [formFor, setFormFor] = useState<string | null | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<VoStatus | 'ALL'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'ADD' | 'DEDUCT'>('ALL');

  const { project, contract, vos, options, canManage, canApprove } = data;

  const submit = (fn: () => Promise<VoActionResult>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onOk?.();
      router.refresh();
    });
  };

  const filtered = vos.filter((v) => {
    if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
    if (typeFilter === 'ADD' && v.addAmount <= 0) return false;
    if (typeFilter === 'DEDUCT' && v.deductAmount <= 0) return false;
    return true;
  });

  const kpis: [string, string, string?][] = [
    ['มูลค่าสัญญาเดิม', baht(contract.original)],
    ['งานเพิ่มอนุมัติ', baht(contract.approvedAdd), 'text-emerald-700'],
    ['งานลดอนุมัติ', baht(contract.approvedDeduct), 'text-red-600'],
    ['มูลค่าสัญญาปัจจุบัน', baht(contract.current), 'text-[#2453d4]'],
    ['VO รออนุมัติ', `${contract.pendingCount} รายการ`],
    ['วันขยายเวลา', `${contract.extensionDays} วัน`],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(([label, value, tone]) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`font-mono font-bold text-base mt-1 ${tone ?? 'text-slate-900'}`}>{value}</div>
          </div>
        ))}
      </div>
      {contract.revisedEndDate && contract.extensionDays !== 0 && (
        <p className="text-xs text-slate-500">
          วันสิ้นสุดสัญญาเดิม {project.endDate} → หลังรวม VO ที่อนุมัติ {contract.revisedEndDate}
        </p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 flex flex-wrap items-center gap-2 border-b border-slate-100">
          {canManage && (
            <button
              type="button"
              onClick={() => setFormFor(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700"
            >
              <Plus className="w-3.5 h-3.5" /> สร้าง VO
            </button>
          )}
          <select
            aria-label="กรองสถานะ"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as VoStatus | 'ALL')}
            className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs"
          >
            <option value="ALL">ทุกสถานะ</option>
            {VO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {VO_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="กรองประเภท"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'ALL' | 'ADD' | 'DEDUCT')}
            className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs"
          >
            <option value="ALL">ทุกประเภท</option>
            <option value="ADD">มีงานเพิ่ม</option>
            <option value="DEDUCT">มีงานลด</option>
          </select>
          {error && (
            <p role="alert" className="text-xs text-red-600 font-medium ml-2">
              {error}
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1000px]">
            <thead className="bg-[#102d72] text-white">
              <tr>
                <th className="px-3 py-2 text-left">เลขที่ VO / วันที่</th>
                <th className="px-3 py-2 text-left">ประเภท / รายละเอียด</th>
                <th className="px-3 py-2 text-left">ผู้ร้องขอ</th>
                <th className="px-3 py-2 text-right">เพิ่ม</th>
                <th className="px-3 py-2 text-right">ลด</th>
                <th className="px-3 py-2 text-right">สุทธิ</th>
                <th className="px-3 py-2 text-right">วันกระทบ</th>
                <th className="px-3 py-2 text-left">สถานะ</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    ยังไม่พบรายการ VO
                  </td>
                </tr>
              )}
              {filtered.map((v) => {
                const editable = canManage && isVoEditable(v.status);
                return (
                  <tr key={v.id} className={v.status === 'CANCELLED' ? 'opacity-60' : ''}>
                    <td className="px-3 py-2">
                      <div className="font-mono font-semibold">{v.number}</div>
                      <div className="text-slate-400">{v.requestDate}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-[11px] text-slate-500">{v.typeLabel}</div>
                      <div className="font-medium text-slate-800">{v.title}</div>
                      {v.decisionNote && <div className="text-[11px] text-red-600">หมายเหตุผู้อนุมัติ: {v.decisionNote}</div>}
                    </td>
                    <td className="px-3 py-2">{v.requestedByName}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{v.addAmount > 0 ? baht(v.addAmount) : '-'}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-600">{v.deductAmount > 0 ? baht(v.deductAmount) : '-'}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{baht(v.netAmount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{v.daysImpact}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_BADGE[v.status]}`}>
                        {VO_STATUS_LABELS[v.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setFormFor(v.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] hover:bg-slate-50"
                          title={editable ? 'แก้ไข VO และ BOQ' : 'ดู VO'}
                        >
                          {editable ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          {editable ? 'แก้ไข' : 'ดู'}
                          {v.boqLineCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700">
                              <FileSpreadsheet className="w-3 h-3" />
                              {v.boqLineCount}
                            </span>
                          )}
                        </button>
                        {editable && (
                          <>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                if (confirm(`ส่ง ${v.number} ขออนุมัติ?`)) submit(() => submitVoAction(project.id, v.id));
                              }}
                              className="px-2 py-1 rounded-md bg-[#2453d4] text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              ส่งอนุมัติ
                            </button>
                          </>
                        )}
                        {canApprove && v.status === 'PENDING' && (
                          <>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                if (confirm(`อนุมัติ ${v.number} สุทธิ ${baht(v.netAmount)} บาท ${v.daysImpact} วัน?`)) {
                                  submit(() => decideVoAction(project.id, v.id, true, ''));
                                }
                              }}
                              className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 disabled:opacity-50"
                            >
                              อนุมัติ
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                const note = prompt(`เหตุผลที่ไม่อนุมัติ ${v.number}`);
                                if (note !== null) submit(() => decideVoAction(project.id, v.id, false, note));
                              }}
                              className="px-2 py-1 rounded-md border border-red-200 text-red-600 text-[11px] hover:bg-red-50 disabled:opacity-50"
                            >
                              ไม่อนุมัติ
                            </button>
                          </>
                        )}
                        {canManage && v.status !== 'APPROVED' && v.status !== 'CANCELLED' && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              if (confirm(`ยกเลิก ${v.number}?`)) submit(() => cancelVoAction(project.id, v.id));
                            }}
                            className="px-2 py-1 rounded-md text-slate-500 text-[11px] hover:text-red-600"
                          >
                            ยกเลิก
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
          ทั้งหมด {filtered.length} รายการ · ยอดงานเพิ่มมาจาก BOQ ของ VO (รวมค่าดำเนินการ ส่วนลด และ VAT)
        </div>
      </div>

      {formFor !== undefined && (
        <VoFormDialog
          key={formFor ?? 'new'}
          project={{ id: project.id, name: project.name, location }}
          voId={formFor}
          contractValue={contract.current}
          options={options}
          canManage={canManage}
          onClose={() => setFormFor(undefined)}
          onSaved={() => {
            setFormFor(undefined);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
