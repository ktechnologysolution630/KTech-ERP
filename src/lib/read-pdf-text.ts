import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { Scheduler } from 'tesseract.js';
import { linesFromTextItems, type PdfTextItem } from '@/domain/project-pdf';

const CHUNK_BYTES = 1024 * 1024;
/** A page with less text than this is a scan, perhaps with a stamp or page number on top */
const MIN_TEXT_CHARS = 20;
/** The second reading uses another resolution, so the two do not simply repeat the same mistake */
const FIRST_READ_WIDTH_PX = 1500;
const RECHECK_WIDTH_PX = 2000;
const MAX_SCALE = 4;
const MAX_OCR_WORKERS = 4;
const EARLY_RECHECK_MAX_PAGES = 2;
const BLACK_BELOW = 150;
/** Project details are usually up front, where reading further pages at once would only slow the pages that matter */
const SEQUENTIAL_SCAN_PAGES = 2;

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

export interface PdfReadHandlers {
  /** Called in page order. Returns true to stop reading further pages. */
  onPage: (lines: string[], info: PdfPageInfo) => boolean;
  onScanning: (pagesDone: number, pages: number) => void;
  /** Which scanned pages to read a second time, once the first reading is over */
  pagesToRecheck: () => number[];
  onRechecking: (pageCount: number) => void;
  onRecheckedPage: (lines: string[], page: number) => void;
}

/** Each OCR worker takes a CPU core and a good deal of memory, so a phone gets fewer than a desktop. */
function ocrWorkerCount(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Math.max(1, Math.min(MAX_OCR_WORKERS, cores - 1, memoryGb <= 4 ? 2 : MAX_OCR_WORKERS));
}

/** Workers start only when a scan is met, and only as many as the file turns out to need. */
class OcrPool {
  readonly maxWorkers = ocrWorkerCount();
  private scheduler: Scheduler | null = null;
  private started = 0;
  private stopped = false;

  private async addWorker(scheduler: Scheduler): Promise<void> {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    const worker = await createWorker(['tha', 'eng'], OEM.LSTM_ONLY, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
    });
    if (this.stopped) {
      void worker.terminate();
      return;
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    scheduler.addWorker(worker);
  }

  async ready(): Promise<void> {
    if (!this.scheduler) {
      const { createScheduler } = await import('tesseract.js');
      this.scheduler = createScheduler();
      this.started = 1;
      await this.addWorker(this.scheduler);
    }
  }

  /** Starts the rest of the workers, for a scan that needs more than its first pages */
  grow(): void {
    const scheduler = this.scheduler;
    if (!scheduler) return;
    for (; this.started < this.maxWorkers; this.started++) {
      // The file still gets read if one fails to start, only more slowly
      this.addWorker(scheduler).catch((err: unknown) => console.error(err));
    }
  }

  async read(canvas: HTMLCanvasElement): Promise<string[]> {
    if (!this.scheduler) throw new PdfReadError('OCR');
    const { data } = await this.scheduler.addJob('recognize', canvas, {}, { text: true, blocks: false, hocr: false, tsv: false });
    // Releases the canvas's memory straight away, which matters over hundreds of pages
    canvas.width = 0;
    return data.text.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  stop(): void {
    this.stopped = true;
    void this.scheduler?.terminate();
  }
}

/** Hard black and white: Thai letters read noticeably better, and it makes the second reading more independent of the first. */
function toBlackAndWhite(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const shade = 0.3 * pixels[i]! + 0.59 * pixels[i + 1]! + 0.11 * pixels[i + 2]! < BLACK_BELOW ? 0 : 255;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = shade;
  }
  context.putImageData(image, 0, 0);
}

