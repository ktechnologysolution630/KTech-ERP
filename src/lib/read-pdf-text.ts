import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist';
import type { Worker as OcrWorker } from 'tesseract.js';
import { linesFromTextItems, type PdfTextItem } from '@/domain/project-pdf';

const CHUNK_BYTES = 1024 * 1024;
/** A page with less text than this is a scan, perhaps with a stamp or page number on top */
const MIN_TEXT_CHARS = 20;
/** Enough for small print on a scanned A4 page; a large drawing is capped so it fits in memory */
const OCR_PAGE_WIDTH_PX = 2000;
const OCR_MAX_SCALE = 3;

export type PdfReadFailure = 'PASSWORD' | 'INVALID' | 'OCR';

export class PdfReadError extends Error {
  constructor(readonly reason: PdfReadFailure) {
    super(reason);
  }
}

export interface PdfPageInfo {
  page: number;
  pages: number;
  /** The text came from recognising the page image, so it may contain mistakes */
  scanned: boolean;
}

async function startOcr(): Promise<OcrWorker> {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const worker = await createWorker(['tha', 'eng'], OEM.LSTM_ONLY, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  return worker;
}

async function recognisePage(page: PDFPageProxy, worker: OcrWorker): Promise<string[]> {
  const { width } = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(OCR_MAX_SCALE, OCR_PAGE_WIDTH_PX / width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new PdfReadError('OCR');
  await page.render({ canvasContext, viewport }).promise;
  const { data } = await worker.recognize(canvas);
  // Releases the canvas's memory straight away, which matters over hundreds of pages
  canvas.width = 0;
  return data.text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Reads a PDF's text page by page, in the browser. The file is only ever read, one slice at a time
 * as pdf.js asks for it: nothing is written back, nothing is uploaded, and a file of any size fits
 * because it is never held in memory whole. Scanned pages are recognised from their image, here too.
 *
 * `onPage` returns true to stop early. Aborting the signal stops the read and resolves normally.
 */
export async function readPdfText(file: File, onPage: (lines: string[], info: PdfPageInfo) => boolean, signal: AbortSignal): Promise<void> {
  const { getDocument, GlobalWorkerOptions, PDFDataRangeTransport } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

  let task: PDFDocumentLoadingTask | null = null;
  class FileSlices extends PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number) {
      file
        .slice(begin, end)
        .arrayBuffer()
        .then((data) => this.onDataRange(begin, new Uint8Array(data)))
        // The file was moved or changed on disk while being read
        .catch(() => void task?.destroy());
    }
  }

  task = getDocument({
    range: new FileSlices(file.size, new Uint8Array(0)),
    length: file.size,
    rangeChunkSize: CHUNK_BYTES,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
  });

  let ocr: OcrWorker | null = null;
  // Recognising a page cannot be interrupted, so stopping must not wait for it
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  aborted.catch(() => undefined);
  const stop = () => void task?.destroy();
  signal.addEventListener('abort', stop);
  try {
    const pdf = await task.promise;
    for (let n = 1; n <= pdf.numPages && !signal.aborted; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = content.items.flatMap((item) =>
        'str' in item ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, width: item.width, height: item.height }] : [],
      );
      let lines = linesFromTextItems(items);
      const scanned = lines.join('').replace(/\s/g, '').length < MIN_TEXT_CHARS;
      if (scanned) {
        try {
          ocr ??= await Promise.race([startOcr(), aborted]);
          lines = await Promise.race([recognisePage(page, ocr), aborted]);
        } catch (err) {
          if (signal.aborted) return;
          console.error(err);
          throw new PdfReadError('OCR');
        }
      }
      page.cleanup();
      if (onPage(lines, { page: n, pages: pdf.numPages, scanned })) return;
    }
  } catch (err) {
    if (signal.aborted) return;
    if (err instanceof PdfReadError) throw err;
    throw new PdfReadError(err instanceof Error && err.name === 'PasswordException' ? 'PASSWORD' : 'INVALID');
  } finally {
    signal.removeEventListener('abort', stop);
    void ocr?.terminate();
    await task.destroy();
  }
}
