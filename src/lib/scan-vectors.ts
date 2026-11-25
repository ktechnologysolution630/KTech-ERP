import type { PDFPageProxy } from 'pdfjs-dist';
import type { Scheduler } from 'tesseract.js';
import { rasterToVectors, toGray, type OcrWord } from '@/domain/raster-takeoff';
import type { PageVectors } from '@/domain/vector-takeoff';

/**
 * Reads a scanned drawing page in the browser, without AI: the page is drawn to a canvas, OCR
 * (tesseract, with the Thai and English data the app already serves) finds the words, and the
 * pixels left are traced into lines (domain/raster-takeoff). Nothing leaves the computer.
 */

/** About 150–200 dpi on an A3 sheet: enough to tell pen widths apart, small enough to stay quick */
const TARGET_LONG_EDGE_PX = 3000;
const MAX_SCALE = 4;
const MAX_OCR_WORKERS = 3;
/** Fewer vector paths and words than this and the page is a picture, not a CAD drawing */
const SCAN_MAX_PATHS = 20;
const SCAN_MAX_TEXTS = 5;
/** Below this, OCR is guessing; the box is still wiped but the word is not used */
const MIN_WORD_CONFIDENCE = 40;

export const looksScanned = (v: PageVectors) => v.paths.length < SCAN_MAX_PATHS && v.texts.length < SCAN_MAX_TEXTS;

function workerCount(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Math.max(1, Math.min(MAX_OCR_WORKERS, cores - 1, memoryGb <= 4 ? 1 : MAX_OCR_WORKERS));
}

/** OCR workers start only once a scanned page is met */
export class ScanReader {
  private scheduler: Promise<Scheduler> | null = null;

  private start(): Promise<Scheduler> {
    this.scheduler ??= (async () => {
      const { createScheduler, createWorker, OEM, PSM } = await import('tesseract.js');
      const scheduler = createScheduler();
      const add = async () => {
        const worker = await createWorker(['tha', 'eng'], OEM.LSTM_ONLY, { workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang' });
        // Automatic layout keeps each note's words together as lines, which the written quantities need
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
        scheduler.addWorker(worker);
      };
      await add();
      // The rest come up in the background; the first one is enough to begin
      for (let i = 1; i < workerCount(); i++) add().catch((err: unknown) => console.error(err));
      return scheduler;
    })();
    return this.scheduler;
  }

  async read(page: PDFPageProxy, pageNo: number, withOcr: boolean): Promise<PageVectors> {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(MAX_SCALE, TARGET_LONG_EDGE_PX / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const words: OcrWord[] = [];
    const lines: string[] = [];
    if (withOcr) {
      const scheduler = await this.start();
      const { data } = await scheduler.addJob('recognize', canvas, {}, { blocks: true, text: false, hocr: false, tsv: false });
      for (const block of data.blocks ?? [])
        for (const para of block.paragraphs)
          for (const line of para.lines) {
            if (line.text.trim()) lines.push(line.text.trim());
            for (const w of line.words) words.push({ text: w.text, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
          }
    }
    const img = toGray(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    canvas.width = 0;
    const { paths, texts } = rasterToVectors(img, { scale, words, minTextConfidence: MIN_WORD_CONFIDENCE });
    return { page: pageNo, width: base.width, height: base.height, paths, texts, lines, truncated: false, scanned: true };
  }

  stop() {
    void this.scheduler?.then((s) => s.terminate()).catch(() => undefined);
    this.scheduler = null;
  }
}
