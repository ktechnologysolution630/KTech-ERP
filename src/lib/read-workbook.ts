import type { BoqSheetGrid } from '@/domain/boq-import';
import type { WorkbookWorkerReply } from './read-workbook.worker';

const READ_TIMEOUT_MS = 120_000;

/** Reads every visible sheet of an .xls, .xlsx or .csv file in a background worker, in the browser. Nothing is uploaded or changed. */
export function readWorkbook(file: File): Promise<BoqSheetGrid[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./read-workbook.worker.ts', import.meta.url));
    // A malformed file must not be able to hold the import up for good
    const timer = setTimeout(() => finish(() => reject(new Error('UNREADABLE'))), READ_TIMEOUT_MS);
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    worker.onmessage = ({ data }: MessageEvent<WorkbookWorkerReply>) => {
      finish(() => (data.ok ? resolve(data.sheets) : reject(new Error(data.reason))));
    };
    worker.onerror = () => finish(() => reject(new Error('UNREADABLE')));
    worker.postMessage(file);
  });
}
