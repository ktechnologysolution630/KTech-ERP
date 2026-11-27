'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { AlertCircle, Loader2, ScanLine, Wand2, X } from 'lucide-react';
import { defaultUnitOf, type PageScale, type TakeoffKind } from '@/domain/boq-takeoff';
import {
  groupQuantity,
  groupVectors,
  measurementCountOf,
  scaleFromText,
  suggestNames,
  withoutLegend,
  type AutoGroup,
  type AutoGroupType,
  type NameSuggestion,
  type PageVectors,
} from '@/domain/vector-takeoff';
import { extractTextItems, type TextQtyItem } from '@/domain/text-takeoff';
import { findInTakeoff, type ExistingItem } from '@/domain/ai-takeoff-merge';
import { extractPageVectors } from '@/lib/pdf-vectors';
import type { AiPickedItem } from '@/components/boq-ai-takeoff-dialog';
import { looksScanned, ScanReader } from '@/lib/scan-vectors';

/** One run reads at most this many pages */
export const MAX_AUTO_PAGES = 200;
/** A saved take-off holds at most this many measurements */
const MAX_MEASUREMENTS = 20_000;
const SHOW_PER_TYPE = 40;

export interface AutoPickedGroup {
  group: AutoGroup;
  description: string;
  category: string;
  unit: string;
  factor: number;
}

interface RowState {
  picked: boolean;
  description: string;
  category: string;
  unit: string;
  factor: number;
}

type PageMode = 'current' | 'all' | 'range';

type TabType = AutoGroupType | 'all' | 'text';

const TYPE_TABS: { type: TabType; label: string }[] = [
  { type: 'all', label: 'ทั้งหมด' },
  { type: 'line', label: 'เส้น (ความยาว)' },
  { type: 'shape', label: 'พื้นที่' },
  { type: 'symbol', label: 'สัญลักษณ์ (นับ)' },
  { type: 'tag', label: 'ป้ายชื่อ (นับ)' },
  { type: 'text', label: 'ปริมาณที่เขียนบนแบบ' },
];

interface TextRow {
  picked: boolean;
  description: string;
  unit: string;
  qty: number;
}

const fmt = (n: number, d = 2) => n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

const linesOf = (pages: PageVectors[]) => pages.flatMap((v) => (v.lines ?? []).map((text) => ({ page: v.page, text })));

async function loadOps() {
  const pdfjs = await import('pdfjs-dist');
  return pdfjs.OPS as unknown as Record<string, number>;
}

