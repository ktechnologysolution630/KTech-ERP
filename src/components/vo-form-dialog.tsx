'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { computeBoqTotals } from '@/domain/boq';
import { bangkokDateString } from '@/domain/thai';
import {
  VO_PRIORITIES,
  VO_PRIORITY_LABELS,
  VO_STATUS_LABELS,
  VO_TYPES,
  VO_TYPE_LABELS,
  voCostImpact,
  voDaysImpact,
  voTypeAllows,
  type VoPriority,
  type VoStatus,
  type VoType,
} from '@/domain/variation-order';
import type { BoqDocumentDto } from '@/server/services/boq';
import type { VoDocumentDto, VoFormOptions } from '@/server/services/variation-orders';
import { loadVoDocumentAction, saveVoDocumentAction } from '@/app/(app)/projects/[id]/vo-actions';
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

type VoForm = VoDocumentDto['input'];

interface ProjectInfo {
  id: string;
  name: string;
  location: string;
}

interface DialogProps {
  project: ProjectInfo;
  /** null opens a blank form for a new VO */
  voId: string | null;
  /** Prefills มูลค่างานเดิม on a new VO */
  contractValue: number;
  options: VoFormOptions;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const amountText = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputClass =
  'w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-hidden focus:border-[#2453d4] disabled:bg-slate-50 disabled:text-slate-500';

function blankForm(contractValue: number): VoForm {
  return {
    title: '',
    voType: 'ADD',
    requestDate: bangkokDateString(),
    requesterName: '',
    responsibleUserId: null,
    workArea: '',
    priority: 'NORMAL',
    description: '',
    changeReason: '',
    originalAmount: contractValue,
    addAmount: 0,
    deductAmount: 0,
    deductNote: '',
    vatPercent: 7,
    costCode: '',
    costCategory: '',
    costNote: '',
    scheduleImpact: false,
    daysAdded: 0,
    daysReduced: 0,
    impactStartDate: null,
    impactEndDate: null,
    criticalPath: false,
    affectedTaskId: null,
    affectedActivity: '',
    timeReason: '',
  };
}

/** Item rows nobody filled in (the starter row) are not saved. */
function isBlankItem(r: BoqRow): boolean {
  return !r.isCategory && !r.description.trim() && !Number(r.matRate || 0) && !Number(r.labRate || 0);
}

/** Loads an existing VO, then renders the form; a new VO renders immediately. */
export function VoFormDialog(props: DialogProps) {
  const { project, voId, onClose } = props;
  const [doc, setDoc] = useState<VoDocumentDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!voId) return;
    let cancelled = false;
    void loadVoDocumentAction(project.id, voId).then((r) => {
      if (cancelled) return;
      if (r.ok) setDoc(r.value);
      else setLoadError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, voId]);

