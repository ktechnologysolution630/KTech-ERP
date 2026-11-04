'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Download, FileUp, History, Pencil, Plus, QrCode, Search } from 'lucide-react';
import { uploadFile } from '@/components/project-site/use-site-loader';
import {
  ASSET_CATEGORIES,
  ASSET_STATUS_LABELS,
  DEFAULT_INSPECT_EVERY_DAYS,
  hasProblem,
  INSPECTION_DUE_LABELS,
  INSPECTION_RESULT_LABELS,
  INSPECTION_RESULTS,
  needsInspection,
  type AssetStatus,
  type InspectionDue,
  type InspectionResult,
} from '@/domain/asset';
import { formatMoneyDisplay } from '@/domain/money';
import { formatThaiDate } from '@/domain/thai';
import type { AssetPage, AssetRow, InspectionRow } from '@/server/services/assets';
import { Dialog } from './asset-dialog';
import { loadInspectionsAction, recordInspectionAction, saveAssetAction } from './actions';

const LabelsDialog = dynamic(() => import('./asset-tools').then((m) => m.LabelsDialog), { ssr: false });
const ImportDialog = dynamic(() => import('./asset-tools').then((m) => m.ImportDialog), { ssr: false });

type ProjectOption = { id: string; label: string };
type View = 'ALL' | 'NEEDS_CHECK' | 'PROBLEM' | 'RETIRED';

const VIEW_LABELS: Record<View, string> = {
  ALL: 'ใช้งานทั้งหมด',
  NEEDS_CHECK: 'ต้องตรวจ',
  PROBLEM: 'มีปัญหา',
  RETIRED: 'ปลดระวาง',
};
const fieldClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#2453d4] focus:outline-hidden disabled:bg-slate-50';
const labelClass = 'mb-1 block font-medium text-slate-700';
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const dateText = (d: string | null) => (d ? formatThaiDate(d) : '-');

const DUE_CLASS: Record<InspectionDue, string> = {
  NEVER: 'text-rose-700',
  OVERDUE: 'text-rose-700',
  DUE_SOON: 'text-amber-700',
  OK: 'text-slate-500',
  RETIRED: 'text-slate-400',
};
const RESULT_CLASS: Record<InspectionResult, string> = {
  GOOD: 'bg-emerald-50 text-emerald-800',
  DAMAGED: 'bg-amber-50 text-amber-800',
  REPAIR: 'bg-blue-50 text-blue-800',
  MISSING: 'bg-rose-50 text-rose-800',
};

