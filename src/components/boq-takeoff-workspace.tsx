'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  AlertCircle,
  ArrowLeft,
  Box,
  BadgeDollarSign,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FileBox,
  FileSpreadsheet,
  FileUp,
  Hand,
  Layers,
  Maximize,
  MousePointer2,
  Pencil,
  Plus,
  Ruler,
  Save,
  ScanLine,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  COMMON_RATIOS,
  ITEM_COLORS,
  defaultUnitOf,
  groupByCategory,
  itemAmount,
  isOutlineKind,
  itemQuantity,
  kindLabel,
  measuredValue,
  polygonArea,
  scaleFromCalibration,
  scaleFromRatio,
  TAKEOFF_KINDS,
  type Measurement,
  type Point,
  type TakeoffData,
  type TakeoffItem,
  type TakeoffKind,
} from '@/domain/boq-takeoff';
import { BOQ_SHEET_COLUMNS } from '@/domain/boq-import';
import { STOCK_CATEGORIES } from '@/domain/stock';
import { toBoqLines } from '@/domain/boq-takeoff';
import type { TakeoffDocumentDto } from '@/server/services/boq-takeoff';
import { saveTakeoffAction, sendTakeoffToBoqAction } from '@/app/(app)/boq-takeoff/actions';
import { cacheTakeoffFile, readCachedTakeoffFile } from '@/lib/takeoff-file-cache';
import { SearchSelect } from '@/components/search-select';
import { AiTakeoffDialog, type AiPickedItem } from '@/components/boq-ai-takeoff-dialog';
import { AutoTakeoffDialog, type AutoPickedGroup } from '@/components/boq-auto-takeoff-dialog';
import { ElementDialog } from '@/components/boq-element-dialog';
import { ArchicadDialog, type ArchicadPickedItem } from '@/components/boq-archicad-dialog';
import { IfcImportDialog } from '@/components/boq-ifc-import-dialog';
import { CadImportDialog, type CadPickedItem } from '@/components/boq-cad-import-dialog';
import { PricingDialog, withPriceNote, type PriceUpdate } from '@/components/boq-pricing-dialog';
import { groupToMeasurements } from '@/domain/vector-takeoff';

type Tool = 'select' | 'pan' | 'measure' | 'calibrate';

interface ProjectOption {
  id: string;
  label: string;
  canEditBoq: boolean;
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const fmt = (n: number, digits = 2) => n.toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
/** Canvas pixels above this are not drawn sharper, so a big sheet at high zoom does not run the browser out of memory */
const MAX_CANVAS_PIXELS = 36_000_000;
/** How close, in screen pixels, a click must be to snap onto the first point of an outline */
const SNAP_PX = 10;

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return pdfjs;
}

function measurementLabel(m: Measurement, item: TakeoffItem, data: TakeoffData): string {
  const v = measuredValue(m, item.kind, data.scales[String(m.page)]);
  if (item.kind === 'count') return `${m.points.length} จุด`;
  if (v === null) return 'ยังไม่ตั้งสเกล';
  if (item.kind === 'length') return `${fmt(v)} ม.`;
  return `${m.deduct ? 'หัก ' : ''}${fmt(Math.abs(v))} ตร.ม.${item.kind === 'volume' ? ` × ${item.factor}` : ''}`;
}

