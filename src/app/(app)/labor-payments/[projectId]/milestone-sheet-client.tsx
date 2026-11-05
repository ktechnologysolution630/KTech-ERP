'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileSpreadsheet, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import {
  MILESTONE_KIND_LABELS,
  MILESTONE_STATUS_LABELS,
  canCancelMilestone,
  computeMilestoneAmounts,
  type MilestoneStatus,
} from '@/domain/milestone';
import type { MilestoneDto, MilestoneSheet } from '@/server/services/milestones';
import {
  advanceMilestoneAction,
  cancelMilestoneAction,
  createMilestoneAction,
  deleteMilestoneAction,
  generateMilestonesAction,
  updateMilestoneAction,
  type MilestoneActionResult,
} from '../actions';
import { invoiceFromMilestoneAction } from '@/app/(app)/ar/actions';
import { DateInput } from '@/components/date-input';

interface Props {
  sheet: MilestoneSheet;
  contractors: { id: string; name: string }[];
}

interface FormState {
  title: string;
  completionCriteria: string;
  vendorId: string | null;
  plannedDate: string | null;
  amount: number;
  retentionPercent: number;
  note: string;
}

const EMPTY: FormState = {
  title: '',
  completionCriteria: '',
  vendorId: null,
  plannedDate: null,
  amount: 0,
  retentionPercent: 5,
  note: '',
};

const STATUS_BADGE: Record<MilestoneStatus, string> = {
  PLANNED: 'bg-slate-100 text-slate-700',
  CLAIMED: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-blue-50 text-blue-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-red-50 text-red-600 line-through',
};

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]';

