'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, FileQuestion, X } from 'lucide-react';
import { previewKind } from '@/lib/file-preview';
import type { SheetPreview } from '@/lib/spreadsheet';

type Loaded = { kind: 'sheets'; sheets: SheetPreview[] } | { kind: 'text'; text: string };

/** Shows a project document over the page: images and PDFs directly, spreadsheets and text as read from the file. */
export function DocumentViewer({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const kind = previewKind(name);
  const needsReading = kind === 'WORKBOOK' || kind === 'CSV' || kind === 'TEXT';
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const canShowPdf = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!needsReading) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const res = await fetch(url, { signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (kind === 'TEXT') {
          const text = await res.text();
          if (!abort.signal.aborted) setLoaded({ kind: 'text', text });
          return;
        }
        // exceljs is large: only load it when a spreadsheet is actually opened
        const { readCsvPreview, readWorkbookPreview } = await import('@/lib/spreadsheet');
        const sheets = kind === 'CSV' ? readCsvPreview(await res.text()) : await readWorkbookPreview(await res.arrayBuffer());
        if (!abort.signal.aborted) setLoaded({ kind: 'sheets', sheets });
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
    })();
    return () => abort.abort();
  }, [kind, needsReading, url]);

  const fallback = (message: string) => (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-white p-8 text-center text-sm text-slate-600">
      <FileQuestion className="h-10 w-10 text-slate-400" />
      <p>{message}</p>
      <a href={url} download={name} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">
        <Download className="h-4 w-4" /> ดาวน์โหลดไฟล์
      </a>
    </div>
  );

  let body: React.ReactNode;
  if (kind === 'NONE') {
    body = fallback('ไฟล์ประเภทนี้เปิดดูในเว็บไม่ได้ กรุณาดาวน์โหลดเพื่อเปิดด้วยโปรแกรมในเครื่อง');
  } else if (failed) {
    body = fallback('เปิดไฟล์นี้ไม่สำเร็จ ไฟล์อาจเสียหายหรือไม่พบไฟล์บนเซิร์ฟเวอร์ ลองดาวน์โหลดแทน');
  } else if (kind === 'IMAGE') {
    body = (
      <div className="flex h-full items-center justify-center overflow-auto bg-slate-900 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
      </div>
    );
  } else if (kind === 'PDF') {
    // Browsers without a built-in PDF viewer (Android Chrome) would show an empty frame
    body = canShowPdf ? (
      <iframe src={url} title={name} className="h-full w-full bg-white" />
    ) : (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-white p-8 text-center text-sm text-slate-600">
        <FileQuestion className="h-10 w-10 text-slate-400" />
        <p>อุปกรณ์นี้แสดง PDF ในหน้านี้ไม่ได้</p>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">
          <ExternalLink className="h-4 w-4" /> เปิดในแท็บใหม่
        </a>
      </div>
    );
  } else if (!loaded) {
    body = <div className="flex h-full items-center justify-center bg-white text-xs text-slate-500">กำลังเปิดเอกสาร...</div>;
  } else if (loaded.kind === 'text') {
    body = <pre className="h-full overflow-auto whitespace-pre-wrap bg-white p-4 text-xs text-slate-800">{loaded.text}</pre>;
  } else {
    const sheet = loaded.sheets[Math.min(sheetIndex, loaded.sheets.length - 1)];
    body = (
      <div className="flex h-full flex-col bg-white">
        <div className="min-h-0 flex-1 overflow-auto">
          {!sheet || sheet.rows.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">ชีตนี้ไม่มีข้อมูล</p>
          ) : (
            <table className="border-collapse text-xs">
              <tbody>
                {sheet.rows.map((row, r) => (
                  <tr key={r}>
                    <th scope="row" className="sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1 text-right font-normal text-slate-500">
                      {r + 1}
                    </th>
                    {row.map((cell, c) => (
                      <td key={c} className="max-w-[320px] whitespace-pre-wrap border border-slate-200 px-2 py-1 align-top text-slate-800">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sheet && sheet.hiddenRows > 0 && <p className="p-3 text-xs text-amber-800">แสดง {sheet.rows.length.toLocaleString('th-TH')} แถวแรก เหลืออีก {sheet.hiddenRows.toLocaleString('th-TH')} แถว ดาวน์โหลดไฟล์เพื่อดูทั้งหมด</p>}
        </div>
        {loaded.sheets.length > 1 && (
          <div role="tablist" aria-label="ชีต" className="flex shrink-0 gap-1 overflow-x-auto border-t border-slate-200 bg-slate-50 px-2 py-1">
            {loaded.sheets.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                type="button"
                role="tab"
                aria-selected={i === sheetIndex}
                onClick={() => setSheetIndex(i)}
                className={`whitespace-nowrap rounded px-3 py-1 text-xs ${i === sheetIndex ? 'bg-white font-semibold text-[#173a7a] shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/80 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label={`ดูเอกสาร ${name}`} onClick={onClose}>
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-3 bg-[#173a7a] px-4 py-2.5 text-white">
          <h3 className="truncate text-sm font-semibold" title={name}>
            {name}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            {kind === 'PDF' && (
              <a href={url} target="_blank" rel="noreferrer" className="rounded p-1.5 hover:bg-white/15" title="เปิดในแท็บใหม่" aria-label={`เปิด ${name} ในแท็บใหม่`}>
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <a href={url} download={name} className="rounded p-1.5 hover:bg-white/15" title="ดาวน์โหลด" aria-label={`ดาวน์โหลด ${name}`}>
              <Download className="h-4 w-4" />
            </a>
            <button ref={closeRef} type="button" onClick={onClose} className="rounded p-1.5 hover:bg-white/15" title="ปิด" aria-label="ปิด">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    </div>
  );
}
