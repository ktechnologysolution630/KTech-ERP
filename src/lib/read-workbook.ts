import type { BoqSheetGrid } from '@/domain/boq-import';
import type { WorkbookWorkerReply } from './read-workbook.worker';

const READ_TIMEOUT_MS = 120_000;

/** Excel leaves a small "~$name.xlsx" beside a file while it is open. It holds no data, yet looks just like the real one in a folder. */
export const isExcelLockFile = (fileName: string): boolean => fileName.startsWith('~$');

export const EXCEL_LOCK_FILE_MESSAGE = 'ไฟล์ที่ขึ้นต้นด้วย ~$ เป็นไฟล์ชั่วคราวของ Excel ไม่มีข้อมูล กรุณาเลือกไฟล์ที่ชื่อเดียวกันแต่ไม่มี ~$ นำหน้า';

/** Reads every visible sheet of an .xls, .xlsx or .csv file in a background worker, in the browser. Nothing is uploaded or changed. */
export function readWorkbook(file: File): Promise<BoqSheetGrid[]> {
  if (isExcelLockFile(file.name)) return Promise.reject(new Error('EXCEL_LOCK_FILE'));
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
