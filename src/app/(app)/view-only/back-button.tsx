'use client';

import { useRouter } from 'next/navigation';

/** Back to the document the person was looking at */
export function BackButton() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.back()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
      ย้อนกลับ
    </button>
  );
}