  // Escape closes the dialog, as the backdrop does
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let body: React.ReactNode;
  if (loadError) {
    body = <p role="alert" className="p-10 text-center text-xs text-red-600">{loadError}</p>;
  } else if (voId && !doc) {
    body = <p className="p-10 text-center text-xs text-slate-400">กำลังโหลด VO...</p>;
  } else {
    body = <VoFormBody {...props} doc={doc} />;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="ฟอร์มงานเพิ่ม-ลด (VO)"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative max-w-[1000px] mx-auto my-6 bg-white shadow-2xl p-4 sm:p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-0 -right-0 m-1 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          title="ปิด"
        >
          <X className="w-4 h-4" />
        </button>
        {body}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#173a7a]">
      <h3 className="bg-[#173a7a] text-white px-3 py-1.5 text-xs font-bold">{title}</h3>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  htmlFor,
  className = '',
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-[11px] text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

function ReadoutBox({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'slate' }) {
  const toneClass = tone === 'blue' ? 'bg-blue-50 text-[#2453d4]' : 'bg-slate-50 text-slate-500';
  return (
    <div className={`${toneClass} rounded px-3 py-2`}>
      <div className="text-[11px]">{label}</div>
      <div className="font-mono font-bold text-sm text-slate-900">{value}</div>
    </div>
  );
}

function VoFormBody({
  project,
  voId,
  contractValue,
  options,
  canManage,
  onClose,
  onSaved,
  doc,
}: DialogProps & { doc: VoDocumentDto | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<VoForm>(() => doc?.input ?? blankForm(contractValue));

  const savedBoq: BoqDocumentDto | null = doc?.boq ?? null;
  const [rows, setRows] = useState<BoqRow[]>(() =>
    savedBoq ? rowsFromDto(savedBoq) : [{ ...makeItemRow(''), unit: 'งาน' }],
  );
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [overheadPercent, setOverheadPercent] = useState(savedBoq?.overheadPercent ?? 0);
  const [discountAmount, setDiscountAmount] = useState(savedBoq?.discountAmount ?? 0);
  const [remarks, setRemarks] = useState(savedBoq?.remarks ?? '');

  const editable = canManage && (doc ? doc.canEdit : true);
  const set = <K extends keyof VoForm>(key: K, value: VoForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const num = (v: string) => (v === '' ? 0 : Number(v) || 0);

  const allows = voTypeAllows(form.voType);
  const rowsToSave = rows.filter((r) => !isBlankItem(r));
  const pricedByBoq = rowsToSave.some((r) => !r.isCategory);
  const boqTotals = computeBoqTotals({
    rows: rowsToSave.map(toRowInput),
    overheadPercent,
    discountAmount,
    vatPercent: form.vatPercent,
  });
  const addAmount = pricedByBoq ? boqTotals.afterDiscount.toNumber() : form.addAmount;
  const cost = voCostImpact(addAmount, form.deductAmount, form.vatPercent);
  const netDays = voDaysImpact(form.scheduleImpact, form.daysAdded, form.daysReduced);

  const save = () => {
    setError(null);
    const boq =
      rowsToSave.length > 0 || savedBoq
        ? {
            baseUpdatedAt: savedBoq?.updatedAt ?? null,
            revision: savedBoq?.revision ?? 0,
            estimateDate: savedBoq?.estimateDate ?? form.requestDate,
            projectTitle: savedBoq?.projectTitle || project.name,
            location: savedBoq?.location || form.workArea || project.location,
            owner: savedBoq?.owner ?? '',
            workDetail: form.title,
            estimator: savedBoq?.estimator ?? '',
            overheadPercent,
            discountAmount,
            vatPercent: form.vatPercent,
            remarks,
            lines: rowsToLines(rowsToSave),
          }
        : null;
    startTransition(async () => {
      const r = await saveVoDocumentAction(project.id, voId, { vo: { ...form, addAmount }, boq });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onSaved();
    });
  };

  const status: VoStatus | null = doc?.status ?? null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (editable) save();
      }}
      className="space-y-4 text-xs text-slate-800"
    >
      {/* Document header */}
      <div className="grid grid-cols-[72px_1fr_auto_auto] sm:grid-cols-[110px_1fr_auto_auto] border-2 border-[#173a7a] items-stretch">
        <div className="flex items-center justify-center p-2 border-r border-[#173a7a]">
          <div className="w-10 h-10 rounded bg-[#2453d4] text-white font-black flex items-center justify-center tracking-tight">KT</div>
        </div>
        <div className="bg-[#173a7a] text-white flex flex-col items-center justify-center py-2 px-2 text-center">
          <div className="font-bold text-sm">{voId ? 'งานเพิ่ม-ลด (VO)' : 'สร้างงานเพิ่ม-ลด (VO)'}</div>
          <div className="text-[10px] font-semibold opacity-90">Variation Order</div>
        </div>
        <div className="bg-[#173a7a] text-white font-bold text-[11px] flex items-center px-3 border-l border-white/20">Report No.</div>
        <div className="flex flex-col justify-center px-3 font-mono text-[11px] font-semibold min-w-[120px]">
          <span>{doc?.number ?? 'ออกเลขเมื่อบันทึก'}</span>
          {status && <span className="font-sans font-normal text-slate-500">{VO_STATUS_LABELS[status]}</span>}
        </div>
      </div>
      {doc?.decisionNote && <p className="text-red-600">หมายเหตุผู้อนุมัติ: {doc.decisionNote}</p>}

      <fieldset disabled={!editable || isPending} className="space-y-4">
        <Section title="A. ข้อมูลทั่วไป">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="ชื่อรายการ" required htmlFor="vo-title" className="sm:col-span-2">
              <input id="vo-title" required maxLength={300} value={form.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
            </Field>
            <Field label="ประเภท VO" htmlFor="vo-type">
              <select id="vo-type" value={form.voType} onChange={(e) => set('voType', e.target.value as VoType)} className={inputClass}>
                {VO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {VO_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="วันที่ร้องขอ" htmlFor="vo-date">
              <input id="vo-date" type="date" required value={form.requestDate} onChange={(e) => set('requestDate', e.target.value)} className={`${inputClass} font-mono`} />
            </Field>
            <Field label="ผู้ร้องขอ" htmlFor="vo-requester">
              <input id="vo-requester" maxLength={200} value={form.requesterName} onChange={(e) => set('requesterName', e.target.value)} className={inputClass} />
            </Field>
            <Field label="ผู้รับผิดชอบ" htmlFor="vo-responsible">
              <select
                id="vo-responsible"
                value={form.responsibleUserId ?? ''}
                onChange={(e) => set('responsibleUserId', e.target.value || null)}
                className={inputClass}
              >
                <option value="">ไม่ระบุ</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="พื้นที่งาน" htmlFor="vo-area">
              <input id="vo-area" maxLength={300} value={form.workArea} onChange={(e) => set('workArea', e.target.value)} className={inputClass} />
            </Field>
            <Field label="ความสำคัญ" htmlFor="vo-priority">
              <select id="vo-priority" value={form.priority} onChange={(e) => set('priority', e.target.value as VoPriority)} className={inputClass}>
                {VO_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {VO_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="รายละเอียด" required htmlFor="vo-desc" className="sm:col-span-3">
              <textarea id="vo-desc" required rows={3} maxLength={5000} value={form.description} onChange={(e) => set('description', e.target.value)} className={inputClass} />
            </Field>
            <Field label="เหตุผลการเปลี่ยนแปลง" htmlFor="vo-reason" className="sm:col-span-3">
              <textarea id="vo-reason" rows={3} maxLength={2000} value={form.changeReason} onChange={(e) => set('changeReason', e.target.value)} className={inputClass} />
            </Field>
          </div>
        </Section>

        <Section title="B. ผลกระทบด้านต้นทุน">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="มูลค่างานเดิม" htmlFor="vo-original">
              <input id="vo-original" type="number" min={0} step="0.01" value={form.originalAmount} onChange={(e) => set('originalAmount', num(e.target.value))} className={`${inputClass} font-mono`} />
            </Field>
            <Field label={pricedByBoq ? 'มูลค่างานเพิ่ม (จาก BOQ ก่อน VAT)' : 'มูลค่างานเพิ่ม'} htmlFor="vo-add">
              <input
                id="vo-add"
                type="number"
                min={0}
                step="0.01"
                value={addAmount}
                readOnly={pricedByBoq}
                disabled={!allows.add}
                onChange={(e) => set('addAmount', num(e.target.value))}
                className={`${inputClass} font-mono ${pricedByBoq ? 'bg-slate-50' : ''}`}
                title={pricedByBoq ? 'คำนวณจากรายการ BOQ ด้านล่าง' : undefined}
              />
            </Field>
            <Field label="มูลค่างานลด" htmlFor="vo-deduct">
              <input
                id="vo-deduct"
                type="number"
                min={0}
                step="0.01"
                value={form.deductAmount}
                disabled={!allows.deduct}
                onChange={(e) => set('deductAmount', num(e.target.value))}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <ReadoutBox label="มูลค่าสุทธิ" value={amountText(cost.net.toNumber())} tone="blue" />
            <Field label="VAT (%)" htmlFor="vo-vat">
              <input id="vo-vat" type="number" min={0} max={100} step="0.01" value={form.vatPercent} onChange={(e) => set('vatPercent', num(e.target.value))} className={`${inputClass} font-mono`} />
            </Field>
            <ReadoutBox label="รวม VAT" value={amountText(cost.netWithVat.toNumber())} tone="slate" />
            <Field label="Cost Code" htmlFor="vo-cost-code">
              <input id="vo-cost-code" maxLength={100} value={form.costCode} onChange={(e) => set('costCode', e.target.value)} className={`${inputClass} font-mono`} />
            </Field>
            <Field label="หมวดต้นทุน" htmlFor="vo-cost-cat">
              <input id="vo-cost-cat" maxLength={200} value={form.costCategory} onChange={(e) => set('costCategory', e.target.value)} className={inputClass} />
            </Field>
            <div className="hidden sm:block" />
            <Field label="หมายเหตุด้านต้นทุน" htmlFor="vo-cost-note" className="sm:col-span-3">
              <textarea id="vo-cost-note" rows={3} maxLength={2000} value={form.costNote} onChange={(e) => set('costNote', e.target.value)} className={inputClass} />
            </Field>
          </div>
        </Section>

        <Section title="C. ผลกระทบด้านแผนงาน">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <label className="flex items-center gap-2 self-center">
              <input type="checkbox" checked={form.scheduleImpact} onChange={(e) => set('scheduleImpact', e.target.checked)} className="w-4 h-4 accent-[#2453d4]" />
              กระทบแผนงาน
            </label>
            <Field label="จำนวนวันที่เพิ่ม" htmlFor="vo-days-add">
              <input id="vo-days-add" type="number" min={0} step={1} disabled={!form.scheduleImpact} value={form.daysAdded} onChange={(e) => set('daysAdded', Math.max(0, Math.trunc(num(e.target.value))))} className={`${inputClass} font-mono`} />
            </Field>
            <Field label="จำนวนวันที่ลด" htmlFor="vo-days-reduce">
              <input id="vo-days-reduce" type="number" min={0} step={1} disabled={!form.scheduleImpact} value={form.daysReduced} onChange={(e) => set('daysReduced', Math.max(0, Math.trunc(num(e.target.value))))} className={`${inputClass} font-mono`} />
            </Field>
            <Field label="วันที่เริ่มกระทบ" htmlFor="vo-impact-start">
              <input id="vo-impact-start" type="date" disabled={!form.scheduleImpact} value={form.impactStartDate ?? ''} onChange={(e) => set('impactStartDate', e.target.value || null)} className={`${inputClass} font-mono`} />
            </Field>
            <Field label="วันที่สิ้นสุดคาดการณ์" htmlFor="vo-impact-end">
              <input
                id="vo-impact-end"
                type="date"
                disabled={!form.scheduleImpact}
                min={form.impactStartDate ?? undefined}
                value={form.impactEndDate ?? ''}
                onChange={(e) => set('impactEndDate', e.target.value || null)}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <label className="flex items-center gap-2 pb-2">
              <input type="checkbox" disabled={!form.scheduleImpact} checked={form.criticalPath} onChange={(e) => set('criticalPath', e.target.checked)} className="w-4 h-4 accent-[#2453d4]" />
              กระทบ Critical Path
            </label>
            <Field label="กิจกรรมที่ได้รับผลกระทบ" htmlFor="vo-task" className="sm:col-span-3">
              <input
                id="vo-task"
                list="vo-task-options"
                maxLength={300}
                disabled={!form.scheduleImpact}
                value={form.affectedActivity}
                placeholder={form.scheduleImpact ? 'พิมพ์ชื่อกิจกรรม หรือเลือกจากงานในโครงการ' : 'ติ๊ก "กระทบแผนงาน" ก่อนจึงจะกรอกได้'}
                onChange={(e) => {
                  const text = e.target.value;
                  // Exactly matching a task's name links the VO to that task; other text stays free text
                  const match = options.tasks.find((t) => t.title === text.trim());
                  setForm((f) => ({ ...f, affectedActivity: text, affectedTaskId: match?.id ?? null }));
                }}
                className={inputClass}
              />
              <datalist id="vo-task-options">
                {options.tasks.map((t) => (
                  <option key={t.id} value={t.title} />
                ))}
              </datalist>
            </Field>
            <Field label="เหตุผลด้านเวลา" htmlFor="vo-time-reason" className="sm:col-span-3">
              <textarea id="vo-time-reason" rows={3} maxLength={2000} value={form.timeReason} onChange={(e) => set('timeReason', e.target.value)} className={inputClass} />
            </Field>
          </div>
          {form.scheduleImpact && (
            <p className="mt-2 text-slate-500">
              ผลต่อสัญญา: {netDays > 0 ? `ขยายเวลา ${netDays} วัน` : netDays < 0 ? `ลดเวลา ${-netDays} วัน` : 'ไม่เปลี่ยนจำนวนวัน'}
            </p>
          )}
        </Section>

        <Section title="D-F. บันทึกรายละเอียดค่าวัสดุสิ่งของและค่าแรงเข้า BOQ">
          <div className="flex flex-wrap gap-2 p-2 mb-3 border border-slate-200 bg-slate-50 rounded">
            {(
              [
                ['หมวด BOQ', () => setRows((p) => [...p, makeCategoryRow(p)])],
                ['รายการ', () => setRows((p) => [...p, makeItemRow('')])],
                ['รายการย่อย', () => setRows((p) => [...p, makeSubItemRow()])],
              ] as const
            ).map(([label, onClick]) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                disabled={!allows.add}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded font-semibold hover:bg-slate-100 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => confirm('ลบรายการ BOQ ทั้งหมดของ VO นี้? (มีผลเมื่อกดบันทึก)') && setRows([])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded font-semibold hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> ลบ BOQ ทั้งหมด
            </button>
          </div>
          {!allows.add && <p className="mb-2 text-amber-700">VO ประเภทงานลดไม่ใช้รายการ BOQ งานเพิ่ม</p>}
          <div className="border border-slate-400">
            <BoqLineGrid
              rows={rows}
              onRowsChange={setRows}
              selectedRowId={selectedRowId}
              onSelectRow={setSelectedRowId}
              overheadPercent={overheadPercent}
              onOverheadPercentChange={setOverheadPercent}
              discountAmount={discountAmount}
              onDiscountAmountChange={setDiscountAmount}
              vatPercent={form.vatPercent}
              remarks={remarks}
              onRemarksChange={setRemarks}
              emptyHint="ยังไม่มีรายการ กด + รายการ เพื่อเพิ่มค่าวัสดุหรือค่าแรง"
            />
          </div>
        </Section>
      </fieldset>

      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
        {error && (
          <p role="alert" className="mr-auto text-red-600 font-medium">
            {error}
          </p>
        )}
        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg font-medium hover:bg-slate-50">
          {editable ? 'ยกเลิก' : 'ปิด'}
        </button>
        {editable && (
          <button type="submit" disabled={isPending} className="px-5 py-2 bg-[#2453d4] hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-60">
            {isPending ? 'กำลังบันทึก...' : 'บันทึก VO'}
          </button>
        )}
      </div>
    </form>
  );
}
