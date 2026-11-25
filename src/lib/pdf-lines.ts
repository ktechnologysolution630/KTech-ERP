import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPageVectors } from '@/lib/pdf-vectors';
import { looksScanned, ScanReader } from '@/lib/scan-vectors';

/**
 * Text lines of drawing pages, for reading the quantities written in notes: straight from the PDF
 * for CAD output, through OCR for scans. Runs in the browser; nothing leaves the computer.
 */
export class PageLineReader {
  private scan = new ScanReader();
  private ops: Promise<Record<string, number>> | null = null;

  async read(pdf: PDFDocumentProxy, pageNo: number): Promise<string[]> {
    this.ops ??= import('pdfjs-dist').then((m) => m.OPS as unknown as Record<string, number>);
    const OPS = await this.ops;
    const page = await pdf.getPage(pageNo);
    try {
      const v = await extractPageVectors(page, pageNo, OPS);
      if (!looksScanned(v)) return v.lines ?? [];
      return (await this.scan.read(page, pageNo, true)).lines ?? [];
    } finally {
      page.cleanup();
    }
  }

  stop() {
    this.scan.stop();
  }
}
