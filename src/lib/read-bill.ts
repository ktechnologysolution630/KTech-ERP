import { readPdfText } from './read-pdf-text';

/** Pages of a PDF bill that are read; a bill's totals sit on its first pages */
const MAX_PDF_PAGES = 3;

/**
 * Reads the text of a bill picture or PDF in the browser. Nothing is sent to an outside service:
 * the same Thai/English recogniser that reads scanned project PDFs is used.
 */
export async function readBillLines(file: File, onStatus: (text: string) => void, signal: AbortSignal): Promise<string[]> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const lines: string[] = [];
    await readPdfText(
      file,
      {
        onPage: (pageLines, info) => {
          lines.push(...pageLines);
          return info.page >= MAX_PDF_PAGES;
        },
        onScanning: (done, pages) => onStatus(`กำลังอ่านหน้า ${Math.min(done + 1, pages)} / ${pages}`),
        pagesToRecheck: () => [],
        onRechecking: () => undefined,
        onRecheckedPage: () => undefined,
      },
      signal,
    );
    return lines;
  }
  onStatus('กำลังเตรียมตัวอ่านข้อความ...');
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const worker = await createWorker(['tha', 'eng'], OEM.LSTM_ONLY, { workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang' });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    if (signal.aborted) return [];
    onStatus('กำลังอ่านข้อความจากรูป...');
    const { data } = await worker.recognize(file);
    return data.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } finally {
    void worker.terminate();
  }
}
