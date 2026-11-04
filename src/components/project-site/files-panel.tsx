'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Download, Eye, FileText, Folder, ImagePlus, Search, Trash2, Upload, X } from 'lucide-react';
import { deleteFileAction, loadFilesAction } from '@/app/(app)/projects/[id]/site-actions';
import { DocumentViewer } from './document-viewer';
import { fileSize, uploadFile, useSiteLoader } from './use-site-loader';

const DOCUMENT_FOLDERS = [
  'เอกสารก่อนเริ่มโครงการ',
  'แบบก่อสร้าง',
  'เอกสารระหว่างดำเนินงาน',
  'เอกสารตรวจงาน',
  'เอกสารอนุมัติ',
  'เอกสารการเงิน',
  'เอกสารส่งมอบและปิดโครงการ',
];
const MAX_BYTES = 10 * 1024 * 1024;
const dateText = (d: Date | string) => new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });

/** Project documents (kind FILE, folders + versions) or photos (kind PHOTO, albums). */
export function FilesPanel({ projectId, kind, me }: { projectId: string; kind: 'FILE' | 'PHOTO'; me: string }) {
  const { data, error, reload } = useSiteLoader(() => loadFilesAction(projectId, kind), [projectId, kind]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState(kind === 'FILE' ? DOCUMENT_FOLDERS[0] : 'ทั่วไป');
  const [filterFolder, setFilterFolder] = useState('ALL');
  const [q, setQ] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ name: string; url: string } | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);

  const isPhoto = kind === 'PHOTO';
  const albums = isPhoto ? [...new Set((data ?? []).map((f) => f.folder || 'ทั่วไป'))] : DOCUMENT_FOLDERS;

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setActionError(null);
    const list = [...files];
    for (const [i, file] of list.entries()) {
      if (file.size > MAX_BYTES) {
        setActionError(`${file.name}: ขนาดไฟล์ต้องไม่เกิน 10 MB`);
        continue;
      }
      setBusy(`กำลังอัปโหลด ${i + 1}/${list.length}...`);
      const err = await uploadFile({ entityType: 'PROJECT', entityId: projectId, file, kind, folder: folder.trim() || 'ทั่วไป' });
      if (err) setActionError(`${file.name}: ${err}`);
    }
    setBusy(null);
    await reload();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`ลบ ${name}?`)) return;
    const r = await deleteFileAction(id);
    if (!r.ok) setActionError(r.error);
    await reload();
  };

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <p className="p-8 text-center text-xs text-slate-400">กำลังโหลด...</p>;

  const query = q.trim().toLowerCase();
  const shown = data.filter(
    (f) =>
      (showOld || f.latest) &&
      (filterFolder === 'ALL' || (f.folder || 'ทั่วไป') === filterFolder) &&
      (!query || f.name.toLowerCase().includes(query)),
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-slate-900">{isPhoto ? 'อัลบั้มรูปโครงการ' : 'เอกสารโครงการ'}</h3>
          <p className="text-[11px] text-slate-500">
            {isPhoto ? 'รูปถ่ายหน้างานแยกตามอัลบั้ม' : 'อัปโหลดชื่อไฟล์เดิมในหมวดเดิม = เวอร์ชันใหม่ของเอกสาร'} · ไม่เกิน 10 MB ต่อไฟล์
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="block">
            <span className="block text-[11px] text-slate-500 mb-0.5">{isPhoto ? 'อัลบั้ม' : 'หมวดเอกสาร'}</span>
            {isPhoto ? (
              <>
                <input list="photo-albums" value={folder} onChange={(e) => setFolder(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 w-44" />
                <datalist id="photo-albums">
                  {albums.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </>
            ) : (
              <select value={folder} onChange={(e) => setFolder(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white">
                {DOCUMENT_FOLDERS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            )}
          </label>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2453d4] text-white font-semibold disabled:opacity-60"
          >
            {isPhoto ? <ImagePlus className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
            {busy ?? (isPhoto ? 'อัปโหลดรูป' : 'อัปโหลดเอกสาร')}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={isPhoto ? 'image/jpeg,image/png,image/webp,image/gif' : undefined}
            className="hidden"
            aria-label={isPhoto ? 'เลือกรูปภาพ' : 'เลือกไฟล์เอกสาร'}
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาไฟล์..." className="pl-8 pr-2 py-1.5 rounded-lg border border-slate-200 w-56" />
        </div>
        <select value={filterFolder} onChange={(e) => setFilterFolder(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white">
          <option value="ALL">{isPhoto ? 'ทุกอัลบั้ม' : 'ทุกหมวด'}</option>
          {albums.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        {!isPhoto && (
          <label className="inline-flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> แสดงเวอร์ชันเก่า
          </label>
        )}
      </div>
      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}

      {shown.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          {isPhoto ? <ImagePlus className="w-8 h-8 mx-auto mb-2 text-slate-300" /> : <Folder className="w-8 h-8 mx-auto mb-2 text-slate-300" />}
          {data.length === 0 ? (isPhoto ? 'ยังไม่มีรูปภาพ' : 'ยังไม่มีเอกสาร') : 'ไม่พบไฟล์ที่ตรงกับตัวกรอง'}
        </div>
      ) : isPhoto ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {shown.map((p) => (
            <figure key={p.id} className="group relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              <button type="button" onClick={() => setPreview(p.url)} className="block w-full aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
              </button>
              <figcaption className="px-2 py-1 text-[10px] text-slate-500 truncate">
                {p.folder || 'ทั่วไป'} · {dateText(p.createdAt)} · {p.uploaderName}
              </figcaption>
              {p.uploadedBy === me && (
                <button type="button" onClick={() => void remove(p.id, p.name)} className="absolute top-1 right-1 p-1 rounded bg-white/90 text-slate-500 hover:text-red-600 opacity-0 group-hover:opacity-100" title="ลบรูป">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">ชื่อเอกสาร</th>
                <th className="px-3 py-2 text-left">หมวด</th>
                <th className="px-3 py-2 text-center">Version</th>
                <th className="px-3 py-2 text-right">ขนาด</th>
                <th className="px-3 py-2 text-left">ผู้อัปโหลด</th>
                <th className="px-3 py-2 text-left">อัปเดต</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((f) => (
                <tr key={f.id} className={f.latest ? '' : 'text-slate-400'}>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      {f.name}
                    </span>
                  </td>
                  <td className="px-3 py-2">{f.folder || '-'}</td>
                  <td className="px-3 py-2 text-center">v{f.version}</td>
                  <td className="px-3 py-2 text-right">{fileSize(f.size)}</td>
                  <td className="px-3 py-2">{f.uploaderName}</td>
                  <td className="px-3 py-2">{dateText(f.createdAt)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button type="button" onClick={() => setViewing({ name: f.name, url: f.url })} className="p-1 rounded text-slate-500 hover:text-[#2453d4]" title="ดูเอกสาร" aria-label={`ดูเอกสาร ${f.name}`}>
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <a href={f.url} download={f.name} className="inline-flex p-1 rounded text-slate-500 hover:text-[#2453d4]" title="ดาวน์โหลด" aria-label={`ดาวน์โหลด ${f.name}`}>
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button type="button" onClick={() => void remove(f.id, f.name)} className="p-1 rounded text-slate-400 hover:text-red-600" title="ลบ" aria-label={`ลบ ${f.name}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <DocumentViewer name={viewing.name} url={viewing.url} onClose={closeViewer} />}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)} role="dialog" aria-label="ดูรูป">
          <button type="button" className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white" title="ปิด">
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
