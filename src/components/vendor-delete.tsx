'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { VendorDeleteResult } from '@/server/services/vendor-delete';

export type VendorDeleteActionResult = { ok: true; result: VendorDeleteResult } | { ok: false; error: string };

const DELETE_WORD = 'ลบ';

/** Confirms deleting the ticked vendors; the user types "ลบ" first because it cannot be undone. */
export function VendorDeleteDialog({
  title,
  targets,
  deleteAction,
  onDeleted,
  onClose,
}: {
  title: string;
  targets: { id: string; code: string; name: string }[];
  deleteAction: (ids: string[]) => Promise<VendorDeleteActionResult>;
  onDeleted: (result: VendorDeleteResult) => void;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await deleteAction(targets.map((t) => t.id));
        if (r.ok) onDeleted(r.result);
        else setError(r.error);
      } catch {
        setError('ลบไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={`${title} ${targets.length} รายการ`}>
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">
            {title} {targets.length} รายการ
          </h3>
          <button type="button" onClick={onClose} disabled={isPending} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {targets.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 px-3 py-1.5">
                <span className="shrink-0 font-mono text-[11px] text-slate-500">{t.code}</span>
                <span className="truncate text-slate-800" title={t.name}>
                  {t.name}
                </span>
              </li>
            ))}
          </ul>
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <p className="font-bold">ลบถาวร กู้คืนไม่ได้</p>
            <p className="mt-1">
              รายชื่อนี้ใช้ร่วมกันทั้งหน้าซัพพลายเออร์และหน้าผู้รับเหมา จึงจะหายจากทั้งสองหน้า ส่วนรายที่มีเอกสารแล้ว (PO, ใบแจ้งหนี้, ใบสำคัญจ่าย ฯลฯ) ระบบจะไม่ลบ และแจ้งให้ทราบ
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">พิมพ์คำว่า &quot;{DELETE_WORD}&quot; เพื่อยืนยัน</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-red-500 focus:outline-none" />
          </label>
          {error && (
            <p role="alert" className="font-medium text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" onClick={confirm} disabled={isPending || typed.trim() !== DELETE_WORD} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {isPending ? 'กำลังลบ...' : `ลบ ${targets.length} รายการ`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What a delete did: how many went, and which stayed because documents still name them. */
export function VendorDeleteResultBanner({ deleted, inUse, onClose }: { deleted: number; inUse: VendorDeleteResult['inUse']; onClose: () => void }) {
  return (
    <div role="status" className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">ลบแล้ว {deleted} รายการ</p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
          <X className="h-4 w-4" />
        </button>
      </div>
      {inUse.length > 0 && (
        <div className="mt-1 text-amber-800">
          ไม่ได้ลบ {inUse.length} รายการ เพราะมีเอกสารอ้างถึงแล้ว
          <ul className="mt-1.5 space-y-1.5">
            {inUse.map((v) => (
              <li key={v.id}>
                <div className="font-medium">
                  {v.code} {v.name}
                </div>
                <ul className="mt-0.5 list-disc pl-4 text-slate-700">
                  {v.documents.map((doc, i) => (
                    <li key={`${doc.href}-${i}`}>
                      {doc.label}{' '}
                      <Link href={doc.href} className="font-mono text-[#2453d4] underline">
                        {doc.number}
                      </Link>
                      {doc.cancelled && <span className="text-slate-500"> (ยกเลิกแล้ว)</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