async function renderPage(page: PDFPageProxy, targetWidth: number): Promise<HTMLCanvasElement> {
  const { width } = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(MAX_SCALE, targetWidth / width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new PdfReadError('OCR');
  await page.render({ canvasContext, viewport }).promise;
  return canvas;
}

interface PendingPage {
  info: PdfPageInfo;
  lines: Promise<string[]>;
}

/**
 * Reads a PDF's text in the browser. The file is only ever read, one slice at a time as pdf.js asks
 * for it: nothing is written back, nothing is uploaded, and a file of any size fits because it is
 * never held in memory whole. Scanned pages are recognised from their image, several at once.
 *
 * Aborting the signal stops the read and resolves normally.
 */
export async function readPdfText(file: File, handlers: PdfReadHandlers, signal: AbortSignal): Promise<void> {
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

  let ocr = new OcrPool();
  let readAheadAbandoned = false;
  // Recognising a page cannot be interrupted, so stopping must not wait for it
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  aborted.catch(() => undefined);
  const stop = () => void task?.destroy();
  signal.addEventListener('abort', stop);

  /** In a short file the second reading will almost surely be wanted, and starting it now saves waiting for the first */
  const earlyRechecks = new Map<number, Promise<string[]>>();
  const readForRecheck = async (pdf: PDFDocumentProxy, n: number) => {
    const canvas = await renderPage(await pdf.getPage(n), RECHECK_WIDTH_PX);
    toBlackAndWhite(canvas);
    return ocr.read(canvas);
  };

  const firstReading = async (pdf: PDFDocumentProxy): Promise<void> => {
    const pending: PendingPage[] = [];
    let scannedPages = 0;
    let done = 0;
    /** Hands over the oldest page, so the pages stay in order however the workers finish. True means stop. */
    const deliver = async (): Promise<boolean> => {
      const next = pending.shift();
      if (!next) return false;
      const lines = await Promise.race([next.lines, aborted]);
      done += 1;
      if (next.info.scanned) handlers.onScanning(done, pdf.numPages);
      return handlers.onPage(lines, next.info);
    };

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = content.items.flatMap((item) =>
        'str' in item ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, width: item.width, height: item.height }] : [],
      );
      const lines = linesFromTextItems(items);
      const scanned = lines.join('').replace(/\s/g, '').length < MIN_TEXT_CHARS;
      const info = { page: n, pages: pdf.numPages, scanned };
      if (scanned) {
        scannedPages += 1;
        handlers.onScanning(done, pdf.numPages);
        await Promise.race([ocr.ready(), aborted]);
        const shortFile = pdf.numPages <= EARLY_RECHECK_MAX_PAGES;
        if (scannedPages > SEQUENTIAL_SCAN_PAGES || shortFile) ocr.grow();
        const reading = renderPage(page, FIRST_READ_WIDTH_PX).then((canvas) => ocr.read(canvas));
        // A page read ahead may never be asked for, if an earlier one ends the search
        reading.catch(() => undefined);
        pending.push({ info, lines: reading });
        if (shortFile) {
          const early = readForRecheck(pdf, n);
          early.catch(() => undefined);
          earlyRechecks.set(n, early);
        }
      } else {
        pending.push({ info, lines: Promise.resolve(lines) });
      }
      while (pending.length >= (scanned && scannedPages > SEQUENTIAL_SCAN_PAGES ? ocr.maxWorkers : 1)) {
        if (await deliver()) {
          readAheadAbandoned = pending.length > 0;
          return;
        }
      }
    }
    while (pending.length > 0) {
      if (await deliver()) return;
    }
  };

  const recheck = async (pdf: PDFDocumentProxy): Promise<void> => {
    const pages = handlers.pagesToRecheck();
    if (pages.length === 0) return;
    handlers.onRechecking(pages.length);
    if (readAheadAbandoned && earlyRechecks.size === 0) {
      // Pages read ahead and no longer wanted would hold up the queue; fresh workers start in about a second
      ocr.stop();
      ocr = new OcrPool();
      await Promise.race([ocr.ready(), aborted]);
      if (pages.length > 1) ocr.grow();
    }
    const readings = pages.map((n) => earlyRechecks.get(n) ?? readForRecheck(pdf, n));
    readings.forEach((r) => r.catch(() => undefined));
    for (const [i, reading] of readings.entries()) {
      handlers.onRecheckedPage(await Promise.race([reading, aborted]), pages[i]!);
    }
  };

  try {
    const pdf = await task.promise;
    await firstReading(pdf);
    await recheck(pdf);
  } catch (err) {
    if (signal.aborted) return;
    if (err instanceof PdfReadError) throw err;
    console.error(err);
    if (err instanceof Error && err.name === 'PasswordException') throw new PdfReadError('PASSWORD');
    throw new PdfReadError(err instanceof Error && err.name === 'InvalidPDFException' ? 'INVALID' : 'OCR');
  } finally {
    signal.removeEventListener('abort', stop);
    ocr.stop();
    await task.destroy();
  }
}
