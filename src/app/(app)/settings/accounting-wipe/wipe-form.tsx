'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { wipeAccountingAction } from '@/app/(app)/accounting/delete-actions';

/** The words must be typed exactly before the wipe can run */
export function WipeForm({ confirmWords, nothingToWipe }: { confirmWords: string; nothingToWipe: boolean }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const wipe = () => {
    setError(null);
    startTransition(async () => {
      const r = await wipeAccountingAction(typed);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const total = r.result.documents.reduce((s, d) => s + d.count, 0);
      setDone(`ล้างข้อมูลบัญชีแล้ว ลบเอกสาร ${total.toLocaleString('th-TH')} ใบ`);
      setTyped('');
      router.refresh();
    });
  };
  return (
    <section className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
      <p className="text-sm font-bold">ลบถาวร กู้คืนไม่ได้</p>
      <p>ก่อนกดบนระบบจริง ควรสำรองฐานข้อมูลไว้ก่อน (เช่น สร้าง branch สำรองใน Neon)</p>
      <label className="block">
        <span className="mb-1 block font-medium">
          พิมพ์ <b>&quot;{confirmWords}&quot;</b> เพื่อยืนยัน
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={pending || nothingToWipe}
          aria-label="ข้อความยืนยันการล้างข้อมูล"
          className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-slate-900 focus:border-red-500 focus:outline-none"
        />
      </label>
      {error && (
        <p role="alert" className="font-medium text-red-700">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="font-semibold text-emerald-700">
          {done}
        </p>
      )}
      <button
        type="button"
        onClick={wipe}
        disabled={pending || nothingToWipe || typed.trim() !== confirmWords}
        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" /> {pending ? 'กำลังล้างข้อมูล...' : 'ล้างข้อมูลบัญชีทั้งหมด'}
      </button>
    </section>
  );
}
