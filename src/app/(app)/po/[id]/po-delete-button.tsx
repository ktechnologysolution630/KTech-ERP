'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import type { PoDeletionPreview } from '@/server/services/po-delete';
import { deletePoAction } from '../actions';

export function PoDeleteButton({ id, number, vendorName, approved, preview }: { id: string; number: string; vendorName: string; approved: boolean; preview: PoDeletionPreview }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const held = preview.holders.length > 0;

  const close = () => {
    if (isPending) return;
    setOpen(false);
    setError(null);
  };
  const confirmDelete = () => {
    setError(null);
    startTransition(async () => {
      const r = await deletePoAction(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.replace('/po');
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
      >
        <Trash2 className="h-3.5 w-3.5" />
        ลบ PO
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 text-left"
          role="dialog"
          aria-modal="true"
          aria-label={`ลบ ${number}`}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-xs shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">ลบใบสั่งซื้อ {number}</h3>
              <button type="button" onClick={close} disabled={isPending} className="text-slate-400 hover:text-slate-600" title="ปิด">
                <X className="h-4 w-4" />
              </button>
            </div>

            {held ? (
              <>
                <p className="font-medium text-red-700">ยังลบไม่ได้ เพราะมีเอกสารเหล่านี้อ้างอิงใบสั่งซื้อนี้อยู่</p>
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {preview.holders.map((doc, i) => (
                    <li key={`${doc.href}-${i}`} className="flex items-center gap-2 px-3 py-2">
                      <span className="w-28 shrink-0 text-slate-500">{doc.label}</span>
                      <Link href={doc.href} className="min-w-0 truncate font-mono text-[#2453d4] hover:underline">
                        {doc.number}
                      </Link>
                      {doc.cancelled && <span className="shrink-0 text-slate-500">(ยกเลิกแล้ว)</span>}
                    </li>
                  ))}
                </ul>
                <p className="text-slate-600">ใบแจ้งหนี้ต้องยกเลิกก่อน ส่วนใบรับของและใบสำคัญจ่ายยังลบแยกไม่ได้ ถ้าเป็นข้อมูลทดสอบทั้งโครงการ ให้ลบที่ตัวโครงการแทน</p>
              </>
            ) : (
              <>
                <p className="text-slate-600">
                  ผู้ขาย: <span className="font-semibold text-slate-900">{vendorName}</span> ลบแล้วกู้คืนไม่ได้ และเลขที่นี้จะไม่ถูกนำกลับมาใช้
                </p>
                {approved && (
                  <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    ใบนี้อนุมัติแล้ว ถ้าส่งให้ร้านไปแล้ว อย่าลืมแจ้งร้านด้วย
                  </p>
                )}
                {preview.goesWith.length > 0 && (
                  <div className="text-slate-600">
                    <p>จะถูกลบไปด้วย:</p>
                    <ul className="list-disc pl-5">
                      {preview.goesWith.map((item) => (
                        <li key={item.label}>
                          {item.label} {item.count.toLocaleString()} รายการ
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {error && (
              <p role="alert" className="font-medium text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={isPending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
                {held ? 'ปิด' : 'ยกเลิก'}
              </button>
              {!held && (
                <button type="button" onClick={confirmDelete} disabled={isPending} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {isPending ? 'กำลังลบ...' : 'ลบใบสั่งซื้อ'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