function centroid(points: Point[]): Point {
  const n = points.length || 1;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

/** Holding Shift keeps the new segment horizontal or vertical, as walls usually are on a plan */
function orthoSnap(from: Point, to: Point): Point {
  return Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [to[0], from[1]] : [from[0], to[1]];
}

const emptyItem = (kind: TakeoffKind, color: string, category = ''): TakeoffItem => ({
  id: newId(),
  category,
  description: '',
  kind,
  unit: defaultUnitOf(kind),
  factor: 1,
  wastePercent: 0,
  materialRate: '',
  laborRate: '',
  color,
  note: '',
});

const FACTOR_HINT: Record<TakeoffKind, string> = {
  length: 'เช่น ใส่ความสูงผนัง 3 เพื่อเปลี่ยนความยาวเป็นพื้นที่ผนัง (ตร.ม.) หรือใส่ 1 เพื่อใช้ความยาวตรงๆ',
  area: 'เช่น ใส่ความหนา 0.10 เพื่อเปลี่ยนพื้นที่เป็นปริมาตร (ลบ.ม.) หรือใส่ 1 เพื่อใช้พื้นที่ตรงๆ',
  count: 'เช่น โคมละ 2 หลอด ใส่ 2 หรือใส่ 1 เพื่อใช้จำนวนจุดตรงๆ',
  volume: 'ใส่ความหนาหรือความลึก (ม.) เช่น พื้นหนา 0.10 หรือขุดดินลึก 1.20 ระบบคูณกับพื้นที่ที่ลากรอบบนแบบเป็น ลบ.ม.',
};

// ───────────────────────────────── Item dialog ─────────────────────────────────

function ItemDialog({ item, isNew, categories, onSave, onDelete, onClose }: {
  item: TakeoffItem;
  isNew: boolean;
  categories: string[];
  onSave: (item: TakeoffItem) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const set = <K extends keyof TakeoffItem>(k: K, v: TakeoffItem[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const numberOr = (raw: string, fallback: number) => (raw.trim() === '' || !Number.isFinite(Number(raw)) ? fallback : Number(raw));
  const rate = (raw: string): number | '' => (raw.trim() === '' || !Number.isFinite(Number(raw)) ? '' : Math.max(0, Number(raw)));
  const valid = draft.description.trim() !== '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="รายการถอดแบบ">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">{isNew ? 'เพิ่มรายการถอดแบบ' : 'แก้ไขรายการ'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <div>
            <span className="font-semibold text-slate-700">วิธีวัด</span>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TAKEOFF_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  disabled={!isNew && k.kind !== item.kind}
                  onClick={() => setDraft((d) => ({ ...d, kind: k.kind, unit: d.unit === defaultUnitOf(d.kind) || !d.unit ? k.unit : d.unit, factor: k.kind === 'volume' && d.factor === 1 ? 0.1 : d.factor }))}
                  className={`rounded-lg border px-2 py-2 font-semibold disabled:opacity-40 ${draft.kind === k.kind ? 'border-brand bg-blue-50 text-brand' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {!isNew && <p className="mt-1 text-slate-400">เปลี่ยนวิธีวัดไม่ได้เมื่อสร้างรายการแล้ว</p>}
          </div>
          <label className="block">
            <span className="font-semibold text-slate-700">หมวดงาน</span>
            <input list="takeoff-categories" value={draft.category} onChange={(e) => set('category', e.target.value)} placeholder="เช่น งานสถาปัตยกรรม" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            <datalist id="takeoff-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="font-semibold text-slate-700">ชื่อรายการ *</span>
            <input autoFocus value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder="เช่น ผนังก่ออิฐมวลเบา หนา 7.5 ซม." className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="font-semibold text-slate-700">หน่วย</span>
              <input value={draft.unit} onChange={(e) => set('unit', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="block">
              <span className="font-semibold text-slate-700">{draft.kind === 'volume' ? 'ความหนา/ลึก (ม.)' : 'ตัวคูณ'}</span>
              <input key={draft.kind} type="number" step="any" min={0} defaultValue={draft.factor} onChange={(e) => set('factor', Math.max(0, numberOr(e.target.value, 1)))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right" />
            </label>
            <label className="block">
              <span className="font-semibold text-slate-700">เผื่อเสีย (%)</span>
              <input type="number" step="any" min={0} defaultValue={draft.wastePercent} onChange={(e) => set('wastePercent', Math.max(0, numberOr(e.target.value, 0)))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right" />
            </label>
          </div>
          <p className="-mt-1 text-slate-500">ตัวคูณ: {FACTOR_HINT[draft.kind]}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="font-semibold text-slate-700">ราคาวัสดุ/หน่วย</span>
              <input type="number" step="any" min={0} defaultValue={draft.materialRate} onChange={(e) => set('materialRate', rate(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right" />
            </label>
            <label className="block">
              <span className="font-semibold text-slate-700">ค่าแรง/หน่วย</span>
              <input type="number" step="any" min={0} defaultValue={draft.laborRate} onChange={(e) => set('laborRate', rate(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right" />
            </label>
          </div>
          <label className="block">
            <span className="font-semibold text-slate-700">ปริมาณจากแบบ (ไม่ต้องวัด)</span>
            <input
              type="number"
              step="any"
              defaultValue={draft.fixedQty ?? ''}
              onChange={(e) => set('fixedQty', e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value))}
              placeholder="เว้นว่างถ้าจะวัดบนแบบ"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right"
            />
            <span className="mt-0.5 block text-slate-500">ตัวเลขที่ AI อ่านได้ หรือที่พิมพ์เอง ระบบรวมกับที่วัดบนแบบ แล้วคูณตัวคูณและบวกเผื่อเสีย</span>
          </label>
          <label className="block">
            <span className="font-semibold text-slate-700">หักออกหลังคูณตัวคูณ ({draft.unit || 'หน่วยของรายการ'})</span>
            <input
              type="number"
              step="any"
              min={0}
              defaultValue={draft.deductQty ?? ''}
              onChange={(e) => set('deductQty', e.target.value.trim() === '' || !(Number(e.target.value) > 0) ? undefined : Number(e.target.value))}
              placeholder="เช่น พื้นที่ช่องประตู-หน้าต่างรวม"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right"
            />
          </label>
          {draft.sourceItemId && <p className="rounded-lg bg-blue-50 p-2 text-slate-600">รายการนี้คำนวณจากการวัดของรายการหลักในชิ้นส่วนเดียวกัน{draft.basis === 'perimeter' ? ' โดยใช้เส้นรอบรูป' : ''} คลิกเลือกรายการนี้จะไปวัดที่รายการหลัก</p>}
          <label className="block">
            <span className="font-semibold text-slate-700">หมายเหตุ</span>
            <input value={draft.note} onChange={(e) => set('note', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <div>
            <span className="font-semibold text-slate-700">สีบนแบบ</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ITEM_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => set('color', c)} title={c} className={`h-6 w-6 rounded-full border-2 ${draft.color === c ? 'border-slate-900' : 'border-white'}`} style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 px-5 py-3">
          {!isNew ? (
            <button type="button" onClick={onDelete} className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 font-semibold text-red-700 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" /> ลบรายการ
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
              ยกเลิก
            </button>
            <button type="button" disabled={!valid} onClick={() => onSave({ ...draft, description: draft.description.trim(), category: draft.category.trim(), unit: draft.unit.trim() })} className="rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
              {isNew ? 'เพิ่มแล้วเริ่มวัด' : 'บันทึกรายการ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────── Send dialog ─────────────────────────────────

function SendDialog({ takeoff, projects, total, lineCount, onClose, onSent }: {
  takeoff: TakeoffDocumentDto;
  projects: ProjectOption[];
  total: number;
  lineCount: number;
  onClose: () => void;
  onSent: (boqNumber: string, projectId: string) => void;
}) {
  const editable = projects.filter((p) => p.canEditBoq);
  const [projectId, setProjectId] = useState(editable.some((p) => p.id === takeoff.projectId) ? takeoff.projectId! : (editable[0]?.id ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const send = () =>
    startTransition(async () => {
      setError(null);
      const res = await sendTakeoffToBoqAction(takeoff.id, projectId);
      if (!res.ok) return setError(res.error);
      onSent(res.boqNumber, projectId);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="ส่งเข้า BOQ โครงการ">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">ส่งรายการเข้า BOQ โครงการ</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          {editable.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">คุณยังไม่มีสิทธิ์แก้ BOQ ของโครงการใด ให้ดาวน์โหลด Excel แล้วส่งให้ผู้ดูแล BOQ นำเข้าแทน</p>
          ) : (
            <>
              <label className="block">
                <span className="font-semibold text-slate-700">โครงการ</span>
                <SearchSelect value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  {editable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </SearchSelect>
              </label>
              <p className="text-slate-600">
                จะเพิ่ม {lineCount.toLocaleString()} แถว (รวมหัวหมวด) ต่อท้าย BOQ หลักของโครงการ มูลค่ารวม {fmt(total)} บาท รายการเดิมใน BOQ ไม่ถูกแก้ไข
              </p>
              {takeoff.sentAt && (
                <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-semibold text-amber-900">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  งานนี้เคยส่งเข้า {takeoff.sentBoqNumber} แล้ว ถ้าส่งซ้ำ รายการจะซ้ำใน BOQ
                </p>
              )}
            </>
          )}
          {error && <p className="font-semibold text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" disabled={pending || !projectId} onClick={send} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> {pending ? 'กำลังส่ง...' : 'ส่งเข้า BOQ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────── Workspace ─────────────────────────────────

export function BoqTakeoffWorkspace({ initial, projects }: { initial: TakeoffDocumentDto; projects: ProjectOption[] }) {
  const router = useRouter();
  const [doc, setDoc] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [data, setData] = useState<TakeoffData>(initial.data);
  const [fileName, setFileName] = useState(initial.fileName);
  const [fingerprint, setFingerprint] = useState(initial.fileFingerprint);
  const [pageCount, setPageCount] = useState(initial.pageCount);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });
  const undoStack = useRef<TakeoffData[]>([]);

  // PDF
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [otherFileWarning, setOtherFileWarning] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  /** Finishing a shape on another page would put it in the wrong place, so changing page drops it */
  const goPage = (next: number | ((p: number) => number)) => {
    setPage(next);
    setDraft([]);
    setCalibration(null);
    setSelected(null);
  };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tools
  const [tool, setTool] = useState<Tool>('pan');
  const [activeItemId, setActiveItemId] = useState<string | null>(initial.data.items[0]?.id ?? null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [deductMode, setDeductMode] = useState(false);
  const [selected, setSelected] = useState<{ id: string; point?: number } | null>(null);
  const [calibration, setCalibration] = useState<{ a: Point; b: Point } | null>(null);
  const [calibrationMeters, setCalibrationMeters] = useState('');
  const [itemDialog, setItemDialog] = useState<{ item: TakeoffItem; isNew: boolean } | null>(null);
  const [elementOpen, setElementOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [archicadOpen, setArchicadOpen] = useState(false);
  const [ifcOpen, setIfcOpen] = useState(false);
  /** คิดราคา dialog; focusIds = items just added, priced first */
  const [pricing, setPricing] = useState<{ focusIds?: string[] } | null>(null);
  const [cadOpen, setCadOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const spaceDown = useRef(false);

  const activeItem = data.items.find((i) => i.id === activeItemId) ?? null;
  const pageScale = data.scales[String(page)];

  // ── data changes (with undo) ──
  const change = useCallback((fn: (d: TakeoffData) => TakeoffData) => {
    setData((prev) => {
      undoStack.current = [...undoStack.current.slice(-49), prev];
      return fn(prev);
    });
    setDirty(true);
  }, []);
  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev) {
      setData(prev);
      setDirty(true);
      setSelected(null);
    }
  };

  // ── PDF loading ──
  const openFile = useCallback(
    async (file: File, fromCache = false) => {
      setPdfError(null);
      setLoadingPdf(true);
      try {
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
        const fp = doc.fingerprints[0] ?? '';
        if (fingerprint && fp && fp !== fingerprint) {
          setOtherFileWarning(`ไฟล์ที่เลือก (${file.name}) ไม่ใช่ไฟล์เดียวกับที่ใช้วัดไว้ (${fileName}) ตำแหน่งที่วัดอาจไม่ตรงกับแบบ`);
        } else setOtherFileWarning(null);
        setPdf((old) => {
          void old?.destroy();
          return doc;
        });
        setPageCount(doc.numPages);
        setPage((p) => Math.min(Math.max(1, p), doc.numPages));
        if (!fingerprint || !fromCache) {
          if (fileName !== file.name || fingerprint !== fp || pageCount !== doc.numPages) setDirty(true);
          setFileName(file.name);
          setFingerprint(fp);
        }
        if (!fromCache) void cacheTakeoffFile(initial.id, file);
      } catch (err) {
        console.error(err);
        setPdfError(err instanceof Error && err.name === 'PasswordException' ? 'ไฟล์ PDF นี้ตั้งรหัสผ่านไว้ จึงเปิดไม่ได้' : 'เปิดไฟล์ไม่ได้ กรุณาเลือกไฟล์ PDF');
      } finally {
        setLoadingPdf(false);
      }
    },
    [fingerprint, fileName, pageCount, initial.id],
  );

  // Reopen the drawing kept in this browser
  const triedCache = useRef(false);
  useEffect(() => {
    if (triedCache.current) return;
    triedCache.current = true;
    void readCachedTakeoffFile(initial.id).then((file) => {
      if (file) void openFile(file, true);
    });
  }, [initial.id, openFile]);

  // ── page render ──
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      setPageSize({ w: base.width, h: base.height });
      const dpr = window.devicePixelRatio || 1;
      let outScale = zoom * dpr;
      const pixels = base.width * base.height * outScale * outScale;
      if (pixels > MAX_CANVAS_PIXELS) outScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const viewport = p.getViewport({ scale: outScale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${base.width * zoom}px`;
      canvas.style.height = `${base.height * zoom}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = p.render({ canvasContext: ctx, viewport });
      try {
        await task.promise;
      } catch {
        // cancelled by a newer render
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, zoom]);

  const fitWidth = useCallback(() => {
    const box = scrollRef.current;
    if (!box || !pageSize) return;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (box.clientWidth - 32) / pageSize.w)));
  }, [pageSize]);

  // Fit the first page shown
  const fitted = useRef(false);
  useEffect(() => {
    if (pageSize && !fitted.current) {
      fitted.current = true;
      fitWidth();
    }
  }, [pageSize, fitWidth]);

  /** Zoom keeping the given screen point (or the centre) still */
  const zoomTo = useCallback(
    (next: number, at?: { x: number; y: number }) => {
      const box = scrollRef.current;
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      if (!box) return setZoom(z);
      const rect = box.getBoundingClientRect();
      const px = at ? at.x - rect.left : box.clientWidth / 2;
      const py = at ? at.y - rect.top : box.clientHeight / 2;
      const docX = (box.scrollLeft + px) / zoom;
      const docY = (box.scrollTop + py) / zoom;
      setZoom(z);
      requestAnimationFrame(() => {
        box.scrollLeft = docX * z - px;
        box.scrollTop = docY * z - py;
      });
    },
    [zoom],
  );

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX, y: e.clientY });
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [zoom, zoomTo]);

  // ── geometry helpers ──
  const toDoc = (e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom];
  };

  const adjust = (p: Point, shift: boolean): Point => {
    const last = draft[draft.length - 1];
    return shift && last ? orthoSnap(last, p) : p;
  };

  const finishDraft = () => {
    if (!activeItem) return setDraft([]);
    if (activeItem.kind === 'length' && draft.length >= 2) {
      change((d) => ({ ...d, measurements: [...d.measurements, { id: newId(), itemId: activeItem.id, page, points: draft }] }));
    } else if (isOutlineKind(activeItem.kind) && draft.length >= 3 && polygonArea(draft) > 0) {
      change((d) => ({ ...d, measurements: [...d.measurements, { id: newId(), itemId: activeItem.id, page, points: draft, ...(deductMode ? { deduct: true } : {}) }] }));
    }
    setDraft([]);
  };

  const deleteSelected = () => {
    if (!selected) return;
    change((d) => ({
      ...d,
      measurements: d.measurements.flatMap((m) => {
        if (m.id !== selected.id) return [m];
        if (selected.point === undefined || m.points.length <= 1) return [];
        return [{ ...m, points: m.points.filter((_, i) => i !== selected.point) }];
      }),
    }));
    setSelected(null);
  };


  // ── pointer handling on the drawing ──
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = scrollRef.current;
    if (!box) return;
    const panning = tool === 'pan' || e.button === 1 || spaceDown.current;
    if (panning) {
      panRef.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
      setIsPanning(true);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const p = adjust(toDoc(e), e.shiftKey);

    if (tool === 'calibrate') {
      if (!calibration) setCalibration({ a: p, b: p });
      else if (calibration.a === calibration.b) setCalibration({ a: calibration.a, b: e.shiftKey ? orthoSnap(calibration.a, toDoc(e)) : toDoc(e) });
      else setCalibration({ a: p, b: p });
      return;
    }
    if (tool === 'select') {
      setSelected(null);
      return;
    }
    if (tool !== 'measure' || !activeItem) return;
    if (activeItem.kind === 'count') {
      change((d) => {
        const existing = d.measurements.find((m) => m.itemId === activeItem.id && m.page === page);
        if (existing) return { ...d, measurements: d.measurements.map((m) => (m === existing ? { ...m, points: [...m.points, p] } : m)) };
        return { ...d, measurements: [...d.measurements, { id: newId(), itemId: activeItem.id, page, points: [p] }] };
      });
      return;
    }
    // Clicking back on the first point closes an outline
    if (isOutlineKind(activeItem.kind) && draft.length >= 3) {
      const first = draft[0]!;
      if (Math.hypot(first[0] - p[0], first[1] - p[1]) * zoom <= SNAP_PX) return finishDraft();
    }
    // A double click arrives as two clicks on the same spot first
    const last = draft[draft.length - 1];
    if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) * zoom < 2) return;
    setDraft((d) => [...d, p]);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan && scrollRef.current) {
      scrollRef.current.scrollLeft = pan.left - (e.clientX - pan.x);
      scrollRef.current.scrollTop = pan.top - (e.clientY - pan.y);
      return;
    }
    if (tool === 'measure' || tool === 'calibrate') {
      const p = toDoc(e);
      if (tool === 'calibrate' && calibration && calibration.a === calibration.b) setCursor(e.shiftKey ? orthoSnap(calibration.a, p) : p);
      else setCursor(adjust(p, e.shiftKey));
    }
  };

  const onPointerUp = () => {
    panRef.current = null;
    setIsPanning(false);
  };

  // ── saving ──
  const savingRef = useRef(false);
  // What is on screen now, to tell after a save whether the user changed anything while it ran
  const latestRef = useRef({ name, projectId, fileName, fingerprint, pageCount, data });
  useEffect(() => {
    latestRef.current = { name, projectId, fileName, fingerprint, pageCount, data };
  });
  const save = async (): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaveState({ kind: 'saving' });
    const sent = { name, projectId, fileName, fingerprint, pageCount, data };
    try {
      const res = await saveTakeoffAction(initial.id, {
        name,
        projectId,
        baseUpdatedAt: doc.updatedAt,
        fileName,
        fileFingerprint: fingerprint,
        pageCount,
        data,
      });
      if (!res.ok) {
        setSaveState({ kind: 'error', message: res.error });
        return false;
      }
      setDoc(res.takeoff);
      // Edits made while the save ran are not in it, so they still wait to be saved
      const now = latestRef.current;
      const unchanged = (Object.keys(sent) as (keyof typeof sent)[]).every((k) => now[k] === sent[k]);
      setDirty(!unchanged);
      setSaveState({ kind: 'saved' });
      return true;
    } catch {
      setSaveState({ kind: 'error', message: 'บันทึกไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่' });
      return false;
    } finally {
      savingRef.current = false;
    }
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  // Saves on its own a few seconds after the last change
  useEffect(() => {
    if (!dirty || !name.trim() || saveState.kind === 'error') return;
    const t = window.setTimeout(() => void saveRef.current(), 4000);
    return () => window.clearTimeout(t);
  }, [dirty, data, name, projectId, saveState.kind]);

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [role="dialog"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (draft.length > 0) setDraft((d) => d.slice(0, -1));
        else undo();
        return;
      }
      if (e.key === ' ') {
        spaceDown.current = true;
        if (e.target === document.body) e.preventDefault();
      }
      if (e.key === 'Escape') {
        setDraft([]);
        setCalibration(null);
        setSelected(null);
      } else if (e.key === 'Enter') finishDraft();
      else if (e.key === 'Backspace' && draft.length > 0) setDraft((d) => d.slice(0, -1));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) deleteSelected();
      else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) goPage((p) => Math.min(pageCount || 1, p + 1));
      else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) goPage((p) => Math.max(1, p - 1));
      else if (e.key.toLowerCase() === 'v') setTool('select');
      else if (e.key.toLowerCase() === 'h') setTool('pan');
      else if (e.key.toLowerCase() === 'm' && activeItem) setTool('measure');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ── derived ──
  const quantities = useMemo(() => new Map(data.items.map((i) => [i.id, itemQuantity(i, data)])), [data]);
  /** What the AI dialog checks its rows against, so work already taken off is not added twice */
  const existingForAi = useMemo(() => data.items.map((it) => ({ description: it.description, kind: it.kind, unit: it.unit, qty: quantities.get(it.id)?.measured ?? 0 })), [data.items, quantities]);
  const groups = useMemo(() => groupByCategory(data.items), [data.items]);
  const grandTotal = useMemo(() => data.items.reduce((s, i) => s + itemAmount(i, quantities.get(i.id)!.qty), 0), [data.items, quantities]);
  const categories = useMemo(() => [...new Set([...STOCK_CATEGORIES, ...data.items.map((i) => i.category).filter(Boolean)])], [data.items]);
  const pagesWithWork = useMemo(() => new Set(data.measurements.map((m) => m.page)), [data.measurements]);
  const itemsById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const pageMeasurements = data.measurements.filter((m) => m.page === page && itemsById.has(m.itemId));
  const unscaledTotal = [...quantities.values()].reduce((n, q) => n + q.unscaled, 0);

  const exportExcel = async () => {
    const { downloadWorkbook } = await import('@/lib/spreadsheet');
    const rows = toBoqLines(data, { note: `ถอดแบบ ${doc.number}` }).map((l) => [l.no, l.description, l.qty, l.unit, l.materialRate, l.laborRate, l.note]);
    await downloadWorkbook(`${doc.number}_ถอดแบบ_BOQ.xlsx`, [...BOQ_SHEET_COLUMNS], rows);
  };

  const pickItem = (picked: TakeoffItem) => {
    // A line worked out from another item is measured on that item
    const item = (picked.sourceItemId && data.items.find((i) => i.id === picked.sourceItemId)) || picked;
    setActiveItemId(item.id);
    setDraft([]);
    setTool('measure');
    if (!isOutlineKind(item.kind)) setDeductMode(false);
  };

  const saveItem = (item: TakeoffItem, isNew: boolean) => {
    change((d) => ({ ...d, items: isNew ? [...d.items, item] : d.items.map((i) => (i.id === item.id ? item : i)) }));
    setItemDialog(null);
    if (isNew) pickItem(item);
  };

  const deleteItem = (item: TakeoffItem) => {
    const n = data.measurements.filter((m) => m.itemId === item.id).length;
    // Lines worked out from this item have nothing to measure without it, so they go with it
    const followers = data.items.filter((i) => i.sourceItemId === item.id);
    const also = followers.length > 0 ? ` และรายการที่คำนวณจากรายการนี้อีก ${followers.length} รายการ` : '';
    if ((n > 0 || followers.length > 0) && !window.confirm(`ลบรายการ "${item.description}" และการวัด ${n} ครั้งของรายการนี้${also}ใช่หรือไม่?`)) return;
    const gone = new Set([item.id, ...followers.map((i) => i.id)]);
    change((d) => ({ ...d, items: d.items.filter((i) => !gone.has(i.id)), measurements: d.measurements.filter((m) => !gone.has(m.itemId)) }));
    if (activeItemId === item.id) setActiveItemId(null);
    setItemDialog(null);
  };

  const addElementItems = (items: TakeoffItem[]) => {
    change((d) => ({ ...d, items: [...d.items, ...items] }));
    setElementOpen(false);
    const main = items[0]!;
    setActiveItemId(main.id);
    setDraft([]);
    setTool('measure');
    if (!isOutlineKind(main.kind)) setDeductMode(false);
    setNotice(`เพิ่ม ${items.length} รายการแล้ว วัด "${main.description}" บนแบบ รายการอื่นคำนวณตามให้เอง`);
  };

  const addAiItems = (picked: AiPickedItem[]) => {
    const ids = picked.map(() => newId());
    change((d) => {
      const added: TakeoffItem[] = picked.map((p, i) => ({
        id: ids[i]!,
        category: p.category,
        description: p.description.slice(0, 1000),
        kind: p.kind,
        unit: p.unit || defaultUnitOf(p.kind),
        factor: 1,
        wastePercent: 0,
        materialRate: '',
        laborRate: '',
        color: ITEM_COLORS[(d.items.length + i) % ITEM_COLORS.length]!,
        note: `AI หน้า ${(p.pages ?? [p.page]).join(', ')}: ${p.basis}`.slice(0, 500),
        fixedQty: p.qty,
      }));
      return { ...d, items: [...d.items, ...added] };
    });
    setAiOpen(false);
    setNotice(`เพิ่ม ${picked.length} รายการจาก AI แล้ว ตรวจตัวเลขและราคา แล้วกดบันทึก`);
    // Quantities are in; the rates follow straight away
    if (ids.length > 0) setPricing({ focusIds: ids });
  };

  const addArchicadItems = (picked: ArchicadPickedItem[], from = 'Archicad') => {
    const ids = picked.map(() => newId());
    change((d) => {
      const added: TakeoffItem[] = picked.map((p, i) => ({
        id: ids[i]!,
        category: p.category,
        description: p.description,
        kind: p.kind,
        unit: p.unit || defaultUnitOf(p.kind),
        factor: 1,
        wastePercent: 0,
        materialRate: '',
        laborRate: '',
        color: ITEM_COLORS[(d.items.length + i) % ITEM_COLORS.length]!,
        note: p.note,
        fixedQty: p.qty,
      }));
      return { ...d, items: [...d.items, ...added] };
    });
    setArchicadOpen(false);
    setIfcOpen(false);
    setNotice(`เพิ่ม ${picked.length} รายการจาก ${from} แล้ว ตรวจตัวเลขและราคา แล้วกดบันทึก`);
    if (ids.length > 0) setPricing({ focusIds: ids });
  };

  const addAutoGroups = (picked: AutoPickedGroup[], written: AiPickedItem[]) => {
    const writtenIds = written.map(() => newId());
    const pickedIds = picked.map(() => newId());
    change((d) => {
      const items: TakeoffItem[] = [];
      // Quantities written in the drawing's notes: an item with that quantity, nothing to measure
      written.forEach((p, i) =>
        items.push({
          id: writtenIds[i]!,
          category: p.category,
          description: p.description.slice(0, 1000),
          kind: p.kind,
          unit: p.unit || defaultUnitOf(p.kind),
          factor: 1,
          wastePercent: 0,
          materialRate: '',
          laborRate: '',
          color: ITEM_COLORS[(d.items.length + i) % ITEM_COLORS.length]!,
          note: `ปริมาณจากข้อความบนแบบ ${p.basis}`.slice(0, 500),
          fixedQty: p.qty,
        }),
      );
      const measurements: Measurement[] = [];
      picked.forEach((p, i) => {
        const item: TakeoffItem = {
          id: pickedIds[i]!,
          category: p.category,
          description: p.description.slice(0, 1000),
          kind: p.group.kind,
          unit: p.unit,
          factor: p.factor,
          wastePercent: 0,
          materialRate: '',
          laborRate: '',
          color: ITEM_COLORS[(d.items.length + written.length + i) % ITEM_COLORS.length]!,
          note: `ถอดแบบอัตโนมัติ: ${p.group.label}`.slice(0, 500),
        };
        items.push(item);
        measurements.push(...groupToMeasurements(p.group, item.id, newId));
      });
      return { ...d, items: [...d.items, ...items], measurements: [...d.measurements, ...measurements] };
    });
    setAutoOpen(false);
    setNotice(`เพิ่ม ${picked.length + written.length} รายการจากการถอดแบบอัตโนมัติแล้ว ตรวจบนแบบและราคา แล้วกดบันทึก`);
    const ids = [...writtenIds, ...pickedIds];
    if (ids.length > 0) setPricing({ focusIds: ids });
  };

  const addCadItems = (picked: CadPickedItem[]) => {
    const ids = picked.map(() => newId());
    change((d) => ({
      ...d,
      items: [
        ...d.items,
        ...picked.map(
          (p, i): TakeoffItem => ({
            id: ids[i]!,
            category: p.category,
            description: p.description.slice(0, 1000),
            kind: p.kind,
            unit: p.unit || defaultUnitOf(p.kind),
            factor: p.factor,
            wastePercent: 0,
            materialRate: '',
            laborRate: '',
            color: ITEM_COLORS[(d.items.length + i) % ITEM_COLORS.length]!,
            note: p.note.slice(0, 500),
            fixedQty: p.qty,
          }),
        ),
      ],
    }));
    setCadOpen(false);
    setNotice(`เพิ่ม ${picked.length} รายการจากไฟล์ CAD แล้ว ตรวจตัวเลขและราคา แล้วกดบันทึก`);
    if (ids.length > 0) setPricing({ focusIds: ids });
  };

  const applyPrices = (updates: PriceUpdate[]) => {
    const byId = new Map(updates.map((u) => [u.id, u]));
    change((d) => ({
      ...d,
      items: d.items.map((i) => {
        const u = byId.get(i.id);
        return u ? { ...i, materialRate: u.materialRate, laborRate: u.laborRate, note: u.priceNote ? withPriceNote(i.note, u.priceNote) : i.note } : i;
      }),
    }));
    setPricing(null);
    setNotice(`ใส่ราคาวัสดุและค่าแรงให้ ${updates.length} รายการแล้ว ตรวจแล้วกดบันทึก`);
  };

  const setScalesByPage = (ratioByPage: Record<number, number>) => {
    change((d) => {
      const scales = { ...d.scales };
      for (const [p, ratio] of Object.entries(ratioByPage)) scales[String(p)] = scaleFromRatio(ratio);
      return { ...d, scales };
    });
  };

  const applyCalibration = (allPages: boolean) => {
    if (!calibration) return;
    const scale = scaleFromCalibration(calibration.a, calibration.b, Number(calibrationMeters));
    if (!scale) return;
    setScale(scale, allPages);
    setCalibration(null);
    setCalibrationMeters('');
    setTool(activeItem ? 'measure' : 'pan');
  };

  const setScale = (scale: ReturnType<typeof scaleFromRatio>, allPages: boolean) => {
    change((d) => {
      const scales = { ...d.scales };
      if (allPages) for (let p = 1; p <= Math.max(pageCount, 1); p++) scales[String(p)] = scale;
      else scales[String(page)] = scale;
      return { ...d, scales };
    });
  };

  const sw = 2; // stroke width in screen px
  const r = 5 / zoom;
  const fontSize = 12 / zoom;

  const toolButton = (t: Tool, icon: React.ReactNode, label: string, key: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setTool(t);
        setDraft([]);
        if (t !== 'calibrate') setCalibration(null);
      }}
      title={`${label} (${key})`}
      className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold disabled:opacity-40 ${tool === t ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );

  const cursorStyle = tool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : 'crosshair';

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-xs text-slate-800 md:h-[calc(100dvh-6.5rem)] xl:h-[calc(100dvh-7.5rem)]">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <Link href="/boq-takeoff" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="กลับไปรายการงานถอดแบบ">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="font-mono font-semibold text-slate-500">{doc.number}</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          className="min-w-[12rem] flex-1 rounded-lg border border-transparent px-2 py-1 text-sm font-bold text-slate-900 hover:border-slate-200 focus:border-slate-300"
          aria-label="ชื่องานถอดแบบ"
        />
        <SearchSelect
          value={projectId ?? ''}
          onChange={(e) => {
            setProjectId(e.target.value || null);
            setDirty(true);
          }}
          className="max-w-[16rem] rounded-lg border border-slate-200 px-2 py-1.5"
          aria-label="โครงการ"
        >
          <option value="">ยังไม่ระบุโครงการ</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </SearchSelect>
        <span className={`min-w-[7rem] text-right ${saveState.kind === 'error' ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
          {saveState.kind === 'saving' ? 'กำลังบันทึก...' : saveState.kind === 'error' ? saveState.message : dirty ? 'ยังไม่บันทึก' : saveState.kind === 'saved' ? 'บันทึกแล้ว' : ''}
        </span>
        <button type="button" onClick={() => void save()} disabled={!dirty || !name.trim()} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40" title="บันทึก (Ctrl+S)">
          <Save className="h-3.5 w-3.5" /> บันทึก
        </button>
        <button type="button" onClick={() => setAutoOpen(true)} disabled={!pdf} className="flex items-center gap-1 rounded-lg border border-brand bg-brand px-2.5 py-1.5 font-semibold text-white hover:bg-brand-hover disabled:opacity-40" title="อ่านเส้นและสัญลักษณ์จากไฟล์ PDF แล้วจัดกลุ่มเป็นรายการ BOQ (ไม่มีค่าใช้จ่าย)">
          <ScanLine className="h-3.5 w-3.5" /> ถอดแบบอัตโนมัติ
        </button>
        <button type="button" onClick={() => setAiOpen(true)} disabled={!pdf} className="flex items-center gap-1 rounded-lg border border-brand px-2.5 py-1.5 font-semibold text-brand hover:bg-blue-50 disabled:opacity-40" title="ให้ AI อ่านแบบแล้วแยกเป็นรายการ BOQ">
          <Sparkles className="h-3.5 w-3.5" /> AI ถอดแบบ
        </button>
        <button type="button" onClick={() => setArchicadOpen(true)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50" title="ดึงปริมาณจากโมเดล Archicad ที่เปิดอยู่บนเครื่องนี้">
          <Box className="h-3.5 w-3.5 text-brand" /> ดึงจาก Archicad
        </button>
        <button type="button" onClick={() => setIfcOpen(true)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50" title="นำเข้าปริมาณจากไฟล์ IFC ที่ export จาก Archicad หรือโปรแกรม BIM อื่น">
          <FileBox className="h-3.5 w-3.5 text-brand" /> นำเข้า IFC
        </button>
        <button type="button" onClick={() => setCadOpen(true)} className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50" title="อ่านความยาว พื้นที่ จำนวน จากไฟล์ CAD (DXF) โดยตรง ไม่ต้องตั้งสเกล">
          <FileUp className="h-3.5 w-3.5" /> CAD (DXF)
        </button>
        <button type="button" onClick={() => setPricing({})} disabled={data.items.length === 0} className="flex items-center gap-1 rounded-lg border border-emerald-600 px-2.5 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40" title="ใส่ราคาวัสดุและค่าแรงต่อหน่วยให้ทุกรายการ จาก BOQ/PO เดิม และ AI ประมาณราคาที่ไม่มี">
          <BadgeDollarSign className="h-3.5 w-3.5" /> คิดราคา
        </button>
        <button type="button" onClick={() => void exportExcel()} disabled={data.items.length === 0} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40" title="ดาวน์โหลดเป็นไฟล์ Excel แบบฟอร์ม BOQ">
          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Excel
        </button>
        <button
          type="button"
          disabled={data.items.length === 0}
          onClick={async () => {
            if (dirty && !(await save())) return;
            setSending(true);
          }}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" /> ส่งเข้า BOQ โครงการ
        </button>
      </div>

      {notice && (
        <div className="flex items-center justify-between gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 font-semibold text-emerald-800">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-700" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {otherFileWarning && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 font-semibold text-amber-900">
          <span className="flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> {otherFileWarning}
          </span>
          <button type="button" onClick={() => setOtherFileWarning(null)} className="text-amber-800" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Drawing */}
        <div className="flex min-w-0 flex-1 flex-col">
          {pdf && (
            <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-slate-200 bg-white px-2 py-1.5">
              {toolButton('pan', <Hand className="h-3.5 w-3.5" />, 'เลื่อน', 'H')}
              {toolButton('select', <MousePointer2 className="h-3.5 w-3.5" />, 'เลือก/ลบ', 'V')}
              {toolButton('measure', <Pencil className="h-3.5 w-3.5" />, activeItem ? kindLabel(activeItem.kind) : 'วัด', 'M', !activeItem)}
              {toolButton('calibrate', <Crosshair className="h-3.5 w-3.5" />, 'วัดเทียบสเกล', '-')}
              {activeItem && isOutlineKind(activeItem.kind) && tool === 'measure' && (
                <label className="ml-1 flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1.5 font-semibold text-amber-800">
                  <input type="checkbox" checked={deductMode} onChange={(e) => setDeductMode(e.target.checked)} /> หักช่องเปิด
                </label>
              )}
              <button type="button" onClick={() => (draft.length ? setDraft((d) => d.slice(0, -1)) : undo())} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100" title="ย้อนกลับ (Ctrl+Z)">
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <button type="button" onClick={() => goPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-30" title="หน้าก่อน (PageUp)">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <select value={page} onChange={(e) => goPage(Number(e.target.value))} className="rounded-lg border border-slate-200 px-1.5 py-1" aria-label="หน้า">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                  <option key={p} value={p}>
                    หน้า {p}/{pageCount}
                    {pagesWithWork.has(p) ? ' •' : ''}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => goPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-30" title="หน้าถัดไป (PageDown)">
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <button type="button" onClick={() => zoomTo(zoom / 1.25)} className="rounded-lg p-1.5 hover:bg-slate-100" title="ย่อ (Ctrl+เลื่อนล้อเมาส์)">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => zoomTo(zoom * 1.25)} className="rounded-lg p-1.5 hover:bg-slate-100" title="ขยาย (Ctrl+เลื่อนล้อเมาส์)">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button type="button" onClick={fitWidth} className="rounded-lg p-1.5 hover:bg-slate-100" title="พอดีความกว้าง">
                <Maximize className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-100" title="เปลี่ยนไฟล์ PDF">
                <FileUp className="h-3.5 w-3.5 shrink-0" /> <span className="max-w-[10rem] truncate">{fileName}</span>
              </button>
            </div>
          )}

          {/* Hint line */}
          {pdf && (
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600">
              {!pageScale && tool !== 'calibrate' ? (
                <span className="font-semibold text-amber-700">หน้านี้ยังไม่ได้ตั้งสเกล ตั้งที่แผง &quot;สเกลของหน้า&quot; ทางขวาก่อนวัดระยะหรือพื้นที่</span>
              ) : tool === 'calibrate' ? (
                'คลิกจุดเริ่มและจุดปลายของเส้นที่รู้ระยะจริง (เช่น เส้นบอกระยะ) แล้วใส่ระยะจริงที่แผงขวา · กด Shift ค้างให้เส้นตรงแนวนอน/ตั้ง'
              ) : tool === 'measure' && activeItem ? (
                activeItem.kind === 'count' ? (
                  `คลิกบนแบบทีละจุดเพื่อนับ "${activeItem.description}" · ลบจุดที่ผิดด้วยเครื่องมือ เลือก/ลบ`
                ) : activeItem.kind === 'length' ? (
                  `คลิกทีละจุดตามแนว "${activeItem.description}" ดับเบิลคลิกหรือกด Enter เพื่อจบเส้น · Shift = แนวตรง · Backspace = ลบจุดล่าสุด · Esc = ยกเลิก`
                ) : (
                  `คลิกรอบขอบพื้นที่ "${activeItem.description}" แล้วคลิกจุดแรกหรือกด Enter เพื่อปิดรูป · ติ๊ก "หักช่องเปิด" เพื่อวัดส่วนที่ต้องหักออก${activeItem.kind === 'volume' ? ` · ระบบคูณความหนา/ลึก ${activeItem.factor} ม. เป็น ลบ.ม.` : ''}`
                )
              ) : tool === 'select' ? (
                'คลิกเส้น พื้นที่ หรือจุดที่วัดไว้เพื่อเลือก แล้วกด Delete เพื่อลบ'
              ) : (
                'ลากเพื่อเลื่อนแบบ · Ctrl + ล้อเมาส์เพื่อซูม · เลือกรายการทางขวาแล้วคลิกบนแบบเพื่อวัด'
              )}
            </div>
          )}

          <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
            {!pdf ? (
              <div
                className="flex h-full items-center justify-center p-6"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) void openFile(f);
                }}
              >
                <div className="max-w-md rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
                  <FileUp className="mx-auto h-10 w-10 text-slate-400" />
                  <p className="mt-3 text-sm font-bold text-slate-900">{loadingPdf ? 'กำลังเปิดไฟล์...' : fileName ? `เลือกไฟล์แบบ "${fileName}" อีกครั้ง` : 'เลือกไฟล์แบบ PDF ที่สั่งพิมพ์จาก CAD'}</p>
                  <p className="mt-1 text-slate-500">ลากไฟล์มาวางที่นี่ หรือกดปุ่มด้านล่าง ไฟล์จะเปิดในเครื่องของคุณเท่านั้น ไม่ถูกอัปโหลด ระบบบันทึกเฉพาะผลการวัด</p>
                  <button type="button" disabled={loadingPdf} onClick={() => fileInputRef.current?.click()} className="mt-4 rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
                    เลือกไฟล์ PDF
                  </button>
                  {pdfError && <p className="mt-3 font-semibold text-red-600">{pdfError}</p>}
                </div>
              </div>
            ) : (
              <div className="inline-block p-4">
                <div className="relative bg-white shadow-md" style={pageSize ? { width: pageSize.w * zoom, height: pageSize.h * zoom } : undefined}>
                  <canvas ref={canvasRef} className="block" />
                  {pageSize && (
                    <svg
                      ref={svgRef}
                      className="absolute inset-0 touch-none"
                      width={pageSize.w * zoom}
                      height={pageSize.h * zoom}
                      viewBox={`0 0 ${pageSize.w} ${pageSize.h}`}
                      style={{ cursor: cursorStyle }}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerLeave={() => setCursor(null)}
                      onDoubleClick={() => tool === 'measure' && finishDraft()}
                    >
                      {pageMeasurements.map((m) => {
                        const item = itemsById.get(m.itemId)!;
                        const isSel = selected?.id === m.id;
                        const dim = activeItem && tool === 'measure' && activeItem.id !== item.id;
                        const selectable = tool === 'select';
                        const pick = (e: React.PointerEvent, point?: number) => {
                          if (!selectable) return;
                          e.stopPropagation();
                          setSelected({ id: m.id, point });
                          setActiveItemId(item.id);
                        };
                        const pts = m.points.map((p) => p.join(',')).join(' ');
                        const label = measurementLabel(m, item, data);
                        const [lx, ly] = item.kind === 'length' ? m.points[Math.floor((m.points.length - 1) / 2)]! : centroid(m.points);
                        return (
                          <g key={m.id} opacity={dim ? 0.45 : 1} style={{ pointerEvents: selectable ? 'auto' : 'none', cursor: selectable ? 'pointer' : undefined }}>
                            {item.kind === 'length' && (
                              <>
                                <polyline points={pts} fill="none" stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" onPointerDown={(e) => pick(e)} />
                                <polyline points={pts} fill="none" stroke={item.color} strokeWidth={isSel ? sw + 2 : sw} vectorEffect="non-scaling-stroke" strokeLinejoin="round" onPointerDown={(e) => pick(e)} />
                              </>
                            )}
                            {isOutlineKind(item.kind) && (
                              <polygon
                                points={pts}
                                fill={item.color}
                                fillOpacity={m.deduct ? 0.08 : 0.22}
                                stroke={item.color}
                                strokeDasharray={m.deduct ? '6 4' : undefined}
                                strokeWidth={isSel ? sw + 2 : sw}
                                vectorEffect="non-scaling-stroke"
                                onPointerDown={(e) => pick(e)}
                              />
                            )}
                            {item.kind === 'count' &&
                              m.points.map((p, i) => (
                                <g key={i} onPointerDown={(e) => pick(e, i)}>
                                  <circle cx={p[0]} cy={p[1]} r={isSel && selected?.point === i ? r * 1.6 : r} fill={item.color} fillOpacity={0.85} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                                  <text x={p[0] + r * 1.3} y={p[1] - r * 0.8} fontSize={fontSize * 0.85} fill={item.color} fontWeight={700} style={{ pointerEvents: 'none' }}>
                                    {i + 1}
                                  </text>
                                </g>
                              ))}
                            {item.kind !== 'count' && (
                              <text x={lx} y={ly} fontSize={fontSize} fill={item.color} fontWeight={700} textAnchor="middle" paintOrder="stroke" stroke="#fff" strokeWidth={3 / zoom} style={{ pointerEvents: 'none' }}>
                                {label}
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {/* Shape being drawn */}
                      {tool === 'measure' && activeItem && draft.length > 0 && (
                        <g style={{ pointerEvents: 'none' }}>
                          {isOutlineKind(activeItem.kind) ? (
                            <polygon points={[...draft, ...(cursor ? [cursor] : [])].map((p) => p.join(',')).join(' ')} fill={activeItem.color} fillOpacity={0.15} stroke={activeItem.color} strokeDasharray={deductMode ? '6 4' : '4 3'} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
                          ) : (
                            <polyline points={[...draft, ...(cursor ? [cursor] : [])].map((p) => p.join(',')).join(' ')} fill="none" stroke={activeItem.color} strokeDasharray="4 3" strokeWidth={sw} vectorEffect="non-scaling-stroke" />
                          )}
                          {draft.map((p, i) => (
                            <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 && isOutlineKind(activeItem.kind) ? r * 1.4 : r * 0.7} fill="#fff" stroke={activeItem.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                          ))}
                          {cursor && pageScale && (
                            <text x={cursor[0] + 10 / zoom} y={cursor[1] - 10 / zoom} fontSize={fontSize} fill="#0f172a" fontWeight={700} paintOrder="stroke" stroke="#fff" strokeWidth={3 / zoom}>
                              {activeItem.kind === 'length'
                                ? `${fmt(measuredValue({ id: '', itemId: '', page, points: [...draft, cursor] }, 'length', pageScale) ?? 0)} ม.`
                                : `${fmt(polygonArea([...draft, cursor]) * pageScale.metersPerUnit ** 2)} ตร.ม.`}
                            </text>
                          )}
                        </g>
                      )}

                      {/* Calibration line */}
                      {tool === 'calibrate' && calibration && (
                        <g style={{ pointerEvents: 'none' }}>
                          <line x1={calibration.a[0]} y1={calibration.a[1]} x2={(calibration.a === calibration.b ? cursor : calibration.b)?.[0] ?? calibration.a[0]} y2={(calibration.a === calibration.b ? cursor : calibration.b)?.[1] ?? calibration.a[1]} stroke="#f59e0b" strokeWidth={sw + 1} vectorEffect="non-scaling-stroke" />
                          <circle cx={calibration.a[0]} cy={calibration.a[1]} r={r} fill="#f59e0b" />
                          {calibration.a !== calibration.b && <circle cx={calibration.b[0]} cy={calibration.b[1]} r={r} fill="#f59e0b" />}
                        </g>
                      )}
                    </svg>
                  )}
                </div>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Side panel */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white xl:w-96">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {/* Scale */}
            <section className="rounded-xl border border-slate-200 p-3">
              <h3 className="flex items-center gap-1.5 font-bold text-slate-900">
                <Ruler className="h-3.5 w-3.5 text-brand" /> สเกลของหน้า {pdf ? page : ''}
              </h3>
              <p className={`mt-1 ${pageScale ? 'text-slate-700' : 'font-semibold text-amber-700'}`}>{pageScale ? `ใช้สเกล ${pageScale.label}` : 'ยังไม่ได้ตั้งสเกล'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <select
                  value=""
                  disabled={!pdf}
                  onChange={(e) => e.target.value && setScale(scaleFromRatio(Number(e.target.value)), false)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 disabled:opacity-40"
                  aria-label="สเกลตามแบบ"
                >
                  <option value="">สเกลตามแบบ...</option>
                  {COMMON_RATIOS.map((n) => (
                    <option key={n} value={n}>
                      1:{n}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={!pdf} onClick={() => { setTool('calibrate'); setCalibration(null); setDraft([]); }} className="rounded-lg border border-slate-200 px-2 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                  วัดเทียบระยะจริง
                </button>
                {pageScale && pageCount > 1 && (
                  <button type="button" onClick={() => setScale(pageScale, true)} className="rounded-lg px-2 py-1.5 font-semibold text-brand hover:bg-blue-50">
                    ใช้กับทุกหน้า
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">สเกลตามแบบใช้ได้เมื่อสั่งพิมพ์ตามสเกลจริง (ไม่ได้ย่อให้พอดีกระดาษ) ถ้าไม่แน่ใจให้ใช้ &quot;วัดเทียบระยะจริง&quot; กับเส้นบอกระยะบนแบบ</p>
              {tool === 'calibrate' && calibration && calibration.a !== calibration.b && (
                <div className="mt-2 space-y-1.5 rounded-lg bg-amber-50 p-2">
                  <label className="block font-semibold text-amber-900">
                    เส้นที่คลิกยาวจริงกี่เมตร
                    <input autoFocus type="number" step="any" min={0} value={calibrationMeters} onChange={(e) => setCalibrationMeters(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyCalibration(false)} className="mt-1 w-full rounded-lg border border-amber-300 px-2 py-1.5 text-right" placeholder="เช่น 6.00" />
                  </label>
                  <div className="flex gap-1.5">
                    <button type="button" disabled={!(Number(calibrationMeters) > 0)} onClick={() => applyCalibration(false)} className="flex-1 rounded-lg bg-amber-600 px-2 py-1.5 font-semibold text-white disabled:opacity-40">
                      ใช้กับหน้านี้
                    </button>
                    {pageCount > 1 && (
                      <button type="button" disabled={!(Number(calibrationMeters) > 0)} onClick={() => applyCalibration(true)} className="flex-1 rounded-lg border border-amber-400 px-2 py-1.5 font-semibold text-amber-800 disabled:opacity-40">
                        ใช้กับทุกหน้า
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Items */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-bold text-slate-900">รายการถอดแบบ</h3>
                <span className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setElementOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-brand px-2.5 py-1.5 font-semibold text-brand hover:bg-blue-50"
                  title="ผนัง พื้น เสา คาน ห้อง หลังคา: วัดครั้งเดียวได้ทุกรายการของชิ้นส่วน"
                >
                  <Layers className="h-3.5 w-3.5" /> ชิ้นส่วน
                </button>
                <button
                  type="button"
                  onClick={() => setItemDialog({ item: emptyItem('length', ITEM_COLORS[data.items.length % ITEM_COLORS.length]!, activeItem?.category ?? ''), isNew: true })}
                  className="flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 font-semibold text-white hover:bg-brand-hover"
                >
                  <Plus className="h-3.5 w-3.5" /> เพิ่มรายการ
                </button>
                </span>
              </div>
              {data.items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-slate-500">ยังไม่มีรายการ กด &quot;เพิ่มรายการ&quot; เช่น ผนังก่ออิฐ (วัดระยะ) พื้นกระเบื้อง (วัดพื้นที่) หรือดวงโคม (นับจำนวน)</p>
              ) : (
                <div className="space-y-3">
                  {groups.map((g) => (
                    <div key={g.category}>
                      <p className="mb-1 font-semibold text-slate-500">{g.category}</p>
                      <ul className="space-y-1">
                        {g.items.map((item) => {
                          const q = quantities.get(item.id)!;
                          const active = item.id === activeItemId;
                          const ms = data.measurements.filter((m) => m.itemId === item.id);
                          return (
                            <li key={item.id} className={`rounded-lg border ${active ? 'border-brand bg-blue-50/60' : 'border-slate-200'}`}>
                              <div className="flex items-start gap-2 px-2 py-1.5">
                                <button type="button" onClick={() => pickItem(item)} className="flex min-w-0 flex-1 items-start gap-2 text-left" title="เลือกแล้วคลิกบนแบบเพื่อวัด">
                                  <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ background: item.color }} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-semibold text-slate-900">{item.description}</span>
                                    <span className="text-slate-500">
                                      {item.sourceItemId ? `ตาม "${itemsById.get(item.sourceItemId)?.description ?? '-'}"` : kindLabel(item.kind)}
                                      {item.basis === 'perimeter' ? ' (เส้นรอบรูป)' : ''}
                                      {item.factor !== 1 ? ` × ${item.factor}` : ''}
                                      {item.deductQty ? ` − ${fmt(item.deductQty, 2)}` : ''}
                                      {item.wastePercent ? ` + เผื่อ ${item.wastePercent}%` : ''}
                                      {item.fixedQty ? ` · จากแบบ ${fmt(item.fixedQty, 2)}` : ''} · {q.measurementCount} ครั้ง
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-right font-mono font-semibold text-slate-900">
                                    {fmt(q.qty, item.kind === 'count' && item.factor === 1 && !item.wastePercent ? 0 : 2)}
                                    <span className="ml-0.5 font-sans font-normal text-slate-500">{item.unit}</span>
                                    {(item.materialRate !== '' || item.laborRate !== '') && (
                                      <span className="block font-sans font-normal text-emerald-700" title={`วัสดุ ${item.materialRate === '' ? '-' : fmt(item.materialRate)} + แรง ${item.laborRate === '' ? '-' : fmt(item.laborRate)} บาท/${item.unit}`}>
                                        {fmt(itemAmount(item, q.qty))} บ.
                                      </span>
                                    )}
                                  </span>
                                </button>
                                <button type="button" onClick={() => setItemDialog({ item, isNew: false })} className="rounded p-0.5 text-slate-400 hover:text-slate-700" title="แก้ไขรายการ">
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {q.unscaled > 0 && <p className="px-2 pb-1 font-semibold text-amber-700">มี {q.unscaled} ครั้งอยู่บนหน้าที่ยังไม่ตั้งสเกล จึงยังไม่นับ</p>}
                              {active && ms.length > 0 && (
                                <ul className="max-h-40 overflow-y-auto border-t border-slate-200 px-2 py-1">
                                  {ms.map((m, i) => (
                                    <li key={m.id} className={`flex items-center justify-between gap-2 rounded px-1 py-0.5 ${selected?.id === m.id ? 'bg-amber-50' : ''}`}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          goPage(m.page);
                                          setSelected({ id: m.id });
                                          setTool('select');
                                        }}
                                        className="flex-1 text-left text-slate-600 hover:text-slate-900"
                                      >
                                        #{i + 1} · หน้า {m.page} · {measurementLabel(m, item, data)}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => change((d) => ({ ...d, measurements: d.measurements.filter((x) => x.id !== m.id) }))}
                                        className="text-slate-300 hover:text-red-600"
                                        title="ลบการวัดนี้"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Summary */}
          {data.items.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-slate-700">มูลค่ารวม (วัสดุ + ค่าแรง)</span>
                <span className="font-mono text-sm font-bold text-slate-900">{fmt(grandTotal)} บาท</span>
              </div>
              {unscaledTotal > 0 && <p className="mt-1 font-semibold text-amber-700">ยังมี {unscaledTotal} การวัดที่ไม่ถูกนับเพราะหน้ายังไม่ตั้งสเกล</p>}
              {doc.sentAt && <p className="mt-1 text-emerald-700">ส่งเข้า {doc.sentBoqNumber} แล้ว</p>}
            </div>
          )}
        </aside>
      </div>

      {itemDialog && (
        <ItemDialog
          item={itemDialog.item}
          isNew={itemDialog.isNew}
          categories={categories}
          onSave={(item) => saveItem(item, itemDialog.isNew)}
          onDelete={() => deleteItem(itemDialog.item)}
          onClose={() => setItemDialog(null)}
        />
      )}
      {autoOpen && pdf && (
        <AutoTakeoffDialog
          pdf={pdf}
          pageCount={pageCount}
          currentPage={page}
          scales={data.scales}
          measurementCount={data.measurements.length}
          existing={existingForAi}
          onSetScales={setScalesByPage}
          onAdd={addAutoGroups}
          onClose={() => setAutoOpen(false)}
        />
      )}
      {ifcOpen && <IfcImportDialog existing={existingForAi} onAdd={(items) => addArchicadItems(items, 'ไฟล์ IFC')} onClose={() => setIfcOpen(false)} />}
      {archicadOpen && <ArchicadDialog existing={existingForAi} onAdd={addArchicadItems} onClose={() => setArchicadOpen(false)} />}
      {aiOpen && pdf && (
        <AiTakeoffDialog
          takeoffId={doc.id}
          pdf={pdf}
          pageCount={pageCount}
          currentPage={page}
          scales={data.scales}
          existing={existingForAi}
          onAdd={addAiItems}
          onClose={() => setAiOpen(false)}
        />
      )}
      {cadOpen && <CadImportDialog categories={categories} existing={existingForAi} onAdd={addCadItems} onClose={() => setCadOpen(false)} />}
      {pricing && (
        <PricingDialog
          takeoffId={doc.id}
          items={data.items}
          quantities={quantities}
          focusIds={pricing.focusIds}
          onApply={applyPrices}
          onClose={() => setPricing(null)}
        />
      )}
      {elementOpen && (
        <ElementDialog
          categories={categories}
          defaultCategory={activeItem?.category ?? ''}
          newId={newId}
          colorOf={() => ITEM_COLORS[data.items.length % ITEM_COLORS.length]!}
          onAdd={addElementItems}
          onClose={() => setElementOpen(false)}
        />
      )}
      {sending && (
        <SendDialog
          takeoff={doc}
          projects={projects}
          total={grandTotal}
          lineCount={toBoqLines(data).length}
          onClose={() => setSending(false)}
          onSent={(boqNumber, pid) => {
            setSending(false);
            setDoc((d) => ({ ...d, sentAt: new Date().toISOString(), sentBoqNumber: boqNumber, projectId: d.projectId ?? pid }));
            if (!projectId) setProjectId(pid);
            setNotice(`เพิ่มรายการเข้า ${boqNumber} แล้ว เปิดดูได้ที่หน้า BOQ ของโครงการ`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
