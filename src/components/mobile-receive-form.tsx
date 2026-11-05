'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resizeImage } from '@/lib/image-resize';
import { createReceiptAction } from '@/app/(app)/receive/actions';
import { DateInput } from '@/components/date-input';

export function MobileReceiveForm({
  poId,
  poNumber,
  vendorName,
  projectLabel,
  defaultDate,
  lines,
}: {
  poId: string;
  poNumber: string;
  vendorName: string;
  projectLabel: string;
  defaultDate: string;
  lines: {
    id: string;
    description: string;
    unitName: string;
    orderedQty: number;
    receivedQty: number;
    remainingQty: number;
  }[];
}) {
  const router = useRouter();
  const [receivedAt, setReceivedAt] = useState(defaultDate);
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.remainingQty)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function fillAllRemaining() {
    setQtys(Object.fromEntries(lines.map((l) => [l.id, String(l.remainingQty)])));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await createReceiptAction({
          poId,
          receivedAt,
          deliveryNoteNo,
          note,
          lines: Object.entries(qtys).map(([poLineId, qty]) => ({ poLineId, qty })),
        });
        if (photo) {
          const resized = await resizeImage(photo);
          const fd = new FormData();
          fd.set('entityType', 'RECEIPT');
          fd.set('entityId', res.receiptId);
          fd.set('file', resized);
          await fetch('/api/upload', { method: 'POST', body: fd });
        }
        router.push(`/po/${poId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'บันทึกรับของไม่สำเร็จ');
      }
    });
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">รับของ {poNumber}</h1>
            <p className="text-xs text-slate-600">
              {vendorName} · {projectLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={fillAllRemaining}
            className="rounded-lg bg-blue-50 text-blue-700 border border-blue-200 px-3 py-2 text-xs font-semibold min-h-[44px]"
          >
            รับครบทุกรายการ
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 font-medium">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {lines.map((l) => (
          <div
            key={l.id}
            className="rounded-xl border border-slate-200 bg-white p-4 space-y-2"
          >
            <div className="flex justify-between items-start gap-2">
              <span className="text-sm font-semibold text-slate-900">{l.description}</span>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                ค้างรับ {l.remainingQty} / {l.orderedQty} {l.unitName}
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const cur = Number(qtys[l.id] || 0);
                  setQtys((prev) => ({ ...prev, [l.id]: String(Math.max(0, cur - 1)) }));
                }}
                className="min-h-[48px] min-w-[48px] rounded-lg border border-slate-300 bg-slate-100 text-lg font-bold text-slate-800"
              >
                −
              </button>
              <input
                type="number"
                step="0.001"
                min="0"
                max={l.remainingQty}
                value={qtys[l.id] ?? '0'}
                onChange={(e) => setQtys((prev) => ({ ...prev, [l.id]: e.target.value }))}
                className="flex-1 min-h-[48px] rounded-lg border border-slate-300 px-3 text-center text-base font-bold text-slate-900"
              />
              <button
                type="button"
                onClick={() => {
                  const cur = Number(qtys[l.id] || 0);
                  setQtys((prev) => ({
                    ...prev,
                    [l.id]: String(Math.min(l.remainingQty, cur + 1)),
                  }));
                }}
                className="min-h-[48px] min-w-[48px] rounded-lg border border-slate-300 bg-slate-100 text-lg font-bold text-slate-800"
              >
                +
              </button>
              <span className="text-xs text-slate-600 w-10">{l.unitName}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">วันที่รับของ</label>
            <DateInput
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              เลขที่ใบส่งของ (ถ้ามี)
            </label>
            <input
              type="text"
              value={deliveryNoteNo}
              onChange={(e) => setDeliveryNoteNo(e.target.value)}
              placeholder="เช่น DN-00123"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            ถ่ายรูปของที่มาส่ง / ใบส่งของ
          </label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">หมายเหตุ</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="สภาพสินค้า หรือหมายเหตุเพิ่มเติม..."
            className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
          />
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="w-full min-h-[52px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold shadow-sm disabled:opacity-50"
        >
          {pending ? 'กำลังบันทึก...' : 'ยืนยันรับของ'}
        </button>
      </div>
    </div>
  );
}