export function MilestoneSheetClient({ sheet, contractors }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ id: string | null; form: FormState } | null>(null);
  const [boqDialog, setBoqDialog] = useState<{ retention: number } | null>(null);

  const { project, kind, rows, summary, permissions } = sheet;
  const isPay = kind === 'PAY';
  const labels = MILESTONE_STATUS_LABELS[kind];
  const live = rows.filter((r) => r.status !== 'CANCELLED');

  const submit = (fn: () => Promise<MilestoneActionResult>, onOk?: () => void) => {
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

  const openEdit = (m: MilestoneDto) =>
    setDialog({
      id: m.id,
      form: {
        title: m.title,
        completionCriteria: m.completionCriteria,
        vendorId: m.vendorId,
        plannedDate: m.plannedDate,
        amount: m.amount,
        retentionPercent: m.retentionPercent,
        note: m.note,
      },
    });

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setDialog((d) => (d ? { ...d, form: { ...d.form, [k]: v } } : d));

  const advanceLabel: Partial<Record<MilestoneStatus, { text: string; allowed: boolean }>> = {
    PLANNED: { text: isPay ? 'รับใบเบิกงวด' : 'ส่งเบิกงวด', allowed: permissions.manage },
    CLAIMED: { text: 'อนุมัติ', allowed: permissions.approve },
    APPROVED: { text: isPay ? 'บันทึกจ่าย' : 'บันทึกรับเงิน', allowed: permissions.pay },
  };

  const preview = dialog ? computeMilestoneAmounts(dialog.form.amount || 0, dialog.form.retentionPercent || 0) : null;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/labor-payments?tab=${isPay ? 'payment-milestones' : 'receive-milestones'}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> รายการโครงการ
        </Link>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 text-xs">
          {(['PAY', 'RECEIVE'] as const).map((k) => (
            <Link
              key={k}
              href={`/labor-payments/${project.id}?kind=${k}`}
              className={`px-3 py-1 rounded-md ${k === kind ? 'bg-white shadow-xs font-semibold text-[#2453d4]' : 'text-slate-600'}`}
            >
              {MILESTONE_KIND_LABELS[k]}
            </Link>
          ))}
        </div>
      </div>

      <header className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div>
          <div className="text-[11px] font-mono text-slate-400">{project.code}</div>
          <h1 className="text-lg font-bold text-slate-900">
            {MILESTONE_KIND_LABELS[kind]} · {project.name}
          </h1>
          <p className="text-xs text-slate-500">
            {[project.clientName, project.location].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          {[
            ['งบประมาณโครงการ', baht(summary.budget)],
            ['ในแผนงวด', baht(summary.planned)],
            ['ยังไม่จัดงวด', baht(summary.unplanned)],
            [isPay ? 'อนุมัติ/จ่ายแล้ว' : 'อนุมัติ/รับแล้ว', baht(summary.approvedOrPaid)],
            ['สัดส่วนในแผน', `${summary.plannedPercent}%`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <dt className="text-slate-500">{k}</dt>
              <dd className={`font-mono font-bold text-sm mt-0.5 ${k === 'ยังไม่จัดงวด' && summary.unplanned < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {summary.unplanned < 0 && (
          <p className="text-xs text-red-600">มูลค่าในแผนงวดเกินงบประมาณโครงการ {baht(-summary.unplanned)} บาท</p>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {permissions.manage && (
          <>
            <button
              type="button"
              onClick={() => setDialog({ id: null, form: { ...EMPTY } })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700"
            >
              <Plus className="w-3.5 h-3.5" /> เพิ่มงวดงาน
            </button>
            <button
              type="button"
              disabled={!sheet.hasBoq}
              title={sheet.hasBoq ? undefined : 'โครงการนี้ยังไม่มี BOQ หลัก'}
              onClick={() => setBoqDialog({ retention: 5 })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /> สร้างจาก BOQ
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Printer className="w-3.5 h-3.5" /> พิมพ์
        </button>
        {error && (
          <p role="alert" className="text-xs text-red-600 font-medium ml-2">
            {error}
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-x-auto">
        <table className="w-full text-xs min-w-[1100px]">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left w-12">งวด</th>
              <th className="px-3 py-2 text-left">รายการ / งานแล้วเสร็จ</th>
              {isPay && <th className="px-3 py-2 text-left">ผู้รับผิดชอบ</th>}
              <th className="px-3 py-2 text-left">วันที่ตามแผน</th>
              <th className="px-3 py-2 text-right">% แผน</th>
              <th className="px-3 py-2 text-right">จำนวนเงิน</th>
              <th className="px-3 py-2 text-right">หักประกันผลงาน</th>
              <th className="px-3 py-2 text-right">{isPay ? 'คงเหลือจ่ายงวด' : 'คงเหลือรับงวด'}</th>
              <th className="px-3 py-2 text-left">สถานะ</th>
              <th className="px-3 py-2 text-left">{isPay ? 'วันที่จ่าย' : 'วันที่รับเงิน'}</th>
              <th className="px-3 py-2 print:hidden" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={isPay ? 11 : 10} className="py-12 text-center text-slate-400">
                  ยังไม่มีงวดงาน · เพิ่มงวดงานเอง หรือกด &quot;สร้างจาก BOQ&quot;
                </td>
              </tr>
            )}
            {rows.map((m) => {
              const step = advanceLabel[m.status];
              return (
                <tr key={m.id} className={m.status === 'CANCELLED' ? 'opacity-60' : ''}>
                  <td className="px-3 py-2 font-mono">{m.seq}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{m.title}</div>
                    {m.completionCriteria && <div className="text-[11px] text-slate-500">{m.completionCriteria}</div>}
                    {m.note && <div className="text-[11px] text-slate-400">หมายเหตุ: {m.note}</div>}
                  </td>
                  {isPay && <td className="px-3 py-2 text-slate-700">{m.vendorName ?? '-'}</td>}
                  <td className="px-3 py-2 font-mono text-slate-600">{m.plannedDate ?? '-'}</td>
                  <td className="px-3 py-2 text-right font-mono">{m.planPercent}%</td>
                  <td className="px-3 py-2 text-right font-mono">{baht(m.amount)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">
                    {baht(m.retentionAmount)} <span className="text-[10px] text-slate-400">({m.retentionPercent}%)</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{baht(m.netAmount)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_BADGE[m.status]}`}>
                      {labels[m.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">{m.paidAt ?? '-'}</td>
                  <td className="px-3 py-2 print:hidden">
                    <div className="flex items-center justify-end gap-1">
                      {m.invoiceId ? (
                        <Link
                          href={`/ar/invoices/${m.invoiceId}`}
                          className="px-2 py-1 rounded-md border border-slate-200 text-[11px] text-[#2453d4] hover:bg-blue-50 font-mono"
                        >
                          {m.invoiceNumber ?? 'ใบแจ้งหนี้ (ร่าง)'}
                        </Link>
                      ) : (
                        permissions.bill &&
                        (m.status === 'CLAIMED' || m.status === 'APPROVED') && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              setError(null);
                              startTransition(async () => {
                                const r = await invoiceFromMilestoneAction(m.id, project.id);
                                if (!r.ok) setError(r.error);
                                else router.push(`/ar/invoices/${r.value}`);
                              });
                            }}
                            className="px-2 py-1 rounded-md border border-emerald-300 text-emerald-700 text-[11px] font-medium hover:bg-emerald-50 disabled:opacity-50"
                          >
                            วางบิล
                          </button>
                        )
                      )}
                      {step?.allowed && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            if (confirm(`${step.text} งวดที่ ${m.seq} "${m.title}"?`)) {
                              submit(() => advanceMilestoneAction(project.id, m.id));
                            }
                          }}
                          className="px-2 py-1 rounded-md bg-[#2453d4] text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          {step.text}
                        </button>
                      )}
                      {permissions.manage && m.status === 'PLANNED' && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(m)}
                            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            title="แก้ไข"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              if (confirm(`ลบงวดที่ ${m.seq}?`)) submit(() => deleteMilestoneAction(project.id, m.id));
                            }}
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                            title="ลบ"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {permissions.manage && m.status !== 'PLANNED' && canCancelMilestone(m.status) && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            const reason = prompt(`เหตุผลที่ยกเลิกงวดที่ ${m.seq}`);
                            if (reason !== null) submit(() => cancelMilestoneAction(project.id, m.id, reason));
                          }}
                          className="px-2 py-1 rounded-md border border-red-200 text-red-600 text-[11px] hover:bg-red-50"
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
          {live.length > 0 && (
            <tfoot className="bg-slate-50 font-semibold border-t border-slate-200">
              <tr>
                <td className="px-3 py-2" colSpan={isPay ? 4 : 3}>
                  รวม
                </td>
                <td className="px-3 py-2 text-right font-mono">{summary.plannedPercent}%</td>
                <td className="px-3 py-2 text-right font-mono">{baht(summary.planned)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {baht(live.reduce((a, r) => a + r.retentionAmount, 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono">{baht(live.reduce((a, r) => a + r.netAmount, 0))}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { id, form } = dialog;
              submit(
                () => (id ? updateMilestoneAction(project.id, id, form) : createMilestoneAction(project.id, kind, form)),
                () => setDialog(null),
              );
            }}
            className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-5 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h2 className="font-bold text-sm text-slate-900">{dialog.id ? 'แก้ไขงวดงาน' : 'เพิ่มงวดงาน'}</h2>
              <button type="button" onClick={() => setDialog(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <fieldset disabled={isPending} className="space-y-3">
              <div>
                <label htmlFor="ms-title" className="block font-medium text-slate-700 mb-1">
                  รายการ <span className="text-red-500">*</span>
                </label>
                <input
                  id="ms-title"
                  required
                  value={dialog.form.title}
                  onChange={(e) => setField('title', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="ms-criteria" className="block font-medium text-slate-700 mb-1">งานแล้วเสร็จ (เงื่อนไขเบิก)</label>
                <input
                  id="ms-criteria"
                  value={dialog.form.completionCriteria}
                  onChange={(e) => setField('completionCriteria', e.target.value)}
                  className={inputClass}
                />
              </div>
              {isPay && (
                <div>
                  <label htmlFor="ms-vendor" className="block font-medium text-slate-700 mb-1">ผู้รับเหมา</label>
                  <select
                    id="ms-vendor"
                    value={dialog.form.vendorId ?? ''}
                    onChange={(e) => setField('vendorId', e.target.value || null)}
                    className={inputClass}
                  >
                    <option value="">— ไม่ระบุ —</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ms-amount" className="block font-medium text-slate-700 mb-1">
                    จำนวนเงิน <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ms-amount"
                    type="number"
                    min={0.01}
                    step="0.01"
                    required
                    value={dialog.form.amount || ''}
                    onChange={(e) => setField('amount', Number(e.target.value) || 0)}
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label htmlFor="ms-retention" className="block font-medium text-slate-700 mb-1">หักประกัน (%)</label>
                  <input
                    id="ms-retention"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={dialog.form.retentionPercent}
                    onChange={(e) => setField('retentionPercent', Number(e.target.value) || 0)}
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label htmlFor="ms-date" className="block font-medium text-slate-700 mb-1">วันที่ตามแผน</label>
                  <DateInput
                    id="ms-date"
                    value={dialog.form.plannedDate ?? ''}
                    onChange={(e) => setField('plannedDate', e.target.value || null)}
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>
              {preview && (
                <p className="text-slate-500">
                  หักประกัน {baht(preview.retention.toNumber())} · คงเหลือ{isPay ? 'จ่าย' : 'รับ'}{' '}
                  <span className="font-mono font-semibold text-slate-800">{baht(preview.net.toNumber())}</span> บาท
                </p>
              )}
              <div>
                <label htmlFor="ms-note" className="block font-medium text-slate-700 mb-1">หมายเหตุ</label>
                <input
                  id="ms-note"
                  value={dialog.form.note}
                  onChange={(e) => setField('note', e.target.value)}
                  className={inputClass}
                />
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="text-red-600 font-medium">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setDialog(null)} className="px-3 py-1.5 border border-slate-200 rounded-lg">
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-1.5 bg-[#2453d4] hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-60"
              >
                {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        </div>
      )}

      {boqDialog && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(() => generateMilestonesAction(project.id, kind, boqDialog.retention), () => setBoqDialog(null));
            }}
            className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-3 text-xs"
          >
            <h2 className="font-bold text-sm text-slate-900">สร้างแผนงวดจาก BOQ</h2>
            <p className="text-slate-600">
              ระบบจะสร้าง 1 งวดต่อ 1 หมวดใน BOQ หลัก{' '}
              {isPay
                ? 'โดยใช้ต้นทุนวัสดุและค่าแรงของแต่ละหมวด'
                : 'โดยกระจายราคารวมทั้งสิ้นของ BOQ (รวมค่าดำเนินการ ส่วนลด และ VAT) ตามสัดส่วนของแต่ละหมวด'}
            </p>
            {rows.length > 0 && (
              <p className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                งวดงานที่มีอยู่ {rows.length} งวดจะถูกแทนที่ทั้งหมด (ทำได้เฉพาะเมื่อยังไม่มีงวดที่ส่งเบิก)
              </p>
            )}
            <div>
              <label htmlFor="boq-retention" className="block font-medium text-slate-700 mb-1">หักประกันผลงานทุกงวด (%)</label>
              <input
                id="boq-retention"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={boqDialog.retention}
                onChange={(e) => setBoqDialog({ retention: Number(e.target.value) || 0 })}
                className={`${inputClass} font-mono`}
              />
            </div>
            {error && (
              <p role="alert" className="text-red-600 font-medium">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setBoqDialog(null)} className="px-3 py-1.5 border border-slate-200 rounded-lg">
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-1.5 bg-[#2453d4] hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-60"
              >
                {isPending ? 'กำลังสร้าง...' : 'สร้างแผนงวด'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
