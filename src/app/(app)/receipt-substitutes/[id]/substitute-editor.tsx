'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RECEIPT_SUBSTITUTE_STATUS_LABELS, type ReceiptSubstituteStatus } from '@/domain/advance';
import { bangkokDateString } from '@/domain/thai';
import {
  cancelReceiptSubstituteAction,
  decideReceiptSubstituteAction,
  saveReceiptSubstituteAction,
  submitReceiptSubstituteAction,
  type AdvResult,
} from '../../advances/actions';

export interface SubstituteEditorData {
  id: string;
  number: string | null;
  payerName: string;
  docDate: string;
  total: number;
  status: ReceiptSubstituteStatus;
  decisionNote: string;
  projectId: string | null;
  advanceId: string | null;
  canDecide: boolean;
  canEdit: boolean;
  canCancel: boolean;
  lines: { spentOn: string; description: string; paidTo: string; amount: number }[];
}

const inputClass = 'w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]';
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SubstituteEditor({
  doc,
  projects,
  advances,
}: {
  doc: SubstituteEditorData | null;
  projects: { id: string; label: string }[];
  advances: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editable = !doc || doc.canEdit;
  const [projectId, setProjectId] = useState(doc?.projectId ?? '');
  const [advanceId, setAdvanceId] = useState(doc?.advanceId ?? '');
  const [docDate, setDocDate] = useState(doc?.docDate ?? bangkokDateString());
  const [lines, setLines] = useState(doc?.lines ?? [{ spentOn: bangkokDateString(), description: '', paidTo: '', amount: 0 }]);
  const total = lines.reduce((a, l) => a + (l.amount || 0), 0);

  const submit = <T,>(fn: () => Promise<AdvResult<T>>, onOk?: (v: T) => void) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onOk?.(r.value);
      router.refresh();
    });
  };

  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            ใบรับรองแทนใบเสร็จรับเงิน {doc?.number && <span className="font-mono">{doc.number}</span>}
          </h1>
          {doc && <p className="text-slate-500">ผู้เบิกจ่าย {doc.payerName}</p>}
          {doc?.decisionNote && <p className="text-red-600">หมายเหตุผู้อนุมัติ: {doc.decisionNote}</p>}
        </div>
        {doc && <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-semibold">{RECEIPT_SUBSTITUTE_STATUS_LABELS[doc.status]}</span>}
      </div>

      <fieldset disabled={!editable || isPending} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label>
            <span className="block text-slate-600">วันที่เอกสาร</span>
            <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className={`${inputClass} font-mono`} />
          </label>
          <label>
            <span className="block text-slate-600">โครงการ</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
              <option value="">— ไม่ระบุ —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-slate-600">ใช้เคลียร์เงินทดรอง</span>
            <select value={advanceId} onChange={(e) => setAdvanceId(e.target.value)} className={inputClass}>
              <option value="">— ไม่อ้างอิง —</option>
              {advances.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <table className="w-full">
          <thead className="text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-1.5 text-left w-32">วันที่จ่าย</th>
              <th className="py-1.5 text-left">รายละเอียดรายจ่าย</th>
              <th className="py-1.5 text-left w-48">ผู้รับเงิน</th>
              <th className="py-1.5 text-right w-32">จำนวนเงิน</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-1">
                  <input type="date" aria-label="วันที่จ่าย" value={l.spentOn} onChange={(e) => setLine(i, { spentOn: e.target.value })} className={`${inputClass} font-mono`} />
                </td>
                <td className="py-1 pr-1">
                  <input aria-label="รายละเอียด" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={inputClass} />
                </td>
                <td className="py-1 pr-1">
                  <input aria-label="ผู้รับเงิน" value={l.paidTo} onChange={(e) => setLine(i, { paidTo: e.target.value })} className={inputClass} />
                </td>
                <td className="py-1 pr-1">
                  <input type="number" aria-label="จำนวนเงิน" min={0.01} step="0.01" value={l.amount || ''} onChange={(e) => setLine(i, { amount: Number(e.target.value) || 0 })} className={`${inputClass} font-mono text-right`} />
                </td>
                <td className="text-center">
                  {editable && lines.length > 1 && (
                    <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-red-600">
                      ลบ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={3} className="py-2 text-right">รวมทั้งสิ้น</td>
              <td className="py-2 text-right font-mono">{baht(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        {editable && (
          <button
            type="button"
            onClick={() => setLines((p) => [...p, { spentOn: bangkokDateString(), description: '', paidTo: '', amount: 0 }])}
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200"
          >
            + เพิ่มรายการ
          </button>
        )}
        <p className="text-slate-500">ข้าพเจ้าขอรับรองว่ารายจ่ายข้างต้นได้จ่ายไปจริงเพื่อกิจการ และไม่สามารถเรียกใบเสร็จรับเงินจากผู้รับได้</p>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        {editable && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              submit(
                () => saveReceiptSubstituteAction(doc?.id ?? null, { projectId: projectId || null, advanceId: advanceId || null, docDate, lines }),
                (id) => {
                  if (!doc) router.push(`/receipt-substitutes/${id}`);
                },
              )
            }
            className="px-4 py-2 rounded-lg border border-slate-300 font-semibold disabled:opacity-50"
          >
            บันทึกร่าง
          </button>
        )}
        {doc && doc.canEdit && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => confirm('ส่งขออนุมัติ? (บันทึกร่างก่อนหากมีการแก้ไข)') && submit(() => submitReceiptSubstituteAction(doc.id))}
            className="px-4 py-2 rounded-lg bg-[#2453d4] text-white font-semibold disabled:opacity-50"
          >
            ส่งขออนุมัติ
          </button>
        )}
        {doc?.canDecide && doc.status === 'PENDING' && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => confirm('อนุมัติเอกสารนี้?') && submit(() => decideReceiptSubstituteAction(doc.id, true, ''))}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50"
            >
              อนุมัติ
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                const note = prompt('เหตุผลที่ไม่อนุมัติ');
                if (note !== null) submit(() => decideReceiptSubstituteAction(doc.id, false, note));
              }}
              className="px-3 py-2 rounded-lg border border-red-200 text-red-600 disabled:opacity-50"
            >
              ไม่อนุมัติ
            </button>
          </>
        )}
        {doc?.canCancel && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => confirm('ยกเลิกเอกสารนี้?') && submit(() => cancelReceiptSubstituteAction(doc.id))}
            className="px-3 py-2 rounded-lg text-slate-500 hover:text-red-600 disabled:opacity-50"
          >
            ยกเลิก
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-red-600 font-medium">{error}</p>}
    </div>
  );
}
