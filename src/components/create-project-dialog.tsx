'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, ImagePlus, Plus, X } from 'lucide-react';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from '@/domain/project';
import { PROJECT_PDF_FIELD_LABELS, ProjectDetailsCollector, type ProjectDetailsFromPdf, type ProjectPdfField } from '@/domain/project-pdf';
import { createProjectAction } from '@/app/(app)/projects/actions';
import { DateInput } from '@/components/date-input';

interface CreateProjectDialogProps {
  onClose: () => void;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 4 * 1024 * 1024;

/** Bordered box with the label inside, above the control. */
function Field({
  label,
  htmlFor,
  required,
  fromPdf,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  /** Filled from an imported PDF, marked so people check it before saving */
  fromPdf?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-3 pt-2 pb-1.5 focus-within:border-[#2453d4] focus-within:ring-2 focus-within:ring-blue-100 transition ${fromPdf ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
      <label htmlFor={htmlFor} className="block text-[11px] font-medium text-slate-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

const controlClass =
  'w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none py-0.5';

export function CreateProjectDialog({ onClose }: CreateProjectDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [startDate, setStartDate] = useState('');
  const [code, setCode] = useState('');
  const [clientName, setClientName] = useState('');
  const [projectGroup, setProjectGroup] = useState('');
  const [location, setLocation] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('PLANNING');
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  const [pdfResult, setPdfResult] = useState<string | null>(null);
  const [fromPdf, setFromPdf] = useState<ReadonlySet<ProjectPdfField>>(new Set());
  const pdfInput = useRef<HTMLInputElement>(null);
  const pdfRead = useRef<AbortController | null>(null);

  // Closing the dialog ends a read still running
  useEffect(() => () => pdfRead.current?.abort(), []);

  /** Fills only what is still empty: what someone already typed is never replaced. */
  const applyPdfDetails = (found: ProjectDetailsFromPdf) => {
    const current: Record<ProjectPdfField, string> = { name, code, clientName, projectGroup, location, startDate, endDate, budget, status: status === 'PLANNING' ? '' : status };
    const setters: Record<ProjectPdfField, (value: string) => void> = {
      name: setName,
      code: setCode,
      clientName: setClientName,
      projectGroup: setProjectGroup,
      location: setLocation,
      startDate: setStartDate,
      endDate: setEndDate,
      budget: setBudget,
      status: (value) => setStatus(value as ProjectStatus),
    };
    const filled = (Object.keys(found) as ProjectPdfField[]).filter((field) => found[field] && !current[field].trim());
    filled.forEach((field) => setters[field](found[field]!));
    setFromPdf(new Set(filled));
    return filled;
  };

  const importPdf = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPdfResult(null);
    setFromPdf(new Set());
    setPdfProgress('กำลังเปิดไฟล์...');
    const read = new AbortController();
    pdfRead.current = read;
    const collector = new ProjectDetailsCollector();
    let sawText = false;
    try {
      const { readPdfText } = await import('@/lib/read-pdf-text');
      await readPdfText(
        file,
        (lines, page, pages) => {
          sawText ||= lines.length > 0;
          collector.addPage(lines);
          setPdfProgress(`กำลังอ่านหน้า ${page.toLocaleString()} จาก ${pages.toLocaleString()}`);
          return collector.canStop;
        },
        read.signal,
      );
      const filled = applyPdfDetails(collector.details);
      if (filled.length > 0) {
        setPdfResult(`กรอกให้ ${filled.length} ช่อง: ${filled.map((f) => PROJECT_PDF_FIELD_LABELS[f]).join(', ')} กรุณาตรวจสอบก่อนกดสร้าง${collector.toneMarksGuessed ? ' (ไฟล์นี้เก็บวรรณยุกต์บางตัวไม่ครบ ระบบเติมให้ตามคำที่พบบ่อย โปรดตรวจการสะกดด้วย)' : ''}`);
      } else if (Object.keys(collector.details).length > 0) {
        setPdfResult('พบข้อมูลในไฟล์ แต่ช่องเหล่านั้นกรอกไว้แล้ว จึงไม่ได้เปลี่ยน');
      } else if (!read.signal.aborted) {
        setError(sawText ? 'ไม่พบข้อมูลโครงการในไฟล์นี้ กรุณากรอกเอง' : 'ไฟล์นี้ไม่มีข้อความให้อ่าน อาจเป็นไฟล์สแกน กรุณากรอกเอง');
      }
    } catch (err) {
      console.error(err);
      const password = err instanceof Error && err.message === 'PASSWORD';
      setError(password ? 'ไฟล์นี้ตั้งรหัสผ่านไว้ จึงอ่านไม่ได้' : 'เปิดไฟล์ไม่ได้ กรุณาตรวจสอบว่าเป็นไฟล์ PDF ที่สมบูรณ์');
    } finally {
      setPdfProgress(null);
      pdfRead.current = null;
    }
  };

  // Release the preview URL when it changes or the dialog closes
  useEffect(() => {
    if (!cover) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(cover);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  // Escape closes the dialog unless a save is running
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPending, onClose]);

  const pickFile = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError('รองรับเฉพาะไฟล์ JPG, PNG, WebP หรือ GIF');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('รูปโครงการต้องมีขนาดไม่เกิน 4 MB');
      return;
    }
    setCover(file);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.delete('cover');
    if (cover) formData.set('cover', cover);
    setError(null);
    startTransition(async () => {
      const result = await createProjectAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      router.push(`/projects/${result.id}`);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-project-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 sm:p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="absolute right-4 top-4 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          aria-label="ปิด"
        >
          <X className="w-4 h-4" />
        </button>

        <fieldset disabled={isPending} className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5">
          {/* Left: project details */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pr-8 lg:pr-0">
              <h2 id="create-project-title" className="text-base font-bold text-slate-900">
                ข้อมูลโครงการ
              </h2>
              <span className="text-[11px] text-[#2453d4]">* ข้อมูลที่จำเป็น</span>
            </div>

            <Field label="ชื่อโครงการ" htmlFor="cp-name" required fromPdf={fromPdf.has('name')}>
              <input
                id="cp-name"
                name="name"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น งานก่อสร้างอาคารสำนักงาน"
                className={controlClass}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="รหัสโครงการ" htmlFor="cp-code" fromPdf={fromPdf.has('code')}>
                <input
                  id="cp-code"
                  name="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="เว้นว่างเพื่อสร้างอัตโนมัติ"
                  className={`${controlClass} font-mono`}
                />
              </Field>
              <Field label="ลูกค้า" htmlFor="cp-client" fromPdf={fromPdf.has('clientName')}>
                <input id="cp-client" name="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="ชื่อลูกค้า" className={controlClass} />
              </Field>
              <Field label="กลุ่มโปรเจค" htmlFor="cp-group" fromPdf={fromPdf.has('projectGroup')}>
                <input
                  id="cp-group"
                  name="projectGroup"
                  value={projectGroup}
                  onChange={(e) => setProjectGroup(e.target.value)}
                  placeholder="เช่น โครงการภาคตะวันออก"
                  className={controlClass}
                />
              </Field>
              <Field label="สถานที่" htmlFor="cp-location" fromPdf={fromPdf.has('location')}>
                <input id="cp-location" name="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="ที่ตั้งโครงการ" className={controlClass} />
              </Field>
            </div>

            <h3 className="pt-2 text-base font-bold text-slate-900">งบประมาณและกำหนดการ</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="วันเริ่ม" htmlFor="cp-start" fromPdf={fromPdf.has('startDate')}>
                <DateInput
                  id="cp-start"
                  name="startDate"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={`${controlClass} font-mono`}
                />
              </Field>
              <Field label="วันสิ้นสุด" htmlFor="cp-end" fromPdf={fromPdf.has('endDate')}>
                <DateInput
                  id="cp-end"
                  name="endDate"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  className={`${controlClass} font-mono`}
                />
              </Field>
              <Field label="งบประมาณ" htmlFor="cp-budget" fromPdf={fromPdf.has('budget')}>
                <input
                  id="cp-budget"
                  name="budget"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  className={`${controlClass} font-mono`}
                />
              </Field>
              <Field label="สถานะ" htmlFor="cp-status" fromPdf={fromPdf.has('status')}>
                <select id="cp-status" name="status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className={controlClass}>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {/* Right: cover image */}
          <div className="space-y-3">
            <h2 className="text-base font-bold text-slate-900 lg:pr-8">รูปภาพโครงการ</h2>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pickFile(e.dataTransfer.files[0]);
              }}
              className="relative h-64 lg:h-[calc(100%-2.25rem)] min-h-56 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:border-[#2453d4] hover:bg-blue-50/40 transition cursor-pointer flex flex-col items-center justify-center text-center overflow-hidden"
            >
              {preview ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img src={preview} alt="ตัวอย่างรูปโครงการ" className="absolute inset-0 w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCover(null);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                    className="absolute top-2 right-2 px-2 py-1 rounded-md bg-white/90 text-xs text-slate-700 shadow"
                  >
                    ลบรูป
                  </button>
                </>
              ) : (
                <>
                  <span className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center text-[#2453d4] mb-3">
                    <ImagePlus className="w-5 h-5" />
                  </span>
                  <span className="text-sm font-semibold text-slate-800">อัปโหลดรูปภาพโครงการ</span>
                  <span className="text-[11px] text-slate-500 mt-1">รองรับ JPG, PNG, WebP หรือ GIF ไม่เกิน 4 MB</span>
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                name="cover"
                accept={ACCEPTED.join(',')}
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
          </div>
        </fieldset>

        <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col-reverse sm:flex-row sm:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={pdfInput}
              type="file"
              accept="application/pdf,.pdf"
              aria-label="เลือกไฟล์ PDF"
              className="hidden"
              onChange={(e) => {
                void importPdf(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {pdfProgress ? (
              <>
                <span role="status" className="text-xs text-slate-600">
                  {pdfProgress}
                </span>
                <button type="button" onClick={() => pdfRead.current?.abort()} className="text-xs font-semibold text-[#2453d4] hover:underline">
                  หยุด
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => pdfInput.current?.click()}
                disabled={isPending}
                title="ไฟล์ถูกอ่านในเครื่องนี้เท่านั้น ไม่มีการอัปโหลดหรือแก้ไขไฟล์"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <FileUp className="w-4 h-4" />
                นำเข้าข้อมูล PDF
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1 text-xs font-medium">
            {pdfResult && (
              <p role="status" className="text-emerald-700">
                {pdfResult}
              </p>
            )}
            {error && (
              <p role="alert" className="text-red-600">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-5 py-2 rounded-full border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isPending || name.trim() === ''}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#2453d4] hover:bg-[#1d44b8] text-white text-sm font-semibold shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              {isPending ? 'กำลังสร้าง...' : 'สร้างโครงการ'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
