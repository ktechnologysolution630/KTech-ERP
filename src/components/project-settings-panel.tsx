'use client';

import React, { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Trash2, Upload, X } from 'lucide-react';
import { deleteProjectAction, previewProjectDeletionAction } from '@/app/(app)/projects/[id]/actions';
import { ProjectDetailsForm } from '@/components/project-details-form';
import { COVER_FILE_TYPES, thumbUrl, useProjectCover } from '@/components/project-cover-picker';
import { PROJECT_COVER_PRESETS } from '@/domain/project';
import type { ProjectDetailDto } from '@/server/services/master';
import type { ProjectDeletionPreview } from '@/server/services/project-delete';

const UPLOADED = 'uploaded';

function CoverSettings({ project, current, onChanged }: { project: ProjectDetailDto; current: string | null; onChanged: (url: string | null) => void }) {
  const { isPending, error, upload, choosePreset } = useProjectCover(project.id, onChanged);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = current || PROJECT_COVER_PRESETS[0]!;
  const isPreset = PROJECT_COVER_PRESETS.includes(shown);
  const locked = !project.canEdit || isPending;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-base font-bold text-slate-900">พื้นหลังการ์ดหัวโครงการ</h3>
        <p className="text-xs text-slate-500">เลือกรูปพื้นหลังสำหรับหัวโครงการ</p>
      </div>
      <div className="space-y-3 p-5 text-xs">
        <div>
          <label htmlFor="cover-select" className="mb-1 block font-medium text-slate-700">รูปพื้นหลัง</label>
          <select
            id="cover-select"
            disabled={locked}
            value={isPreset ? shown : UPLOADED}
            onChange={(e) => choosePreset(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 focus:border-[#2453d4] focus:outline-hidden disabled:bg-slate-50"
          >
            {!isPreset && <option value={UPLOADED} disabled>รูปที่อัปโหลดเอง</option>}
            {PROJECT_COVER_PRESETS.map((url, i) => (
              <option key={url} value={url}>ภาพที่ {i + 1}</option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <button
            type="button"
            disabled={locked}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" /> {isPending ? 'กำลังบันทึก...' : 'อัปโหลดรูปเอง'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={COVER_FILE_TYPES}
            className="hidden"
            aria-label="เลือกไฟล์รูปพื้นหลัง"
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <p className="mt-2 text-[11px] text-slate-500">รองรับ JPG, PNG, WebP และ GIF ขนาดไม่เกิน 4 MB</p>
        </div>

        {error && (
          <p role="alert" className="font-medium text-red-600">
            {error}
          </p>
        )}

        <div className="relative aspect-[5/2] overflow-hidden rounded-lg border border-slate-200 bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent p-3 text-white">
            <span className="font-mono text-[10px] opacity-90">{project.code}</span>
            <span className="truncate text-sm font-bold">{project.name}</span>
            {project.location && <span className="truncate text-[11px] opacity-90">{project.location}</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PROJECT_COVER_PRESETS.map((url, i) => (
            <button
              key={url}
              type="button"
              disabled={locked}
              aria-pressed={shown === url}
              aria-label={`ใช้ภาพที่ ${i + 1}`}
              onClick={() => choosePreset(url)}
              className={`relative aspect-[2/1] overflow-hidden rounded-lg border-2 transition disabled:opacity-60 ${shown === url ? 'border-[#2453d4]' : 'border-transparent hover:border-blue-300'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(url)} alt="" loading="lazy" className="h-full w-full object-cover" />
              <span className="absolute bottom-1 left-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">ภาพที่ {i + 1}</span>
              {shown === url && (
                <span className="absolute right-1 top-1 rounded-full bg-[#2453d4] p-0.5 text-white">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function DeleteProject({ project }: { project: ProjectDetailDto }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectDeletionPreview | null>(null);
  const [isPending, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setTyped('');
    setError(null);
    setPreview(null);
  };
  const openDialog = () => {
    setOpen(true);
    startTransition(async () => {
      const r = await previewProjectDeletionAction(project.id);
      if (r.ok) setPreview(r.preview);
      else setError(r.error);
    });
  };
  const confirmDelete = () => {
    setError(null);
    startTransition(async () => {
      const r = await deleteProjectAction(project.id, typed);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push('/projects');
    });
  };
  const blocked = (preview?.blockers.length ?? 0) > 0;

  return (
    <>
      <button type="button" onClick={openDialog} className="inline-flex items-center gap-1.5 font-semibold text-red-600 hover:text-red-700">
        <Trash2 className="h-3.5 w-3.5" /> ลบโครงการ
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="ลบโครงการ"
          onMouseDown={(e) => e.target === e.currentTarget && !isPending && close()}
        >
          <div className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 text-xs shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">ลบโครงการ</h3>
              <button type="button" onClick={close} disabled={isPending} className="text-slate-400 hover:text-slate-600" title="ปิด">
                <X className="h-4 w-4" />
              </button>
            </div>
            {!preview && !error && <p className="text-slate-500">กำลังตรวจสอบข้อมูลของโครงการ...</p>}
            {preview && (
              <>
                {preview.items.length > 0 ? (
                  <div>
                    <p className="font-semibold text-slate-800">ข้อมูลเหล่านี้จะถูกลบถาวร และกู้คืนไม่ได้</p>
                    <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-600">
                      {preview.items.map((i) => (
                        <li key={i.label} className="flex justify-between gap-2">
                          <span>{i.label}</span>
                          <span className="font-semibold tabular-nums text-slate-900">{i.count.toLocaleString('th-TH')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-slate-600">โครงการนี้ยังไม่มีข้อมูลงานหรือเอกสาร การลบจะกู้คืนไม่ได้</p>
                )}
                {preview.taxRecords.length > 0 && (
                  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
                    <p className="font-bold">เอกสารบัญชีและภาษีจะหายไปด้วย</p>
                    <ul className="mt-1 list-disc pl-4">
                      {preview.taxRecords.map((t) => (
                        <li key={t.label}>
                          {t.label} {t.count.toLocaleString('th-TH')} ใบ
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5">
                      ธุรกิจต้องเก็บเอกสารเหล่านี้ไว้ตามกฎหมาย และรายงานภาษีย้อนหลังจะเปลี่ยนไป ควรปรึกษาฝ่ายบัญชีก่อน หากเพียงเลิกใช้งานโครงการ ให้เปลี่ยนสถานะเป็น &quot;ยกเลิก&quot; แทน
                    </p>
                  </div>
                )}
                {preview.stockBalancesLeft > 0 && <p className="text-amber-700">ยอดสต็อกคงเหลือในโครงการนี้ {preview.stockBalancesLeft.toLocaleString('th-TH')} รายการจะหายไป หากของยังอยู่ให้โอนออกก่อน</p>}
                {preview.assetsToOffice > 0 && <p className="text-slate-600">ทรัพย์สิน {preview.assetsToOffice.toLocaleString('th-TH')} รายการจะไม่ถูกลบ แต่ย้ายกลับไปอยู่ที่สำนักงาน</p>}
                {blocked ? (
                  <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    <p className="font-bold">ยังลบไม่ได้ เพราะกระทบข้อมูลของโครงการอื่น</p>
                    <ul className="mt-1 list-disc pl-4">
                      {preview.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <>
                    <p className="text-slate-600">
                      พิมพ์รหัส <span className="font-mono font-semibold text-slate-900">{project.code}</span> เพื่อยืนยัน
                    </p>
                    <input
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      aria-label="พิมพ์รหัสโครงการเพื่อยืนยัน"
                      autoFocus
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono focus:border-red-500 focus:outline-hidden"
                    />
                  </>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="font-medium text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={isPending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isPending || !preview || blocked || typed.trim() !== project.code}
                onClick={confirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? 'กำลังลบ...' : 'ลบโครงการ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The project's "ตั้งค่า" tab: its details on the left, the header background on the right. */
export function ProjectSettingsPanel({
  project,
  users,
  customers,
  cover,
  onCoverChanged,
}: {
  project: ProjectDetailDto;
  users: { id: string; name: string }[];
  customers: { id: string; code: string; name: string }[];
  cover: string | null;
  onCoverChanged: (url: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">ตั้งค่าโครงการ</h3>
          <p className="text-xs text-slate-500">Project settings</p>
        </div>
        <div className="p-5">
          <ProjectDetailsForm project={project} users={users} customers={customers} showReset footerStart={project.canDelete ? <DeleteProject project={project} /> : undefined} />
        </div>
      </section>
      <CoverSettings project={project} current={cover} onChanged={onCoverChanged} />
    </div>
  );
}
