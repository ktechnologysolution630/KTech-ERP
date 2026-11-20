'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Shown inside the app's frame when a page or a button fails unexpectedly, instead of the bare "Application error" page */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: unknown }).digest ?? '') : '';
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center space-y-3">
      <h2 className="text-base font-semibold text-slate-900">เกิดข้อผิดพลาด ทำรายการไม่สำเร็จ</h2>
      <p className="text-sm text-slate-600">ลองใหม่อีกครั้ง หากยังไม่ได้ กรุณาแจ้งผู้ดูแลระบบ{digest ? ` พร้อมรหัส ${digest}` : ''}</p>
      <div className="flex justify-center gap-2">
        <button type="button" onClick={() => retry()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          ลองใหม่
        </button>
        <Link href="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">
          กลับหน้าแรก
        </Link>
      </div>
    </div>
  );
}