function AssetFormDialog({ asset, projects, onClose }: { asset: AssetRow | null; projects: ProjectOption[]; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: asset?.name ?? '',
    category: asset?.category ?? '',
    serialNo: asset?.serialNo ?? '',
    projectId: asset?.projectId ?? '',
    custodian: asset?.custodian ?? '',
    purchaseDate: asset?.purchaseDate ?? '',
    purchaseValue: String(asset?.purchaseValue ?? 0),
    salvageValue: String(asset?.salvageValue ?? 0),
    usefulLifeYears: asset?.usefulLifeYears ? String(asset.usefulLifeYears) : '',
    inspectEveryDays: String(asset?.inspectEveryDays ?? DEFAULT_INSPECT_EVERY_DAYS),
    status: (asset?.status ?? 'ACTIVE') as AssetStatus,
    note: asset?.note ?? '',
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await saveAssetAction(asset?.id ?? null, {
        ...form,
        projectId: form.projectId || null,
        purchaseDate: form.purchaseDate || null,
        purchaseValue: Number(form.purchaseValue),
        salvageValue: Number(form.salvageValue),
        usefulLifeYears: form.usefulLifeYears ? Number(form.usefulLifeYears) : null,
        inspectEveryDays: Number(form.inspectEveryDays),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog title={asset ? `แก้ไข ${asset.code}` : 'เพิ่มทรัพย์สิน'} onClose={onClose} busy={isPending}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={labelClass}>
            ชื่อทรัพย์สิน <span className="text-red-500">*</span>
          </span>
          <input required maxLength={300} value={form.name} onChange={set('name')} className={fieldClass} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>หมวด</span>
            <input list="asset-categories" maxLength={100} value={form.category} onChange={set('category')} className={fieldClass} />
            <datalist id="asset-categories">
              {ASSET_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className={labelClass}>หมายเลขเครื่อง / ทะเบียน</span>
            <input maxLength={100} value={form.serialNo} onChange={set('serialNo')} className={fieldClass} />
          </label>
          <label className="block">
            <span className={labelClass}>ที่อยู่ปัจจุบัน</span>
            <select value={form.projectId} onChange={set('projectId')} className={fieldClass}>
              <option value="">สำนักงาน</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>ผู้ดูแล</span>
            <input maxLength={200} value={form.custodian} onChange={set('custodian')} className={fieldClass} />
          </label>
          <label className="block">
            <span className={labelClass}>วันที่ซื้อ</span>
            <input type="date" value={form.purchaseDate} onChange={set('purchaseDate')} className={fieldClass} />
          </label>
          <label className="block">
            <span className={labelClass}>มูลค่า (บาท)</span>
            <input type="number" min={0} step="0.01" value={form.purchaseValue} onChange={set('purchaseValue')} className={`${fieldClass} font-mono`} />
          </label>
          <label className="block">
            <span className={labelClass}>มูลค่าซาก (บาท)</span>
            <input type="number" min={0} step="0.01" value={form.salvageValue} onChange={set('salvageValue')} className={`${fieldClass} font-mono`} />
          </label>
          <label className="block">
            <span className={labelClass}>อายุการใช้งาน (ปี)</span>
            <input type="number" min={1} max={100} step={1} value={form.usefulLifeYears} onChange={set('usefulLifeYears')} placeholder="ว่างไว้ถ้าไม่คิดค่าเสื่อม" className={`${fieldClass} font-mono`} />
          </label>
          <label className="block">
            <span className={labelClass}>รอบการตรวจ (วัน)</span>
            <input type="number" required min={1} max={3650} step={1} value={form.inspectEveryDays} onChange={set('inspectEveryDays')} className={`${fieldClass} font-mono`} />
          </label>
          {asset && (
            <label className="block">
              <span className={labelClass}>สถานะ</span>
              <select value={form.status} onChange={set('status')} className={fieldClass}>
                {(Object.keys(ASSET_STATUS_LABELS) as AssetStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {ASSET_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className="block">
          <span className={labelClass}>หมายเหตุ</span>
          <textarea rows={2} maxLength={1000} value={form.note} onChange={set('note')} className={fieldClass} />
        </label>
        {error && (
          <p role="alert" className="font-medium text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="submit" disabled={isPending} className="rounded-lg bg-[#2453d4] px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function InspectDialog({ asset, today, onClose }: { asset: AssetRow; today: string; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inspectedOn, setInspectedOn] = useState(today);
  const [result, setResult] = useState<InspectionResult>('GOOD');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const noteRequired = result !== 'GOOD';

  const pickPhotos = (files: FileList | null) => {
    const list = [...(files ?? [])];
    const tooBig = list.find((f) => f.size > MAX_PHOTO_BYTES);
    if (tooBig) {
      setError(`${tooBig.name}: ขนาดไฟล์ต้องไม่เกิน 10 MB`);
      return;
    }
    setError(null);
    setPhotos(list);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // Kept after a failed upload, so trying again sends the photos without recording a second check
      let inspectionId = savedId;
      if (!inspectionId) {
        const r = await recordInspectionAction(asset.id, { inspectedOn, result, note });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        inspectionId = r.value.id;
        setSavedId(inspectionId);
      }
      for (const [i, file] of photos.entries()) {
        const failure = await uploadFile({ entityType: 'ASSET_INSPECTION', entityId: inspectionId, file, kind: 'PHOTO' });
        if (failure) {
          setPhotos(photos.slice(i));
          setError(`บันทึกผลตรวจแล้ว แต่ส่งรูป ${file.name} ไม่สำเร็จ: ${failure}`);
          return;
        }
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog title={`ตรวจเช็ค ${asset.code} ${asset.name}`} onClose={onClose} busy={isPending}>
      <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={savedId !== null} className="space-y-3">
          <label className="block">
            <span className={labelClass}>วันที่ตรวจ</span>
            <input type="date" required max={today} value={inspectedOn} onChange={(e) => setInspectedOn(e.target.value)} className={fieldClass} />
          </label>
          <div>
            <span className={labelClass}>สภาพที่พบ</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {INSPECTION_RESULTS.map((r) => (
                <label key={r} className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 font-semibold focus-within:ring-2 focus-within:ring-[#2453d4] ${result === r ? `border-current ${RESULT_CLASS[r]}` : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  <input type="radio" name="inspection-result" value={r} checked={result === r} onChange={() => setResult(r)} className="sr-only" />
                  {INSPECTION_RESULT_LABELS[r]}
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={labelClass}>
              รายละเอียด {noteRequired && <span className="text-red-500">*</span>}
            </span>
            <textarea rows={3} maxLength={1000} required={noteRequired} value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
          </label>
        </fieldset>
        <label className="block">
          <span className={labelClass}>รูปถ่าย (ถ้ามี)</span>
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => pickPhotos(e.target.files)} className={fieldClass} />
          {photos.length > 0 && <span className="mt-1 block text-slate-500">เลือกแล้ว {photos.length} รูป</span>}
        </label>
        {error && (
          <p role="alert" className="font-medium text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (savedId) router.refresh();
              onClose();
            }}
            disabled={isPending}
            className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50"
          >
            {savedId ? 'ปิด' : 'ยกเลิก'}
          </button>
          <button type="submit" disabled={isPending} className="rounded-lg bg-[#2453d4] px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {isPending ? 'กำลังบันทึก...' : savedId ? 'ส่งรูปอีกครั้ง' : 'บันทึกผลตรวจ'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function HistoryDialog({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const [rows, setRows] = useState<InspectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void loadInspectionsAction(asset.id).then((r) => {
      if (!current) return;
      if (r.ok) setRows(r.value);
      else setError(r.error);
    });
    return () => {
      current = false;
    };
  }, [asset.id]);

  return (
    <Dialog title={`ประวัติการตรวจ ${asset.code} ${asset.name}`} onClose={onClose}>
      {error ? (
        <p role="alert" className="font-medium text-red-600">
          {error}
        </p>
      ) : !rows ? (
        <p className="py-8 text-center text-slate-500">กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-slate-500">ยังไม่เคยตรวจเช็ค</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{dateText(r.inspectedOn)}</span>
                <span className={`rounded-full px-2 py-0.5 font-semibold ${RESULT_CLASS[r.result]}`}>{INSPECTION_RESULT_LABELS[r.result]}</span>
              </div>
              {r.note && <p className="whitespace-pre-wrap text-slate-700">{r.note}</p>}
              <p className="text-[11px] text-slate-500">ผู้ตรวจ: {r.inspectorName}</p>
              {r.photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {r.photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.name} loading="lazy" className="aspect-[4/3] w-full rounded border border-slate-200 object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function Tile({ label, value, active, tone, onClick }: { label: string; value: number; active: boolean; tone: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-xl border bg-white p-4 text-left shadow-xs transition hover:border-slate-300 ${active ? 'border-[#2453d4] ring-1 ring-[#2453d4]' : 'border-slate-200'}`}
    >
      <div className={`text-xs font-semibold ${tone}`}>{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{value}</div>
    </button>
  );
}

export function AssetsClient({
  page,
  projects,
  linkedAssetId,
  startOnNeedsCheck,
}: {
  page: AssetPage;
  projects: ProjectOption[];
  /** From a scanned label or a notification: goes straight to that asset */
  linkedAssetId: string | null;
  startOnNeedsCheck: boolean;
}) {
  const { rows, canManage, canSeeValue, today } = page;
  const linked = linkedAssetId ? rows.find((r) => r.id === linkedAssetId) : undefined;
  const [view, setView] = useState<View>(startOnNeedsCheck ? 'NEEDS_CHECK' : 'ALL');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('ALL');
  const [editing, setEditing] = useState<AssetRow | 'new' | null>(null);
  const [inspecting, setInspecting] = useState<AssetRow | null>(linked?.canInspect ? linked : null);
  const [history, setHistory] = useState<AssetRow | null>(linked && !linked.canInspect ? linked : null);
  const [linkMissing, setLinkMissing] = useState(linkedAssetId !== null && !linked);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [printing, setPrinting] = useState<AssetRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    // Reloading after a check must not reopen the form for the asset that was just scanned
    if (linkedAssetId || startOnNeedsCheck) window.history.replaceState(null, '', '/assets');
  }, [linkedAssetId, startOnNeedsCheck]);

  const active = useMemo(() => rows.filter((r) => r.status === 'ACTIVE'), [rows]);
  const counts: Record<View, number> = {
    ALL: active.length,
    NEEDS_CHECK: active.filter((r) => needsInspection(r.due)).length,
    PROBLEM: active.filter((r) => hasProblem(r.status, r.lastResult)).length,
    RETIRED: rows.length - active.length,
  };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const inView =
        view === 'RETIRED'
          ? r.status === 'RETIRED'
          : r.status === 'ACTIVE' && (view === 'ALL' || (view === 'NEEDS_CHECK' ? needsInspection(r.due) : hasProblem(r.status, r.lastResult)));
      const here = location === 'ALL' || (location === 'OFFICE' ? r.projectId === null : r.projectId === location);
      return inView && here && (!q || [r.code, r.name, r.category, r.serialNo, r.custodian].some((t) => t.toLowerCase().includes(q)));
    });
  }, [rows, view, location, query]);

  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const toggleShown = () => setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const labelTargets = selected.size > 0 ? rows.filter((r) => selected.has(r.id)) : shown;

  const exportShown = async () => {
    setExportError(null);
    try {
      const { exportDepreciation } = await import('./asset-tools');
      await exportDepreciation(shown, today);
    } catch (err) {
      console.error(err);
      setExportError('สร้างไฟล์ Excel ไม่สำเร็จ กรุณาลองใหม่');
    }
  };

  return (
    <div className="space-y-4 font-sans text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">ตรวจเช็คทรัพย์สิน</h1>
          <p className="mt-0.5 text-xs text-slate-500">ทะเบียนทรัพย์สิน กำหนดตรวจ และผลการตรวจเช็คแต่ละครั้ง</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <FileUp className="h-4 w-4" /> นำเข้าจาก Excel
            </button>
            <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> เพิ่มทรัพย์สิน
            </button>
          </div>
        )}
      </div>

      {linkMissing && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          ไม่พบทรัพย์สินจากลิงก์นี้ หรือคุณไม่มีสิทธิ์ดูทรัพย์สินชิ้นนี้
          <button type="button" onClick={() => setLinkMissing(false)} className="shrink-0 underline">
            ปิด
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={VIEW_LABELS.ALL} value={counts.ALL} active={view === 'ALL'} tone="text-[#2453d4]" onClick={() => setView('ALL')} />
        <Tile label={VIEW_LABELS.NEEDS_CHECK} value={counts.NEEDS_CHECK} active={view === 'NEEDS_CHECK'} tone="text-amber-700" onClick={() => setView('NEEDS_CHECK')} />
        <Tile label={VIEW_LABELS.PROBLEM} value={counts.PROBLEM} active={view === 'PROBLEM'} tone="text-rose-700" onClick={() => setView('PROBLEM')} />
        <Tile label={VIEW_LABELS.RETIRED} value={counts.RETIRED} active={view === 'RETIRED'} tone="text-slate-500" onClick={() => setView('RETIRED')} />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center gap-2 p-4">
          <label className="relative">
            <span className="sr-only">ค้นหา</span>
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหารหัส ชื่อ หมายเลข ผู้ดูแล..." className={`${fieldClass} w-64 pl-8`} />
          </label>
          <label>
            <span className="sr-only">ที่อยู่</span>
            <select value={location} onChange={(e) => setLocation(e.target.value)} className={`${fieldClass} w-64`}>
              <option value="ALL">ทุกที่อยู่</option>
              <option value="OFFICE">สำนักงาน</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">{shown.length} รายการ</span>
            <button type="button" disabled={labelTargets.length === 0} onClick={() => setPrinting(labelTargets)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <QrCode className="h-4 w-4" /> พิมพ์ QR ({labelTargets.length})
            </button>
            {canSeeValue && (
              <button type="button" disabled={shown.length === 0} onClick={() => void exportShown()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <Download className="h-4 w-4" /> ส่งออกค่าเสื่อม
              </button>
            )}
          </div>
          {exportError && (
            <p role="alert" className="w-full text-right text-xs font-medium text-red-600">
              {exportError}
            </p>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="py-14 text-center text-xs text-slate-500">
            {rows.length === 0 ? (canManage ? 'ยังไม่มีทรัพย์สิน กด "เพิ่มทรัพย์สิน" เพื่อเริ่มต้น' : 'ยังไม่มีทรัพย์สินที่คุณดูแล') : 'ไม่พบทรัพย์สินที่ตรงกับตัวกรอง'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full text-xs ${canSeeValue ? 'min-w-[1120px]' : 'min-w-[960px]'}`}>
              <thead className="bg-[#102d72] text-white">
                <tr>
                  <th className="w-8 py-2.5 pl-4">
                    <input type="checkbox" checked={allShownSelected} onChange={toggleShown} aria-label="เลือกทั้งหมดที่แสดง" className="align-middle" />
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">ทรัพย์สิน</th>
                  <th className="px-3 py-2.5 text-left font-medium">ที่อยู่ / ผู้ดูแล</th>
                  <th className="px-3 py-2.5 text-left font-medium">สภาพล่าสุด</th>
                  <th className="px-3 py-2.5 text-left font-medium">ตรวจล่าสุด</th>
                  <th className="px-3 py-2.5 text-left font-medium">ตรวจครั้งถัดไป</th>
                  {canSeeValue && <th className="px-3 py-2.5 text-right font-medium">มูลค่าตามบัญชี</th>}
                  <th className="px-4 py-2.5 text-right font-medium">ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="py-3 pl-4">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`เลือก ${r.code}`} className="align-middle" />
                    </td>
                    <td className="max-w-[280px] px-3 py-3">
                      <div className="truncate font-semibold text-slate-900" title={r.name}>
                        {r.name}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        <span className="font-mono">{r.code}</span>
                        {r.category && ` · ${r.category}`}
                        {r.serialNo && ` · ${r.serialNo}`}
                      </div>
                    </td>
                    <td className="max-w-[240px] px-3 py-3">
                      <div className="truncate text-slate-700" title={r.projectName ?? 'สำนักงาน'}>
                        {r.projectName ?? 'สำนักงาน'}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">{r.custodian || '-'}</div>
                    </td>
                    <td className="px-3 py-3">
                      {r.lastResult ? <span className={`rounded-full px-2 py-0.5 font-semibold ${RESULT_CLASS[r.lastResult]}`}>{INSPECTION_RESULT_LABELS[r.lastResult]}</span> : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">{dateText(r.lastInspectedOn)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <div className="text-slate-700">{dateText(r.nextDueOn)}</div>
                      <div className={`mt-0.5 text-[11px] font-medium ${DUE_CLASS[r.due]}`}>{INSPECTION_DUE_LABELS[r.due]}</div>
                    </td>
                    {canSeeValue && (
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        {r.depreciation ? (
                          <>
                            <div className="font-mono text-slate-900">{formatMoneyDisplay(r.depreciation.bookValue)}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500">{r.depreciation.fullyDepreciated ? 'หมดอายุการใช้งานแล้ว' : `สะสม ${formatMoneyDisplay(r.depreciation.accumulated)}`}</div>
                          </>
                        ) : (
                          <span className="text-slate-400" title="ยังไม่ได้กำหนดอายุการใช้งาน">
                            -
                          </span>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {r.canInspect && (
                        <button type="button" onClick={() => setInspecting(r)} className="inline-flex items-center gap-1 rounded-md bg-[#2453d4] px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700">
                          <ClipboardCheck className="h-3.5 w-3.5" /> ตรวจเช็ค
                        </button>
                      )}
                      <button type="button" onClick={() => setHistory(r)} className="ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#2453d4]" title="ประวัติการตรวจ" aria-label={`ประวัติการตรวจ ${r.code}`}>
                        <History className="h-4 w-4" />
                      </button>
                      {canManage && (
                        <button type="button" onClick={() => setEditing(r)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#2453d4]" title="แก้ไข" aria-label={`แก้ไข ${r.code}`}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && <AssetFormDialog asset={editing === 'new' ? null : editing} projects={projects} onClose={() => setEditing(null)} />}
      {inspecting && <InspectDialog asset={inspecting} today={today} onClose={() => setInspecting(null)} />}
      {history && <HistoryDialog asset={history} onClose={() => setHistory(null)} />}
      {printing && <LabelsDialog assets={printing} onClose={() => setPrinting(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
