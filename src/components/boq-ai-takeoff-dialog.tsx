'use client';

import React, { useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { AlertCircle, Layers, Loader2, Sparkles, Undo2, X } from 'lucide-react';
import { PAPER_METERS_PER_UNIT, type PageScale, type TakeoffKind } from '@/domain/boq-takeoff';
import type { AiTakeoffItem } from '@/server/services/boq-ai-takeoff';
import { aiConsolidateTakeoffAction, aiReadTakeoffPageAction } from '@/app/(app)/boq-takeoff/actions';
import { checkAgainstDrawing, mergeAcrossPages, type WrittenQty } from '@/domain/ai-takeoff-merge';
import { extractTextItems, type TextLine } from '@/domain/text-takeoff';
import { PageLineReader } from '@/lib/pdf-lines';

/** Long edge of the page image sent to the AI; the drawing's small text needs a sharp image */
const IMAGE_LONG_EDGE = 2400;
/** One run reads at most this many pages, so a whole drawing set is not sent by mistake */
const MAX_PAGES_PER_RUN = 200;

export interface AiPickedItem {
  page: number;
  /** Every sheet the item was read on, when the same note appears on several */
  pages?: number[];
  category: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  qty: number;
  basis: string;
}

interface Row extends AiTakeoffItem {
  key: string;
  page: number;
  pages: number[];
  picked: boolean;
}

type PageMode = 'current' | 'all' | 'range';

const SCOPE: Record<AiTakeoffItem['scope'], { label: string; cls: string } | null> = {
  project_total: null,
  this_sheet: { label: 'เฉพาะแผ่นนี้', cls: 'bg-amber-50 text-amber-700' },
  per_unit: { label: 'ต่อ 1 หน่วย', cls: 'bg-red-50 text-red-700' },
};

const CONFIDENCE: Record<AiTakeoffItem['confidence'], { label: string; cls: string }> = {
  high: { label: 'มั่นใจ', cls: 'bg-emerald-50 text-emerald-700' },
  medium: { label: 'พอใช้', cls: 'bg-amber-50 text-amber-700' },
  low: { label: 'ควรตรวจ', cls: 'bg-red-50 text-red-700' },
};

async function pageToJpeg(pdf: PDFDocumentProxy, pageNo: number): Promise<{ base64: string; paperMm: { w: number; h: number } }> {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = IMAGE_LONG_EDGE / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  // CAD PDFs are often transparent; JPEG would turn that black
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const mm = (units: number) => (units * PAPER_METERS_PER_UNIT * 1000);
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), paperMm: { w: mm(base.width), h: mm(base.height) } };
}

