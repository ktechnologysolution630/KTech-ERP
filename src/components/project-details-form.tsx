'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from '@/domain/project';
import type { ProjectDetailDto } from '@/server/services/master';
import {
  updateProjectDetailsAction,
  type ProjectDetailsFormInput,
} from '@/app/(app)/projects/[id]/actions';

interface ProjectDetailsFormProps {
  project: ProjectDetailDto;
  users: { id: string; name: string }[];
  /** Billing customers; the chosen one is invoiced for this project's receive milestones */
  customers?: { id: string; code: string; name: string }[];
  onSaved?: () => void;
  onCancel?: () => void;
}

const inputClass =
  'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4] disabled:bg-slate-50 disabled:text-slate-500';

function toFormState(p: ProjectDetailDto): ProjectDetailsFormInput {
  return {
    name: p.name,
    status: p.status,
    clientName: p.clientName,
    projectGroup: p.projectGroup,
    contactName: p.contactName,
    contactPhone: p.contactPhone,
    location: p.location,
    budget: p.budget,
    startDate: p.startDate,
    endDate: p.endDate,
    pmUserId: p.pmUserId,
    customerId: p.customerId,
  };
}

export function ProjectDetailsForm({ project, users, customers = [], onSaved, onCancel }: ProjectDetailsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<ProjectDetailsFormInput>(() => toFormState(project));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const set = <K extends keyof ProjectDetailsFormInput>(key: K, value: ProjectDetailsFormInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSavedAt(null);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateProjectDetailsAction(project.id, form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm(toFormState(result.project));
      setSavedAt(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
      router.refresh();
      onSaved?.();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {!project.canEdit && (
        <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-600">
          คุณดูข้อมูลได้อย่างเดียว เฉพาะ PM ของโครงการ เจ้าของ และผู้ดูแลระบบที่แก้ไขได้
        </p>
      )}
      <fieldset disabled={!project.canEdit || isPending} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-slate-700 mb-1">รหัสโครงการ</label>
            <input type="text" value={project.code} readOnly className={`${inputClass} bg-slate-50 font-mono`} />
          </div>
          <div>
            <label htmlFor="pd-name" className="block font-medium text-slate-700 mb-1">
              ชื่อโครงการ <span className="text-red-500">*</span>
            </label>
            <input
              id="pd-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pd-client" className="block font-medium text-slate-700 mb-1">ลูกค้า / ผู้ว่าจ้าง</label>
            <input
              id="pd-client"
              type="text"
              value={form.clientName}
              onChange={(e) => set('clientName', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="pd-customer" className="block font-medium text-slate-700 mb-1">ลูกค้าสำหรับวางบิล</label>
            <select
              id="pd-customer"
              value={form.customerId ?? ''}
              onChange={(e) => {
                const c = customers.find((x) => x.id === e.target.value);
                set('customerId', e.target.value || null);
                if (c && !form.clientName.trim()) set('clientName', c.name);
              }}
              className={inputClass}
            >
              <option value="">— ยังไม่กำหนด —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pd-group" className="block font-medium text-slate-700 mb-1">กลุ่มโครงการ</label>
            <input
              id="pd-group"
              type="text"
              value={form.projectGroup}
              onChange={(e) => set('projectGroup', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pd-contact" className="block font-medium text-slate-700 mb-1">ผู้ติดต่อ</label>
            <input
              id="pd-contact"
              type="text"
              value={form.contactName}
              onChange={(e) => set('contactName', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="pd-phone" className="block font-medium text-slate-700 mb-1">โทรศัพท์</label>
            <input
              id="pd-phone"
              type="tel"
              value={form.contactPhone}
              onChange={(e) => set('contactPhone', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="pd-location" className="block font-medium text-slate-700 mb-1">สถานที่ก่อสร้าง</label>
          <input
            id="pd-location"
            type="text"
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="pd-budget" className="block font-medium text-slate-700 mb-1">งบประมาณตามสัญญา (บาท)</label>
            <input
              id="pd-budget"
              type="number"
              min={0}
              step="0.01"
              value={form.budget}
              onChange={(e) => set('budget', e.target.value === '' ? 0 : Number(e.target.value))}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="pd-status" className="block font-medium text-slate-700 mb-1">สถานะโครงการ</label>
            <select
              id="pd-status"
              value={form.status}
              onChange={(e) => set('status', e.target.value as ProjectStatus)}
              className={inputClass}
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pd-pm" className="block font-medium text-slate-700 mb-1">ผู้จัดการโครงการ</label>
            <select
              id="pd-pm"
              value={form.pmUserId ?? ''}
              onChange={(e) => set('pmUserId', e.target.value || null)}
              className={inputClass}
            >
              <option value="">— ไม่ระบุ —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pd-start" className="block font-medium text-slate-700 mb-1">วันเริ่มต้นสัญญา</label>
            <input
              id="pd-start"
              type="date"
              value={form.startDate ?? ''}
              onChange={(e) => set('startDate', e.target.value || null)}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="pd-end" className="block font-medium text-slate-700 mb-1">วันสิ้นสุดสัญญา</label>
            <input
              id="pd-end"
              type="date"
              value={form.endDate ?? ''}
              min={form.startDate ?? undefined}
              onChange={(e) => set('endDate', e.target.value || null)}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      </fieldset>

      <div className="pt-2 flex items-center justify-end gap-3">
        {error && (
          <span role="alert" className="text-red-600 font-medium mr-auto">
            {error}
          </span>
        )}
        {savedAt && !error && <span className="text-emerald-700 mr-auto">บันทึกแล้ว ({savedAt} น.)</span>}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
          >
            ยกเลิก
          </button>
        )}
        {project.canEdit && (
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-[#2453d4] hover:bg-blue-700 text-white rounded-lg font-semibold transition disabled:opacity-60"
          >
            {isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูลโครงการ'}
          </button>
        )}
      </div>
    </form>
  );
}