/** The page with the group drawn over it, so the user can see what a group is before naming it */
function GroupPreview({ pdf, group }: { pdf: PDFDocumentProxy; group: AutoGroup }) {
  const page = [...group.pages.keys()][0]!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const items = group.pages.get(page) ?? [];
  useEffect(() => {
    let task: RenderTask | null = null;
    let cancelled = false;
    void (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      // Zoom to where the group is, with some of the drawing around it
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const pts of items) for (const [x, y] of pts) [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
      const pad = Math.max(30, (maxX - minX + maxY - minY) * 0.1);
      const x = Math.max(0, minX - pad),
        y = Math.max(0, minY - pad);
      const w = Math.min(base.width, maxX + pad) - x,
        h = Math.min(base.height, maxY + pad) - y;
      const b = Number.isFinite(w) && w > 0 && h > 0 ? { x, y, w, h } : { x: 0, y: 0, w: base.width, h: base.height };
      const scale = Math.min(6, 1400 / b.w);
      const vp = p.getViewport({ scale, offsetX: -b.x * scale, offsetY: -b.y * scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(b.w * scale);
      canvas.height = Math.floor(b.h * scale);
      setBox(b);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = p.render({ canvasContext: ctx, viewport: vp });
      try {
        await task.promise;
      } catch {
        // replaced by a newer preview
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // items belong to the group, which is fixed for this preview (it is keyed by group)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, page]);
  const sw = box ? box.w / 400 : 1;
  return (
    <div>
      <p className="mb-1 font-semibold text-slate-700">
        ตัวอย่างบนหน้า {page} <span className="font-normal text-slate-500">(สีชมพูคือส่วนที่อยู่ในกลุ่มนี้)</span>
      </p>
      <div className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        <canvas ref={canvasRef} className="block h-auto w-full opacity-60" />
        {box && (
          <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="pointer-events-none absolute inset-0 h-full w-full">
            {items.slice(0, 5000).map((pts, i) =>
              group.kind === 'count' ? (
                <circle key={i} cx={pts[0]![0]} cy={pts[0]![1]} r={sw * 8} fill="#ec4899" fillOpacity={0.45} stroke="#be185d" strokeWidth={sw} />
              ) : (
                <polyline
                  key={i}
                  points={pts.map((p) => p.join(',')).join(' ')}
                  fill={group.kind === 'area' ? '#ec4899' : 'none'}
                  fillOpacity={0.35}
                  stroke="#db2777"
                  strokeWidth={sw * 1.6}
                  strokeLinejoin="round"
                />
              ),
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

export function AutoTakeoffDialog({ pdf, pageCount, currentPage, scales, measurementCount, existing = [], onSetScales, onAdd, onClose }: {
  pdf: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  scales: Record<string, PageScale>;
  /** Measurements the take-off already holds */
  measurementCount: number;
  /** Items the take-off already holds, so a written total read again is not added twice */
  existing?: ExistingItem[];
  onSetScales: (ratioByPage: Record<number, number>) => void;
  /** Groups become items with measurements; quantities written on the drawing become items with that quantity */
  onAdd: (groups: AutoPickedGroup[], written: AiPickedItem[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<PageMode>(pageCount > 1 ? 'all' : 'current');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(pageCount, MAX_AUTO_PAGES));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [vectors, setVectors] = useState<PageVectors[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabType>('all');
  const [textRows, setTextRows] = useState<Record<string, TextRow>>({});
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [ocr, setOcr] = useState(true);
  const [scanning, setScanning] = useState(false);
  const stopRef = useRef(false);

  const pages = useMemo(() => {
    if (mode === 'current') return [currentPage];
    const a = mode === 'all' ? 1 : Math.max(1, Math.min(from, to));
    const b = mode === 'all' ? pageCount : Math.min(pageCount, Math.max(from, to));
    return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  }, [mode, currentPage, from, to, pageCount]);
  const tooMany = pages.length > MAX_AUTO_PAGES;

  const run = async () => {
    setRunning(true);
    setError(null);
    setVectors(null);
    setRows({});
    setTextRows({});
    setPreviewKey(null);
    stopRef.current = false;
    try {
      const OPS = await loadOps();
      const results: (PageVectors | undefined)[] = new Array(pages.length);
      const scan = new ScanReader();
      // Scanned pages wait on OCR, so a few are read side by side; the rest go one by one
      const pending = new Set<Promise<void>>();
      let done = 0;
      const finished = () => setProgress({ done: ++done, total: pages.length });
      setProgress({ done: 0, total: pages.length });
      try {
        for (let i = 0; i < pages.length; i++) {
          if (stopRef.current) break;
          const n = pages[i]!;
          const p = await pdf.getPage(n);
          const v = await extractPageVectors(p, n, OPS);
          if (!looksScanned(v)) {
            results[i] = v;
            p.cleanup();
            finished();
            continue;
          }
          setScanning(true);
          const job: Promise<void> = scan
            .read(p, n, ocr)
            .then((r) => void (results[i] = r))
            .catch((err: unknown) => {
              console.error(err);
              results[i] = v;
            })
            .finally(() => {
              p.cleanup();
              pending.delete(job);
              finished();
            });
          pending.add(job);
          if (pending.size >= (ocr ? 3 : 1)) await Promise.race(pending);
        }
        await Promise.all(pending);
      } finally {
        scan.stop();
      }
      const out = results.filter((v): v is PageVectors => Boolean(v));
      setVectors(out);
      setTab(extractTextItems(linesOf(out)).length > 0 ? 'text' : 'all');
    } catch (err) {
      console.error(err);
      setError('อ่านไฟล์ไม่สำเร็จ ลองอ่านทีละช่วงหน้า หรือใช้การวัดเอง');
    } finally {
      setProgress(null);
      setScanning(false);
      setRunning(false);
    }
  };

  const { groups, suggestions } = useMemo(() => {
    if (!vectors) return { groups: [] as AutoGroup[], suggestions: new Map<string, NameSuggestion>() };
    const raw = groupVectors(vectors);
    const sug = suggestNames(raw, vectors);
    return { groups: raw.map((g) => withoutLegend(g, sug.get(g.key))).filter((g) => g.count > 0), suggestions: sug };
  }, [vectors]);
  const textItems = useMemo(() => (vectors ? extractTextItems(linesOf(vectors)) : []), [vectors]);
  // A written total the take-off already has (from an earlier run, AI or CAD) starts unticked
  const textInTakeoff = useMemo(() => {
    const hits = findInTakeoff(textItems, existing);
    return new Map(textItems.map((t, i) => [t.key, hits[i] ?? null]));
    // existing changes as items are measured; what was there when the sheets were read is what counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textItems]);
  const textRowOf = (t: TextQtyItem): TextRow => textRows[t.key] ?? { picked: !textInTakeoff.get(t.key), description: t.description, unit: t.unit, qty: t.qty };
  const setTextRow = (t: TextQtyItem, patch: Partial<TextRow>) => setTextRows((r) => ({ ...r, [t.key]: { ...textRowOf(t), ...patch } }));
  const quantities = useMemo(() => new Map(groups.map((g) => [g.key, groupQuantity(g, scales)])), [groups, scales]);
  const shown = useMemo(() => {
    const byType = new Map<AutoGroupType, AutoGroup[]>();
    for (const g of groups) {
      const list = byType.get(g.type) ?? [];
      list.push(g);
      byType.set(g.type, list);
    }
    const sorted: AutoGroup[] = [];
    for (const type of ['line', 'shape', 'symbol', 'tag'] as AutoGroupType[]) {
      if (tab !== 'all' && tab !== type) continue;
      const list = byType.get(type) ?? [];
      // Lines and areas by size (unscaled pages still rank by count), symbols and tags by how many
      list.sort((a, b) => Number(suggestions.has(b.key)) - Number(suggestions.has(a.key)) || (type === 'line' || type === 'shape' ? quantities.get(b.key)!.qty - quantities.get(a.key)!.qty || b.count - a.count : b.count - a.count));
      sorted.push(...list.filter((g) => type !== 'symbol' || g.count >= 2 || suggestions.has(g.key)).slice(0, SHOW_PER_TYPE));
    }
    return sorted;
  }, [groups, tab, quantities, suggestions]);

  const applySuggestions = () =>
    setRows((r) => {
      const next = { ...r };
      for (const g of groups) {
        const sug = suggestions.get(g.key);
        if (!sug) continue;
        const cur = next[g.key] ?? { picked: false, description: '', category: '', unit: defaultUnitOf(g.kind), factor: 1 };
        next[g.key] = { ...cur, picked: true, description: cur.description.trim() || sug.description, unit: cur.description.trim() ? cur.unit : sug.unit };
      }
      return next;
    });

  // Scale written on sheets that have no scale set yet
  const foundScales = useMemo(() => {
    const found: Record<number, number> = {};
    for (const v of vectors ?? []) {
      if (scales[String(v.page)]) continue;
      const n = scaleFromText(v.texts);
      if (n) found[v.page] = n;
    }
    return found;
  }, [vectors, scales]);
  const foundList = Object.entries(foundScales);
  const unscaledRead = (vectors ?? []).filter((v) => !scales[String(v.page)]).length;
  const truncatedPages = (vectors ?? []).filter((v) => v.truncated).map((v) => v.page);
  const emptyDrawing = vectors !== null && vectors.every((v) => v.paths.length === 0);
  const scannedPages = (vectors ?? []).filter((v) => v.scanned).length;

  const rowOf = (g: AutoGroup): RowState => rows[g.key] ?? { picked: false, description: '', category: '', unit: defaultUnitOf(g.kind), factor: 1 };
  const setRow = (g: AutoGroup, patch: Partial<RowState>) => setRows((r) => ({ ...r, [g.key]: { ...rowOf(g), ...patch } }));

  const picked = groups.filter((g) => rows[g.key]?.picked);
  const newMeasurements = picked.reduce((n, g) => n + measurementCountOf(g), 0);
  const overLimit = measurementCount + newMeasurements > MAX_MEASUREMENTS;
  const pickedText = textItems.filter((t) => textRowOf(t).picked);
  const missingName = picked.some((g) => !rows[g.key]!.description.trim()) || pickedText.some((t) => !textRowOf(t).description.trim() || !(textRowOf(t).qty > 0));
  const pickedCount = picked.length + pickedText.length;
  const preview = groups.find((g) => g.key === previewKey) ?? null;

  const unitHint = (kind: TakeoffKind) => defaultUnitOf(kind);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="ถอดแบบอัตโนมัติ">
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <ScanLine className="h-4 w-4 text-brand" /> ถอดแบบอัตโนมัติจากเส้นในไฟล์ PDF
          </h3>
          <button type="button" onClick={onClose} disabled={running} className="text-slate-400 hover:text-slate-600 disabled:opacity-40" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-semibold text-slate-700">หน้าที่จะอ่าน</span>
            {([
              ['current', `หน้านี้ (${currentPage})`],
              ['all', `ทุกหน้า (${pageCount})`],
              ['range', 'เลือกช่วงหน้า'],
            ] as [PageMode, string][]).map(([m, label]) => (
              <button key={m} type="button" disabled={running} onClick={() => setMode(m)} className={`rounded-lg border px-2.5 py-1.5 font-semibold ${mode === m ? 'border-brand bg-blue-50 text-brand' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
            {mode === 'range' && (
              <span className="flex items-center gap-1">
                <input type="number" min={1} max={pageCount} value={from} disabled={running} onChange={(e) => setFrom(Number(e.target.value) || 1)} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-right" aria-label="จากหน้า" />
                ถึง
                <input type="number" min={1} max={pageCount} value={to} disabled={running} onChange={(e) => setTo(Number(e.target.value) || 1)} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-right" aria-label="ถึงหน้า" />
              </span>
            )}
            <button type="button" onClick={run} disabled={running || tooMany || pages.length === 0} className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
              {vectors ? 'อ่านแบบใหม่' : `อ่านแบบ ${pages.length} หน้า`}
            </button>
          </div>
          <label className="flex w-fit items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={ocr} disabled={running} onChange={(e) => setOcr(e.target.checked)} />
            หน้าที่เป็นภาพสแกน: อ่านตัวหนังสือด้วย (ได้ปริมาณที่เขียนบนแบบ ป้าย D1 W1 และสเกล แต่ช้ากว่า หน้าละประมาณ 10–20 วินาที)
          </label>
          {tooMany && <p className="font-semibold text-amber-700">อ่านได้ครั้งละไม่เกิน {MAX_AUTO_PAGES} หน้า กรุณาเลือกช่วงหน้า</p>}
          {!vectors && !running && (
            <p className="text-slate-500">
              ระบบอ่านเส้น รูป สัญลักษณ์ และตัวหนังสือที่อยู่ในไฟล์ PDF จาก CAD โดยตรง (ไม่ใช้อินเทอร์เน็ตและไม่มีค่าใช้จ่าย) แล้วจัดกลุ่มตามสีและความหนาของเส้น ซึ่งมักตรงกับเลเยอร์ใน CAD
              เลือกกลุ่มที่เป็นงานจริง ตั้งชื่อรายการ แล้วระบบจะสร้างรายการพร้อมการวัดบนแบบให้ทั้งหมด หน้าที่เป็นภาพสแกน ระบบจะหาเส้นจากภาพและอ่านตัวหนังสือให้ (ช้ากว่าและแม่นน้อยกว่าไฟล์จาก CAD)
            </p>
          )}
          {progress && (
            <p className="flex items-center gap-1.5 font-semibold text-brand">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> อ่านแล้ว {progress.done}/{progress.total} หน้า{scanning && ' · พบภาพสแกน กำลังหาเส้นจากภาพ' + (ocr ? 'และอ่านตัวหนังสือ' : '')}
              <button type="button" onClick={() => (stopRef.current = true)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-0.5 font-normal text-slate-600 hover:bg-slate-100">
                หยุด
              </button>
            </p>
          )}
          {error && (
            <p className="flex items-center gap-1 font-semibold text-red-700">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </p>
          )}

          {vectors && (
            <>
              {emptyDrawing && (
                <p className="flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800">
                  <AlertCircle className="h-3.5 w-3.5" /> ไม่พบเส้นแบบในหน้าที่อ่าน ให้ใช้การวัดเองหรือ AI ถอดแบบ
                </p>
              )}
              {scannedPages > 0 && !emptyDrawing && (
                <p className="flex items-start gap-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {scannedPages} หน้าเป็นภาพสแกน: เส้นจากภาพเป็นสีดำทั้งหมด ระบบแยกกลุ่มได้ตามความหนาของเส้นเท่านั้น และอาจรวมเส้นกรอบชื่อแบบหรือตารางมาด้วย
                    กดแถวเพื่อดูตำแหน่งบนแบบก่อนเลือก และควรอ่านทีละช่วงหน้าที่เป็นแบบชนิดเดียวกัน เช่น เฉพาะหน้าแปลน
                  </span>
                </p>
              )}
              {unscaledRead > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>
                    มี {unscaledRead} หน้าที่ยังไม่ตั้งสเกล ความยาวและพื้นที่ของหน้าเหล่านั้นยังไม่ถูกนับ
                    {foundList.length > 0 && ` · พบสเกลเขียนบนแบบ ${foundList.length} หน้า (${[...new Set(foundList.map(([, n]) => `1:${n}`))].join(', ')})`}
                  </span>
                  {foundList.length > 0 && (
                    <button type="button" onClick={() => onSetScales(foundScales)} className="rounded-lg bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700">
                      ใช้สเกลที่พบบนแบบ
                    </button>
                  )}
                </div>
              )}
              {truncatedPages.length > 0 && <p className="text-amber-700">หน้า {truncatedPages.join(', ')} มีเส้นมากเกินไป ระบบอ่านได้เพียงบางส่วน</p>}

              {suggestions.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-slate-700">
                  <Wand2 className="h-3.5 w-3.5 text-brand" />
                  <span>
                    ระบบตั้งชื่อรายการให้ได้ {suggestions.size} กลุ่ม จากป้ายบนแบบ (เช่น D1 = ประตู) ข้อความข้างสัญลักษณ์ และเส้นผนัง
                  </span>
                  <button type="button" onClick={applySuggestions} className="ml-auto rounded-lg bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-hover">
                    ใช้ชื่อที่ระบบแนะนำ
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {TYPE_TABS.map((t) => (
                  <button key={t.type} type="button" onClick={() => setTab(t.type)} className={`rounded-full px-3 py-1 font-semibold ${tab === t.type ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {t.label} {t.type !== 'all' && `(${t.type === 'text' ? textItems.length : groups.filter((g) => g.type === t.type).length})`}
                  </button>
                ))}
                <label className="ml-auto flex items-center gap-1">
                  หมวดงานของรายการที่เลือก
                  <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="เช่น งานสถาปัตยกรรม" className="w-44 rounded-lg border border-slate-300 px-2 py-1" />
                </label>
              </div>

              {(tab === 'text' || tab === 'all') && (
                <div className="overflow-x-auto rounded-lg border border-emerald-200">
                  <div className="flex flex-wrap items-center gap-2 bg-emerald-50 px-3 py-2 text-emerald-900">
                    <span className="font-semibold">ปริมาณที่เขียนไว้บนแบบ {textItems.length} รายการ</span>
                    <span className="text-emerald-800">อ่านจากหมายเหตุบนแบบ เช่น “ยาวประมาณ 1,800 เมตร” “จำนวน 90 บ่อ” ข้อความเดียวกันที่อยู่หลายหน้านับครั้งเดียว ตรวจชื่อและตัวเลขกับแบบก่อนเพิ่ม</span>
                    {textItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const all = textItems.every((t) => textRowOf(t).picked);
                          setTextRows((r) => Object.fromEntries(textItems.map((t) => [t.key, { ...(r[t.key] ?? textRowOf(t)), picked: !all }])));
                        }}
                        className="ml-auto rounded border border-emerald-300 bg-white px-2 py-0.5 font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        {textItems.every((t) => textRowOf(t).picked) ? 'ไม่เลือกทั้งหมด' : 'เลือกทั้งหมด'}
                      </button>
                    )}
                  </div>
                  {textItems.length === 0 ? (
                    <p className="px-3 py-4 text-center text-slate-500">ไม่พบปริมาณที่เขียนไว้บนแบบในหน้าที่อ่าน{scannedPages > 0 && !ocr ? ' (ติ๊ก “อ่านตัวหนังสือ” แล้วอ่านแบบใหม่)' : ''}</p>
                  ) : (
                    <table className="w-full min-w-[46rem]">
                      <thead className="bg-slate-50 text-left text-slate-600">
                        <tr>
                          <th className="w-8 px-2 py-2" />
                          <th className="px-2 py-2">ชื่อรายการ BOQ</th>
                          <th className="px-2 py-2 text-right">ปริมาณ</th>
                          <th className="px-2 py-2">หน่วย</th>
                          <th className="px-2 py-2">อ่านได้จาก</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {textItems.map((t) => {
                          const row = textRowOf(t);
                          return (
                            <tr key={t.key} className={row.picked ? 'bg-emerald-50/40' : ''}>
                              <td className="px-2 py-1.5">
                                <input type="checkbox" checked={row.picked} onChange={(e) => setTextRow(t, { picked: e.target.checked })} aria-label={`เลือก ${t.description}`} />
                              </td>
                              <td className="px-2 py-1.5">
                                <input value={row.description} onChange={(e) => setTextRow(t, { description: e.target.value })} className="w-full min-w-[14rem] rounded border border-slate-200 px-1.5 py-1" aria-label="ชื่อรายการ BOQ" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input type="number" step="any" min={0} value={row.qty} onChange={(e) => setTextRow(t, { qty: Math.max(0, Number(e.target.value) || 0) })} className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right font-mono" aria-label="ปริมาณ" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input value={row.unit} onChange={(e) => setTextRow(t, { unit: e.target.value })} className="w-16 rounded border border-slate-200 px-1.5 py-1" aria-label="หน่วย" />
                              </td>
                              <td className="max-w-[22rem] px-2 py-1.5 text-slate-500">
                                {textInTakeoff.get(t.key) && (
                                  <span className="mr-1 inline-block rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700" title={`ในงานถอดแบบ: ${textInTakeoff.get(t.key)!.description}`}>
                                    มีในงานถอดแบบแล้ว
                                  </span>
                                )}
                                <span className="font-semibold text-slate-600">หน้า {t.pages.join(', ')}</span> · “{t.source}”
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {tab !== 'text' && (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[46rem]">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="w-8 px-2 py-2" />
                        <th className="px-2 py-2">กลุ่มที่พบ</th>
                        <th className="px-2 py-2 text-right">ปริมาณ</th>
                        <th className="px-2 py-2">ชื่อรายการ BOQ</th>
                        <th className="px-2 py-2">หน่วย</th>
                        <th className="px-2 py-2 text-right">ตัวคูณ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shown.map((g) => {
                        const row = rowOf(g);
                        const q = quantities.get(g.key)!;
                        return (
                          <tr key={g.key} onClick={() => setPreviewKey(g.key)} className={`cursor-pointer ${previewKey === g.key ? 'bg-pink-50' : row.picked ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                            <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={row.picked} onChange={(e) => setRow(g, { picked: e.target.checked })} aria-label={`เลือก ${g.label}`} />
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="flex items-center gap-1.5">
                                <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ background: g.color }} />
                                <span className="font-semibold text-slate-800">{g.label}</span>
                              </span>
                              <span className="text-slate-500">
                                {g.count.toLocaleString('th-TH')} {g.type === 'line' ? 'เส้น' : g.type === 'shape' ? 'รูป' : 'จุด'} · {g.pages.size} หน้า
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold text-slate-900">
                              {g.kind === 'count' ? q.qty.toLocaleString('th-TH') : fmt(q.qty)} <span className="font-sans font-normal text-slate-500">{unitHint(g.kind)}</span>
                              {row.factor !== 1 && (
                                <span className="block font-sans font-normal text-slate-600">
                                  × {row.factor} = {fmt(q.qty * row.factor)} {row.unit}
                                </span>
                              )}
                              {q.unscaledPages.length > 0 && <span className="block font-sans font-normal text-amber-700">ไม่รวม {q.unscaledPages.length} หน้าที่ไม่มีสเกล</span>}
                            </td>
                            <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                value={row.description}
                                onChange={(e) => setRow(g, { description: e.target.value, picked: row.picked || e.target.value.trim() !== '' })}
                                placeholder={g.kind === 'length' ? 'เช่น ผนังก่ออิฐมวลเบา' : g.kind === 'area' ? 'เช่น พื้นกระเบื้อง' : 'เช่น โคมดาวน์ไลท์'}
                                className="w-full min-w-[12rem] rounded border border-slate-200 px-1.5 py-1"
                                aria-label="ชื่อรายการ BOQ"
                              />
                              {suggestions.has(g.key) && row.description.trim() !== suggestions.get(g.key)!.description && (
                                <button
                                  type="button"
                                  onClick={() => setRow(g, { description: suggestions.get(g.key)!.description, unit: suggestions.get(g.key)!.unit, picked: true })}
                                  className="mt-0.5 block text-left text-brand hover:underline"
                                  title={suggestions.get(g.key)!.reason}
                                >
                                  แนะนำ: {suggestions.get(g.key)!.description}
                                </button>
                              )}
                            </td>
                            <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                              <input value={row.unit} onChange={(e) => setRow(g, { unit: e.target.value })} className="w-16 rounded border border-slate-200 px-1.5 py-1" aria-label="หน่วย" />
                            </td>
                            <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number"
                                step="any"
                                min={0}
                                value={row.factor}
                                onChange={(e) => setRow(g, { factor: Math.max(0, Number(e.target.value) || 0) })}
                                title={g.kind === 'length' ? 'เช่น ใส่ความสูงผนังเพื่อได้ ตร.ม.' : 'ตัวคูณ'}
                                className="w-16 rounded border border-slate-200 px-1.5 py-1 text-right"
                                aria-label="ตัวคูณ"
                              />
                            </td>
                          </tr>
                        );
                      })}
                      {shown.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                            ไม่พบกลุ่มในหมวดนี้
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div>{preview ? <GroupPreview key={preview.key} pdf={pdf} group={preview} /> : <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-slate-500">กดแถวของกลุ่มเพื่อดูว่าอยู่ตรงไหนบนแบบ</p>}</div>
              </div>
              )}
              <p className="text-slate-500">
                เคล็ดลับ: เส้นผนังมักเป็นเส้นหนาที่สุด ใส่ความสูงผนังในช่องตัวคูณเพื่อได้ ตร.ม. (เปลี่ยนหน่วยเป็น ตร.ม.) · สัญลักษณ์ขนาดเท่ากันคือของชนิดเดียวกัน เช่น โคมไฟ ปลั๊ก · ป้ายเช่น D1 W1 นับประตูหน้าต่าง
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <span className={overLimit ? 'font-semibold text-red-700' : 'text-slate-500'}>
            {pickedCount > 0 &&
              (overLimit
                ? `การวัดเกินที่งานถอดแบบหนึ่งงานเก็บได้ (${MAX_MEASUREMENTS.toLocaleString('th-TH')} ครั้ง) กรุณาเลือกกลุ่มให้น้อยลง หรือแยกเป็นงานถอดแบบหลายงาน`
                : `${picked.length > 0 ? `จะสร้างการวัด ${newMeasurements.toLocaleString('th-TH')} ครั้ง` : `ปริมาณจากข้อความบนแบบ ${pickedText.length} รายการ`}${missingName ? ' · ใส่ชื่อรายการและปริมาณให้ครบทุกรายการที่เลือก' : ''}`)}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={running} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              ปิด
            </button>
            <button
              type="button"
              disabled={running || pickedCount === 0 || missingName || overLimit}
              onClick={() =>
                onAdd(
                  picked.map((g) => {
                    const r = rows[g.key]!;
                    return { group: g, description: r.description.trim(), category: category.trim(), unit: r.unit.trim() || defaultUnitOf(g.kind), factor: r.factor };
                  }),
                  pickedText.map((t) => {
                    const r = textRowOf(t);
                    return { page: t.pages[0]!, category: category.trim(), description: r.description.trim(), kind: t.kind, unit: r.unit.trim() || t.unit, qty: r.qty, basis: `หน้า ${t.pages.join(', ')}: ${t.source}` };
                  }),
                )
              }
              className="rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              เพิ่ม {pickedCount} รายการเข้างานถอดแบบ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
