'use client';

import { useState, useTransition } from 'react';
import { createPrAction, updatePrAction } from '@/app/(app)/pr/actions';

export interface PrItemOption {
  id: string;
  code: string;
  name: string;
  unitName: string;
}

export function PrForm({
  projects,
  items,
  existing,
}: {
  projects: { id: string; code: string; name: string }[];
  items: PrItemOption[];
  existing?: {
    id: string;
    projectId: string;
    note: string;
    lines: {
      itemId: string | null;
      description: string;
      unitName: string;
      qty: string;
      estUnitPrice: string | null;
      neededDate: string | null;
      note: string;
    }[];
  };
}) {
  const [projectId, setProjectId] = useState(existing?.projectId ?? (projects[0]?.id || ''));
  const [note, setNote] = useState(existing?.note ?? '');
  const [lines, setLines] = useState(
    existing?.lines.map((l) => ({
      itemId: l.itemId ?? '',
      description: l.description,
      unitName: l.unitName,
      qty: String(Number(l.qty)),
      estUnitPrice: l.estUnitPrice ?? '',
      neededDate: l.neededDate ?? '',
      note: l.note ?? '',
    })) ?? [
      {
        itemId: '',
        description: '',
        unitName: 'ชิ้น',
        qty: '1',
        estUnitPrice: '',
        neededDate: '',
        note: '',
      },
    ],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave(submitNow: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        if (existing) {
          await updatePrAction(existing.id, {
            note,
            submitNow,
            lines: lines.map((l) => ({
              itemId: l.itemId || null,
              description: l.description,
              unitName: l.unitName,
              qty: l.qty,
              estUnitPrice: l.estUnitPrice || null,
              neededDate: l.neededDate || null,
              note: l.note,
            })),
          });
        } else {
          await createPrAction({
            projectId,
            note,
            submitNow,
            lines: lines.map((l) => ({
              itemId: l.itemId || null,
              description: l.description,
              unitName: l.unitName,
              qty: l.qty,
              estUnitPrice: l.estUnitPrice || null,
              neededDate: l.neededDate || null,
              note: l.note,
            })),
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">โครงการ *</label>
          <select
            disabled={Boolean(existing)}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} - {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">หมายเหตุ</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ระบุจุดใช้งานหรือความเร่งด่วน..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">รายการที่ขอซื้อ</h3>
          <button
            type="button"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                {
                  itemId: '',
                  description: '',
                  unitName: 'ชิ้น',
                  qty: '1',
                  estUnitPrice: '',
                  neededDate: '',
                  note: '',
                },
              ])
            }
            className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
          >
            + เพิ่มรายการ
          </button>
        </div>

        {lines.map((line, idx) => (
          <div
            key={idx}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-lg border border-slate-200 p-3 bg-slate-50/60"
          >
            <div className="sm:col-span-3">
              <label className="block text-[11px] text-slate-500 mb-0.5">เลือกจากคลังสินค้า</label>
              <select
                value={line.itemId}
                onChange={(e) => {
                  const chosen = items.find((i) => i.id === e.target.value);
                  setLines((prev) =>
                    prev.map((row, i) =>
                      i === idx
                        ? {
                            ...row,
                            itemId: e.target.value,
                            description: chosen ? chosen.name : row.description,
                            unitName: chosen ? chosen.unitName : row.unitName,
                          }
                        : row,
                    ),
                  );
                }}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="">-- พิมพ์รายการเอง --</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.code} - {it.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3">
              <label className="block text-[11px] text-slate-500 mb-0.5">รายละเอียดสินค้า *</label>
              <input
                type="text"
                value={line.description}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)),
                  )
                }
                placeholder="ชื่อวัสดุ / สเปค"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">จำนวน *</label>
              <input
                type="number"
                step="0.001"
                value={line.qty}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-right text-xs"
              />
            </div>

            <div className="sm:col-span-1">
              <label className="block text-[11px] text-slate-500 mb-0.5">หน่วย *</label>
              <input
                type="text"
                value={line.unitName}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, unitName: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">วันที่ต้องการ</label>
              <input
                type="date"
                value={line.neededDate}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, neededDate: e.target.value } : r)),
                  )
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              />
            </div>

            <div className="sm:col-span-1 flex items-end justify-end">
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-xs text-red-600 hover:underline py-1.5"
                >
                  ลบ
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(false)}
          className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
        >
          บันทึกร่าง
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(true)}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
        >
          บันทึกและส่งขออนุมัติ
        </button>
      </div>
    </div>
  );
}
