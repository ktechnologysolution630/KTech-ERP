'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { AlertCircle, Loader2, ScanLine, X } from 'lucide-react';
import { defaultUnitOf, type PageScale, type TakeoffKind } from '@/domain/boq-takeoff';
import {
  groupQuantity,
  groupVectors,
  measurementCountOf,
  scaleFromText,
  type AutoGroup,
  type AutoGroupType,
  type PageVectors,
} from '@/domain/vector-takeoff';
import { extractPageVectors } from '@/lib/pdf-vectors';

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

const TYPE_TABS: { type: AutoGroupType | 'all'; label: string }[] = [
  { type: 'all', label: 'ทั้งหมด' },
  { type: 'line', label: 'เส้น (ความยาว)' },
  { type: 'shape', label: 'พื้นที่' },
  { type: 'symbol', label: 'สัญลักษณ์ (นับ)' },
  { type: 'tag', label: 'ป้ายชื่อ (นับ)' },
];

const fmt = (n: number, d = 2) => n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

async function loadOps() {
  const pdfjs = await import('pdfjs-dist');
  return pdfjs.OPS as unknown as Record<string, number>;
}

/** The page with the group drawn over it, so the user can see what a group is before naming it */
function GroupPreview({ pdf, group }: { pdf: PDFDocumentProxy; group: AutoGroup }) {
  const page = [...group.pages.keys()][0]!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let task: RenderTask | null = null;
    let cancelled = false;
    void (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(2, 1400 / base.width);
      const vp = p.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      setSize({ w: base.width, h: base.height });
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
  }, [pdf, page]);
  const items = group.pages.get(page) ?? [];
  const sw = size ? size.w / 500 : 1;
  return (
    <div>
      <p className="mb-1 font-semibold text-slate-700">
        ตัวอย่างบนหน้า {page} <span className="font-normal text-slate-500">(สีชมพูคือส่วนที่อยู่ในกลุ่มนี้)</span>
      </p>
      <div className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        <canvas ref={canvasRef} className="block h-auto w-full opacity-60" />
        {size && (
          <svg viewBox={`0 0 ${size.w} ${size.h}`} className="pointer-events-none absolute inset-0 h-full w-full">
            {items.slice(0, 5000).map((pts, i) =>
              group.kind === 'count' ? (
                <circle key={i} cx={pts[0]![0]} cy={pts[0]![1]} r={sw * 4} fill="#ec4899" fillOpacity={0.5} stroke="#be185d" strokeWidth={sw} />
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

export function AutoTakeoffDialog({ pdf, pageCount, currentPage, scales, measurementCount, onSetScales, onAdd, onClose }: {
  pdf: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  scales: Record<string, PageScale>;
  /** Measurements the take-off already holds */
  measurementCount: number;
  onSetScales: (ratioByPage: Record<number, number>) => void;
  onAdd: (groups: AutoPickedGroup[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<PageMode>(pageCount > 1 ? 'all' : 'current');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(pageCount, MAX_AUTO_PAGES));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [vectors, setVectors] = useState<PageVectors[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AutoGroupType | 'all'>('all');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [category, setCategory] = useState('');
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
    setPreviewKey(null);
    stopRef.current = false;
    try {
      const OPS = await loadOps();
      const out: PageVectors[] = [];
      for (let i = 0; i < pages.length; i++) {
        if (stopRef.current) break;
        setProgress({ done: i, total: pages.length });
        const p = await pdf.getPage(pages[i]!);
        out.push(await extractPageVectors(p, pages[i]!, OPS));
        p.cleanup();
      }
      setVectors(out);
    } catch (err) {
      console.error(err);
      setError('อ่านไฟล์ไม่สำเร็จ ไฟล์อาจเป็นภาพสแกน (ไม่มีเส้นแบบ CAD) ลองใช้การวัดเอง หรือ AI ถอดแบบ');
    } finally {
      setProgress(null);
      setRunning(false);
    }
  };

  const groups = useMemo(() => (vectors ? groupVectors(vectors) : []), [vectors]);
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
      list.sort((a, b) => (type === 'line' || type === 'shape' ? quantities.get(b.key)!.qty - quantities.get(a.key)!.qty || b.count - a.count : b.count - a.count));
      sorted.push(...list.filter((g) => type !== 'symbol' || g.count >= 2).slice(0, SHOW_PER_TYPE));
    }
    return sorted;
  }, [groups, tab, quantities]);

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

  const rowOf = (g: AutoGroup): RowState => rows[g.key] ?? { picked: false, description: '', category: '', unit: defaultUnitOf(g.kind), factor: 1 };
  const setRow = (g: AutoGroup, patch: Partial<RowState>) => setRows((r) => ({ ...r, [g.key]: { ...rowOf(g), ...patch } }));

  const picked = groups.filter((g) => rows[g.key]?.picked);
  const newMeasurements = picked.reduce((n, g) => n + measurementCountOf(g), 0);
  const overLimit = measurementCount + newMeasurements > MAX_MEASUREMENTS;
  const missingName = picked.some((g) => !rows[g.key]!.description.trim());
  const preview = groups.find((g) => g.key === previewKey) ?? null;

  const unitHint = (kind: TakeoffKind) => (kind === 'length' ? 'ม.' : kind === 'area' ? 'ตร.ม.' : 'จุด');

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
          {tooMany && <p className="font-semibold text-amber-700">อ่านได้ครั้งละไม่เกิน {MAX_AUTO_PAGES} หน้า กรุณาเลือกช่วงหน้า</p>}
          {!vectors && !running && (
            <p className="text-slate-500">
              ระบบอ่านเส้น รูป สัญลักษณ์ และตัวหนังสือที่อยู่ในไฟล์ PDF จาก CAD โดยตรง (ไม่ใช้อินเทอร์เน็ตและไม่มีค่าใช้จ่าย) แล้วจัดกลุ่มตามสีและความหนาของเส้น ซึ่งมักตรงกับเลเยอร์ใน CAD
              เลือกกลุ่มที่เป็นงานจริง ตั้งชื่อรายการ แล้วระบบจะสร้างรายการพร้อมการวัดบนแบบให้ทั้งหมด ไฟล์ที่เป็นภาพสแกนอ่านแบบนี้ไม่ได้
            </p>
          )}
          {progress && (
            <p className="flex items-center gap-1.5 font-semibold text-brand">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังอ่านหน้า {progress.done + 1}/{progress.total}
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
                  <AlertCircle className="h-3.5 w-3.5" /> ไม่พบเส้นแบบในหน้าที่อ่าน ไฟล์นี้น่าจะเป็นภาพสแกน ให้ใช้การวัดเองหรือ AI ถอดแบบ
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

              <div className="flex flex-wrap items-center gap-1.5">
                {TYPE_TABS.map((t) => (
                  <button key={t.type} type="button" onClick={() => setTab(t.type)} className={`rounded-full px-3 py-1 font-semibold ${tab === t.type ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {t.label} {t.type !== 'all' && `(${groups.filter((g) => g.type === t.type).length})`}
                  </button>
                ))}
                <label className="ml-auto flex items-center gap-1">
                  หมวดงานของรายการที่เลือก
                  <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="เช่น งานสถาปัตยกรรม" className="w-44 rounded-lg border border-slate-300 px-2 py-1" />
                </label>
              </div>

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
              <p className="text-slate-500">
                เคล็ดลับ: เส้นผนังมักเป็นเส้นหนาที่สุด ใส่ความสูงผนังในช่องตัวคูณเพื่อได้ ตร.ม. (เปลี่ยนหน่วยเป็น ตร.ม.) · สัญลักษณ์ขนาดเท่ากันคือของชนิดเดียวกัน เช่น โคมไฟ ปลั๊ก · ป้ายเช่น D1 W1 นับประตูหน้าต่าง
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <span className={overLimit ? 'font-semibold text-red-700' : 'text-slate-500'}>
            {picked.length > 0 &&
              (overLimit
                ? `การวัดเกินที่งานถอดแบบหนึ่งงานเก็บได้ (${MAX_MEASUREMENTS.toLocaleString('th-TH')} ครั้ง) กรุณาเลือกกลุ่มให้น้อยลง หรือแยกเป็นงานถอดแบบหลายงาน`
                : `จะสร้างการวัด ${newMeasurements.toLocaleString('th-TH')} ครั้ง${missingName ? ' · ใส่ชื่อรายการให้ครบทุกกลุ่มที่เลือก' : ''}`)}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={running} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              ปิด
            </button>
            <button
              type="button"
              disabled={running || picked.length === 0 || missingName || overLimit}
              onClick={() =>
                onAdd(
                  picked.map((g) => {
                    const r = rows[g.key]!;
                    return { group: g, description: r.description.trim(), category: category.trim(), unit: r.unit.trim() || defaultUnitOf(g.kind), factor: r.factor };
                  }),
                )
              }
              className="rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              เพิ่ม {picked.length} รายการเข้างานถอดแบบ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
