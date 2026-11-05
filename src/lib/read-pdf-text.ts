import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { linesFromTextItems, type PdfTextItem } from '@/domain/project-pdf';

const CHUNK_BYTES = 1024 * 1024;

export type PdfReadFailure = 'PASSWORD' | 'INVALID';

export class PdfReadError extends Error {
  constructor(readonly reason: PdfReadFailure) {
    super(reason);
  }
}

/**
 * Reads a PDF's text page by page, in the browser. The file is only ever read, one slice at a time
 * as pdf.js asks for it: nothing is written back, nothing is uploaded, and a file of any size fits
 * because it is never held in memory whole.
 *
 * `onPage` returns true to stop early. Aborting the signal stops the read and resolves normally.
 */
export async function readPdfText(
  file: File,
  onPage: (lines: string[], pageNumber: number, pageCount: number) => boolean,
  signal: AbortSignal,
): Promise<void> {
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
      page.cleanup();
      if (onPage(linesFromTextItems(items), n, pdf.numPages)) return;
    }
  } catch (err) {
    if (signal.aborted) return;
    throw new PdfReadError(err instanceof Error && err.name === 'PasswordException' ? 'PASSWORD' : 'INVALID');
  } finally {
    signal.removeEventListener('abort', stop);
    await task.destroy();
  }
}