export function AiTakeoffDialog({ takeoffId, pdf, pageCount, currentPage, scales, onAdd, onClose }: {
  takeoffId: string;
  pdf: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  scales: Record<string, PageScale>;
  onAdd: (items: AiPickedItem[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<PageMode>(pageCount > 1 ? 'current' : 'all');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(pageCount, MAX_PAGES_PER_RUN));
  const [hint, setHint] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; page: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  /** Items as the AI returned them, before repeats across sheets were joined */
  const [readCount, setReadCount] = useState(0);
  /** Rows as read sheet by sheet, kept while the joined BOQ list is shown so the user can go back */
  const [perSheet, setPerSheet] = useState<Row[] | null>(null);
  const [joining, setJoining] = useState(false);
  /** Quantities written in the drawing's notes, read alongside the AI to check it */
  const [checkText, setCheckText] = useState(true);
  const [written, setWritten] = useState<WrittenQty[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [joinNotes, setJoinNotes] = useState<{ text: string; error?: boolean }[]>([]);
  const [notes, setNotes] = useState<{ page: number; text: string; error?: boolean }[]>([]);
  const stopRef = useRef(false);

  const pages = useMemo(() => {
    if (mode === 'current') return [currentPage];
    const a = mode === 'all' ? 1 : Math.max(1, Math.min(from, to));
    const b = mode === 'all' ? pageCount : Math.min(pageCount, Math.max(from, to));
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }, [mode, currentPage, from, to, pageCount]);
  const tooMany = pages.length > MAX_PAGES_PER_RUN;

  const run = async () => {
    setRunning(true);
    stopRef.current = false;
    setRows([]);
    setReadCount(0);
    setPerSheet(null);
    setJoinNotes([]);
    setNotes([]);
    setWritten(null);
    // The notes on each sheet are read in the background, one page at a time, while the AI works
    const reader = checkText ? new PageLineReader() : null;
    const lines: TextLine[] = [];
    let lineChain = Promise.resolve();
    let n = 0;
    for (const p of pages) {
      if (stopRef.current) break;
      setProgress({ done: n, total: pages.length, page: p });
      if (reader) {
        lineChain = lineChain.then(() =>
          reader
            .read(pdf, p)
            .then((ls) => void lines.push(...ls.map((text) => ({ page: p, text }))))
            .catch((err: unknown) => console.error(err)),
        );
      }
      try {
        const img = await pageToJpeg(pdf, p);
        const res = await aiReadTakeoffPageAction(takeoffId, {
          page: p,
          imageBase64: img.base64,
          paperMm: img.paperMm,
          scaleLabel: scales[String(p)]?.label,
          hint: hint.trim() || undefined,
        });
        if (!res.ok) {
          setNotes((x) => [...x, { page: p, text: res.error, error: true }]);
          // Settings problems repeat on every page, so stop at the first
          if (/ตั้งค่า|API key/.test(res.error)) break;
        } else {
          const { result } = res;
          // A note repeated on several sheets is one item, not one per sheet
          setRows((x) => mergeAcrossPages([...x, ...result.items.map((it, i) => ({ ...it, key: `${p}-${i}`, page: p, picked: it.scope !== 'per_unit' }))]));
          setReadCount((c) => c + result.items.length);
          const head = [result.drawingTitle, result.scaleSeen && `สเกลบนแบบ ${result.scaleSeen}`].filter(Boolean).join(' · ');
          const text = [head, `พบ ${result.items.length} รายการ`, ...result.warnings].filter(Boolean).join(' — ');
          setNotes((x) => [...x, { page: p, text }]);
        }
      } catch (err) {
        console.error(err);
        setNotes((x) => [...x, { page: p, text: 'อ่านหน้านี้ไม่สำเร็จ (การเชื่อมต่อขัดข้อง)', error: true }]);
      }
      n++;
    }
    setProgress(null);
    if (reader) {
      setChecking(true);
      await lineChain;
      reader.stop();
      const w = extractTextItems(lines);
      setWritten(w);
      // Shares of a total the drawing writes would count it twice: they start unticked
      setRows((x) => {
        const { checks } = checkAgainstDrawing(x, w);
        return x.map((r, i) => (checks[i]?.status === 'part' ? { ...r, picked: false } : r));
      });
      setChecking(false);
    }
    setRunning(false);
  };

  const check = useMemo(() => {
    if (!written) return null;
    const { checks, missing } = checkAgainstDrawing(rows, written);
    return { byKey: new Map(rows.map((r, i) => [r.key, checks[i] ?? null])), missing, match: checks.filter((c) => c?.status === 'match').length, parts: checks.filter((c) => c?.status === 'part').length, differs: checks.filter((c) => c?.status === 'differs').length };
  }, [rows, written]);
  const addWritten = () => {
    if (!check) return;
    setRows((x) => [
      ...x,
      ...check.missing.map((w, i) => ({
        key: `w-${Date.now()}-${i}`,
        page: w.pages[0]!,
        pages: w.pages,
        category: '',
        description: w.description,
        kind: w.kind,
        unit: w.unit,
        qty: w.qty,
        basis: `ตัวเลขที่เขียนบนแบบ: ${w.source}`.slice(0, 400),
        confidence: 'high' as const,
        scope: 'project_total' as const,
        perUnitOf: '',
        picked: true,
      })),
    ]);
  };

  // One more AI call, text only: multiply per-unit details by their count, keep totals over their parts
  const join = async () => {
    setJoining(true);
    setJoinNotes([]);
    const before = rows;
    const res = await aiConsolidateTakeoffAction(takeoffId, {
      hint: hint.trim() || undefined,
      rows: before.map((r) => ({
        id: r.key,
        pages: r.pages,
        category: r.category.slice(0, 200),
        description: r.description.trim().slice(0, 1000) || '-',
        kind: r.kind,
        unit: r.unit.slice(0, 50),
        qty: r.qty,
        scope: r.scope,
        perUnitOf: r.perUnitOf.slice(0, 200),
        basis: r.basis.slice(0, 500),
      })),
    }).catch(() => ({ ok: false as const, error: 'รวมรายการไม่สำเร็จ (การเชื่อมต่อขัดข้อง)' }));
    setJoining(false);
    if (!res.ok) {
      setJoinNotes([{ text: res.error, error: true }]);
      return;
    }
    const byKey = new Map(before.map((r) => [r.key, r]));
    const { items, dropped, notes: aiNotes, unaccounted } = res.result;
    const joined: Row[] = items.map((it, i) => {
      const pages = [...new Set(it.sources.flatMap((k) => byKey.get(k)?.pages ?? []))].sort((a, b) => a - b);
      return { ...it, scope: 'project_total', perUnitOf: '', key: `j-${i}`, pages: pages.length ? pages : [before[0]!.page], page: pages[0] ?? before[0]!.page, picked: true };
    });
    // Rows the AI did not account for stay in the list, unticked, so nothing disappears silently
    const missing = unaccounted.map((k) => byKey.get(k)).filter((r): r is Row => Boolean(r)).map((r) => ({ ...r, picked: false }));
    setPerSheet(before);
    setRows([...joined, ...missing]);
    setJoinNotes([
      { text: `รวมจาก ${before.length.toLocaleString()} รายการรายแผ่น เหลือ ${joined.length.toLocaleString()} รายการ BOQ` },
      ...aiNotes.map((text) => ({ text })),
      ...dropped.map((d) => ({ text: `ตัดออก: ${byKey.get(d.id)?.description ?? d.id} (${d.reason})` })),
      ...(missing.length ? [{ text: `AI ไม่ได้ใช้ ${missing.length} รายการ แสดงไว้ท้ายตารางแบบไม่ติ๊ก ตรวจดูก่อนเพิ่ม` }] : []),
    ]);
  };
  const unjoin = () => {
    if (perSheet) setRows(perSheet);
    setPerSheet(null);
    setJoinNotes([]);
  };

  const update = (key: string, patch: Partial<Row>) => setRows((x) => x.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const picked = rows.filter((r) => r.picked && r.description.trim() && r.qty > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="AI ถอดแบบ">
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Sparkles className="h-4 w-4 text-brand" /> AI ถอดแบบจากไฟล์ PDF
          </h3>
          <button type="button" onClick={onClose} disabled={running} className="text-slate-400 hover:text-slate-600 disabled:opacity-40" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <span className="font-semibold text-slate-700">หน้าที่ให้ AI อ่าน</span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
              </div>
              {tooMany && <p className="mt-1 font-semibold text-amber-700">อ่านได้ครั้งละไม่เกิน {MAX_PAGES_PER_RUN} หน้า กรุณาเลือกช่วงหน้า</p>}
            </div>
            <label className="block">
              <span className="font-semibold text-slate-700">คำแนะนำให้ AI (ไม่บังคับ)</span>
              <textarea value={hint} disabled={running} onChange={(e) => setHint(e.target.value)} rows={2} maxLength={1000} placeholder="เช่น ถอดเฉพาะงานสถาปัตย์ ผนังสูง 3.00 ม. ไม่ต้องถอดงานระบบ" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <label className="flex items-start gap-2 text-slate-700">
            <input type="checkbox" checked={checkText} disabled={running} onChange={(e) => setCheckText(e.target.checked)} className="mt-0.5" />
            <span>
              <b>ตรวจกับตัวเลขที่เขียนบนแบบ</b> ระบบอ่านหมายเหตุบนแบบไปพร้อมกัน (ฟรี ไม่ใช้ AI) แล้วบอกว่าตัวเลขของ AI ตรงกับที่ผู้ออกแบบเขียนไว้หรือไม่ และตัวเลขบนแบบที่ AI ไม่ได้ใส่
            </span>
          </label>
          <p className="text-slate-500">
            AI อ่านตัวเลขบอกระยะ ตาราง และสัญลักษณ์บนแบบ แล้วคำนวณปริมาณให้ ใช้เวลาประมาณ 1–2 นาทีต่อหน้า (มีค่าใช้จ่ายทุกหน้า) ตัวเลขเป็นค่าประมาณ กรุณาตรวจก่อนเพิ่มเข้างานถอดแบบ
          </p>

          {(running || notes.length > 0) && (
            <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {notes.map((n, i) => (
                <p key={i} className={n.error ? 'flex items-start gap-1 font-semibold text-red-700' : 'text-slate-600'}>
                  {n.error && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>
                    <b>หน้า {n.page}:</b> {n.text}
                  </span>
                </p>
              ))}
              {progress && (
                <p className="flex items-center gap-1.5 font-semibold text-brand">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังอ่านหน้า {progress.page} ({progress.done + 1}/{progress.total})
                  <button type="button" onClick={() => (stopRef.current = true)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-0.5 font-normal text-slate-600 hover:bg-slate-100">
                    หยุดหลังหน้านี้
                  </button>
                </p>
              )}
            </div>
          )}

          {checking && (
            <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังอ่านตัวเลขที่เขียนบนแบบเพื่อตรวจ…
            </p>
          )}
          {check && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
              <span className="flex-1">
                ตรวจกับตัวเลขที่เขียนบนแบบ: <b>ตรง {check.match}</b> รายการ
                {check.parts > 0 && (
                  <>
                    {' · '}
                    <b>ส่วนย่อยของยอดรวมบนแบบ {check.parts}</b> รายการ (ไม่ติ๊กไว้ เพื่อไม่นับซ้ำ)
                  </>
                )}
                {check.differs > 0 && (
                  <>
                    {' · '}
                    <b className="text-amber-700">ต่างจากแบบ {check.differs}</b> รายการ (ดูป้ายสีเหลืองในช่องปริมาณ)
                  </>
                )}
                {check.missing.length > 0 && <> · ตัวเลขบนแบบที่ AI ไม่ได้ใส่ {check.missing.length} รายการ</>}
              </span>
              {check.missing.length > 0 && (
                <button type="button" onClick={addWritten} className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 font-semibold hover:bg-emerald-100">
                  เพิ่ม {check.missing.length} รายการจากแบบเข้าตาราง
                </button>
              )}
            </div>
          )}
          {!running && rows.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-violet-900">
              {perSheet ? (
                <>
                  <span className="flex-1">แสดงรายการ BOQ ที่ AI รวมแล้ว (คูณปริมาณต่อหน่วยกับจำนวน และใช้ยอดรวมแทนส่วนย่อย) ตรวจ “ที่มาของตัวเลข” ก่อนเพิ่ม</span>
                  <button type="button" onClick={unjoin} className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2.5 py-1.5 font-semibold hover:bg-violet-100">
                    <Undo2 className="h-3.5 w-3.5" /> กลับไปรายการรายแผ่น
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1">
                    รายการนี้ยังเป็นรายแผ่น อาจมีส่วนย่อยที่ซ้ำกับยอดรวม และปริมาณ “ต่อ 1 หน่วย” ที่ยังไม่ได้คูณจำนวน กด <b>รวมเป็น BOQ</b> ให้ AI จัดให้ (ส่งเฉพาะข้อความ ไม่ส่งภาพ ค่าใช้จ่ายน้อย)
                  </span>
                  <button type="button" onClick={() => void join()} disabled={joining} className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                    {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                    {joining ? 'กำลังรวม… (1–3 นาที)' : 'รวมเป็น BOQ'}
                  </button>
                </>
              )}
            </div>
          )}
          {joinNotes.length > 0 && (
            <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {joinNotes.map((n, i) => (
                <p key={i} className={n.error ? 'flex items-start gap-1 font-semibold text-red-700' : 'text-slate-600'}>
                  {n.error && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  {n.text}
                </p>
              ))}
            </div>
          )}
          {rows.length > 0 && !perSheet && readCount > rows.length && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-800">
              AI อ่านได้ {readCount.toLocaleString()} รายการ เป็นรายการเดียวกันที่เขียนซ้ำในหลายแผ่น {(readCount - rows.length).toLocaleString()} รายการ จึงรวมไว้เหลือ {rows.length.toLocaleString()} รายการ (ช่อง “หน้า” บอกทุกแผ่นที่พบ) ไม่นับซ้ำ
            </p>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[56rem]">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      <input type="checkbox" checked={rows.every((r) => r.picked)} onChange={(e) => setRows((x) => x.map((r) => ({ ...r, picked: e.target.checked })))} aria-label="เลือกทั้งหมด" />
                    </th>
                    <th className="px-2 py-2">หน้า</th>
                    <th className="px-2 py-2">หมวดงาน</th>
                    <th className="px-2 py-2">รายการ</th>
                    <th className="px-2 py-2 text-right">ปริมาณ</th>
                    <th className="px-2 py-2">หน่วย</th>
                    <th className="px-2 py-2">ที่มาของตัวเลข</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.key} className={r.picked ? '' : 'opacity-50'}>
                      <td className="px-2 py-1.5 align-top">
                        <input type="checkbox" checked={r.picked} onChange={(e) => update(r.key, { picked: e.target.checked })} aria-label={`เลือก ${r.description}`} />
                      </td>
                      <td className="px-2 py-1.5 align-top text-slate-500" title={r.pages.length > 1 ? `พบซ้ำ ${r.pages.length} แผ่น` : undefined}>
                        {r.pages.length > 4 ? `${r.pages.slice(0, 3).join(', ')} … (${r.pages.length} แผ่น)` : r.pages.join(', ')}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <input value={r.category} onChange={(e) => update(r.key, { category: e.target.value })} className="w-32 rounded border border-slate-200 px-1.5 py-1" aria-label="หมวดงาน" />
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <input value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} className="w-full min-w-[14rem] rounded border border-slate-200 px-1.5 py-1" aria-label="ชื่อรายการ" />
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <input type="number" step="any" min={0} value={r.qty} onChange={(e) => update(r.key, { qty: Math.max(0, Number(e.target.value) || 0) })} className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right" aria-label="ปริมาณ" />
                        {(() => {
                          const c = check?.byKey.get(r.key);
                          if (!c) return null;
                          if (c.status === 'match') return <span className="mt-1 block rounded bg-emerald-50 px-1.5 py-0.5 text-center font-semibold text-emerald-700">ตรงกับแบบ</span>;
                          if (c.status === 'part')
                            return (
                              <span className="mt-1 block w-24 rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600" title={`บนแบบหน้า ${c.written.pages.join(', ')}: ${c.written.source}`}>
                                ส่วนหนึ่งของ {c.written.qty.toLocaleString()} {c.written.unit} บนแบบ
                              </span>
                            );
                          return (
                            <button
                              type="button"
                              onClick={() => update(r.key, { qty: c.written.qty })}
                              title={`บนแบบหน้า ${c.written.pages.join(', ')}: ${c.written.source}`}
                              className="mt-1 block w-24 rounded bg-amber-50 px-1.5 py-0.5 text-left font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              แบบเขียน {c.written.qty.toLocaleString()} {c.written.unit} · ใช้ค่านี้
                            </button>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <input value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} className="w-16 rounded border border-slate-200 px-1.5 py-1" aria-label="หน่วย" />
                      </td>
                      <td className="px-2 py-1.5 align-top text-slate-600">
                        <span className={`mr-1 inline-block rounded px-1.5 py-0.5 font-semibold ${CONFIDENCE[r.confidence].cls}`}>{CONFIDENCE[r.confidence].label}</span>
                        {SCOPE[r.scope] && (
                          <span className={`mr-1 inline-block rounded px-1.5 py-0.5 font-semibold ${SCOPE[r.scope]!.cls}`} title={r.perUnitOf || undefined}>
                            {SCOPE[r.scope]!.label}
                            {r.scope === 'per_unit' && r.perUnitOf ? `: ${r.perUnitOf}` : ''}
                          </span>
                        )}
                        {r.basis}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!running && notes.length > 0 && rows.length === 0 && <p className="text-slate-500">AI ไม่พบรายการที่ถอดได้จากหน้าที่เลือก</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={run} disabled={running || joining || tooMany || pages.length === 0} className="flex items-center gap-1.5 rounded-lg border border-brand px-3 py-2 font-semibold text-brand hover:bg-blue-50 disabled:opacity-50">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {rows.length > 0 || notes.length > 0 ? 'ให้ AI อ่านใหม่' : `เริ่มให้ AI อ่าน ${pages.length} หน้า`}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={running} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              ปิด
            </button>
            <button
              type="button"
              disabled={running || joining || picked.length === 0}
              onClick={() => onAdd(picked.map((r) => ({ page: r.page, pages: r.pages, category: r.category.trim(), description: r.description.trim(), kind: r.kind, unit: r.unit.trim(), qty: r.qty, basis: r.basis })))}
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
