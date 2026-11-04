'use client';

import React, { useRef, useState, useTransition } from 'react';
import { Check, ImagePlus, Trash2, X } from 'lucide-react';
import { PROJECT_COVER_PRESETS } from '@/domain/project';
import { setProjectCoverAction } from '@/app/(app)/projects/[id]/actions';

/** Keep in step with MAX_COVER_BYTES in the master service */
const MAX_COVER_BYTES = 4 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const COVER_FILE_TYPES = ACCEPTED_TYPES.join(',');
export const thumbUrl = (url: string) => url.replace('w=1200', 'w=400');

/** Saves a project's cover from an uploaded file, a preset or removal; `onSaved` gets the new URL, or null when removed. */
export function useProjectCover(projectId: string, onSaved: (url: string | null) => void) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (form: FormData) => {
    setError(null);
    startTransition(async () => {
      const r = await setProjectCoverAction(projectId, form);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onSaved(r.url || null);
    });
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    // Checked here too so a large photo fails fast instead of after a slow upload
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('รูปโครงการต้องเป็นไฟล์ JPG, PNG, WebP หรือ GIF');
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      setError('รูปโครงการต้องมีขนาดไม่เกิน 4 MB');
      return;
    }
    const form = new FormData();
    form.set('file', file);
    save(form);
  };

  const choosePreset = (url: string) => {
    const form = new FormData();
    form.set('preset', url);
    save(form);
  };

  const remove = () => {
    const form = new FormData();
    form.set('remove', '1');
    save(form);
  };

  return { isPending, error, upload, choosePreset, remove };
}

export function ProjectCoverPicker({
  projectId,
  current,
  onClose,
  onChanged,
}: {
  projectId: string;
  current: string | null;
  onClose: () => void;
  /** Receives the saved cover URL, or null when the cover was removed */
  onChanged: (url: string | null) => void;
}) {
  const { isPending, error, upload, choosePreset, remove } = useProjectCover(projectId, (url) => {
    onChanged(url);
    onClose();
  });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="เพิ่มรูปโครงการ"
      onMouseDown={(e) => e.target === e.currentTarget && !isPending && onClose()}
    >
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <h3 className="font-bold text-sm text-slate-900">เพิ่มรูปโครงการ</h3>
          <button type="button" onClick={onClose} disabled={isPending} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <button
            type="button"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              upload(e.dataTransfer.files[0]);
            }}
            className={`w-full flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 transition disabled:opacity-60 ${
              dragOver ? 'border-[#2453d4] bg-blue-50' : 'border-slate-300 hover:border-[#2453d4] hover:bg-slate-50'
            }`}
          >
            <ImagePlus className="w-6 h-6 text-[#2453d4]" />
            <span className="font-semibold text-[#2453d4]">{isPending ? 'กำลังบันทึก...' : 'อัปโหลดรูปจากเครื่อง'}</span>
            <span className="text-[11px] text-slate-400">คลิกหรือลากไฟล์มาวาง · JPG, PNG, WebP, GIF ไม่เกิน 4 MB</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={COVER_FILE_TYPES}
            className="hidden"
            aria-label="เลือกไฟล์รูปโครงการ"
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          <p className="text-slate-500">หรือเลือกภาพไซต์งานก่อสร้างตัวอย่าง</p>
          <div className="grid grid-cols-3 gap-2">
            {PROJECT_COVER_PRESETS.map((url) => (
              <button
                key={url}
                type="button"
                disabled={isPending}
                onClick={() => choosePreset(url)}
                className={`relative h-20 rounded-lg overflow-hidden border-2 transition disabled:opacity-60 ${
                  current === url ? 'border-[#2453d4]' : 'border-transparent hover:border-blue-300'
                }`}
                title="ใช้รูปนี้"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(url)} alt="รูปไซต์งานตัวอย่าง" className="w-full h-full object-cover" />
                {current === url && (
                  <span className="absolute top-1 right-1 rounded-full bg-[#2453d4] p-0.5 text-white">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="text-red-600 font-medium">
              {error}
            </p>
          )}

          {current && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={isPending}
                onClick={remove}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" /> ลบรูปโครงการ
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
