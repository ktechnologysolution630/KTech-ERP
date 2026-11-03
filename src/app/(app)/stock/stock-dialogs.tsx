'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Plus, X } from 'lucide-react';
import type { StockItemDto, StockPageData } from '@/server/services/stock';
import { recordStockMovementAction, requestStockAdjustAction, saveStockItemAction } from './actions';

export type MovementKind = 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'ADJUST';

const KIND_LABEL: Record<MovementKind, string> = { RECEIVE: 'รับเข้า', ISSUE: 'จ่ายออก', TRANSFER: 'โอนย้าย', ADJUST: 'ปรับยอด' };
const inputClass = 'w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none disabled:bg-slate-50';
/** <select> value for the central store, whose projectId is null */
const CENTRAL = 'CENTRAL';
const toProjectId = (v: string) => (v === CENTRAL ? null : v);
const toOption = (id: string | null) => id ?? CENTRAL;

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Package className="w-4 h-4 text-[#2453d4]" />
            {title}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200" title="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-slate-700 font-semibold mb-1">
      {children}
      {required && <span className="text-red-500"> *</span>}
    </span>
  );
}

/** รับเข้า / จ่ายออก / โอนย้าย / ปรับยอด (adjustments become a request for approval). */
export function MovementDialog({
  data,
  initialKind,
  initialItemId,
  onClose,
}: {
  data: StockPageData;
  initialKind: MovementKind;
  initialItemId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const movable = data.locations.filter((l) =>
    l.projectId === null ? data.permissions.moveCentral : data.permissions.movableProjectIds.includes(l.projectId),
  );
  const [kind, setKind] = useState<MovementKind>(initialKind);
  const [itemId, setItemId] = useState(initialItemId ?? '');
  const [location, setLocation] = useState(toOption(movable[0]?.projectId ?? null));
  const [target, setTarget] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [locationUsed, setLocationUsed] = useState('');
  const [notes, setNotes] = useState('');

  const item = data.items.find((i) => i.id === itemId);
  const balanceHere = item?.balances.find((b) => toOption(b.projectId) === location)?.quantity ?? 0;

  if (movable.length === 0) {
    return (
      <DialogShell title="บันทึกรายการสต็อกสินค้า" onClose={onClose}>
        <p className="p-6 text-xs text-slate-600">คุณไม่มีสิทธิ์บันทึกรายการสต็อก (ต้องเป็นฝ่ายจัดซื้อ ผู้บริหาร หรือทีมหน้างานของโครงการ)</p>
      </DialogShell>
    );
  }

  const submit = () => {
    setError(null);
    const quantity = Number(qty);
    startTransition(async () => {
      const r =
        kind === 'ADJUST'
          ? await requestStockAdjustAction({
              stockItemId: itemId,
              projectId: toProjectId(location),
              countedQty: quantity,
              reason: notes,
            })
          : await recordStockMovementAction({
              stockItemId: itemId,
              projectId: toProjectId(location),
              type: kind,
              quantity,
              unitCost: kind === 'RECEIVE' && unitCost ? Number(unitCost) : undefined,
              targetProjectId: kind === 'TRANSFER' ? (target ? toProjectId(target) : undefined) : undefined,
              warehouseName: kind === 'RECEIVE' ? warehouseName || undefined : undefined,
              referenceNumber: kind === 'RECEIVE' ? supplierRef || undefined : undefined,
              locationUsed: kind === 'ISSUE' ? locationUsed || undefined : undefined,
              notes: notes || undefined,
            });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      if (kind === 'ADJUST') setDone(`ส่งคำขอปรับยอด ${r.value ?? ''} แล้ว รอผู้มีอำนาจอนุมัติ`);
      else onClose();
    });
  };

  return (
    <DialogShell title="บันทึกรายการสต็อกสินค้า" onClose={onClose}>
      <div className="grid grid-cols-4 border-b border-slate-200 text-xs text-center font-medium bg-slate-50/50">
        {(Object.keys(KIND_LABEL) as MovementKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setError(null);
              setDone(null);
            }}
            className={`py-2.5 border-b-2 transition ${
              kind === k ? 'border-[#2453d4] text-[#2453d4] font-bold bg-white' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {done ? (
        <div className="p-6 space-y-4 text-xs">
          <p className="text-emerald-700 font-medium">{done}</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-[#2453d4] text-white font-semibold">
              ปิด
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="p-5 space-y-3.5 text-xs"
        >
          <fieldset disabled={isPending} className="space-y-3.5">
            <label className="block">
              <Label required>เลือกสินค้า / วัสดุ</Label>
              <select
                required
                value={itemId}
                onChange={(e) => {
                  setItemId(e.target.value);
                  const it = data.items.find((x) => x.id === e.target.value);
                  if (it) setUnitCost(String(it.unitCost));
                }}
                className={inputClass}
              >
                <option value="">-- กรุณาเลือกวัสดุ --</option>
                {data.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    [{it.sku}] {it.name} (รวม {it.totalQty} {it.unit})
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <Label required>{kind === 'TRANSFER' ? 'คลังต้นทาง' : kind === 'RECEIVE' ? 'รับเข้าคลัง' : 'คลัง'}</Label>
                <select value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass}>
                  {movable.map((l) => (
                    <option key={toOption(l.projectId)} value={toOption(l.projectId)}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {item && (
                  <span className="block mt-1 text-[11px] text-slate-500">
                    คงเหลือที่นี่ {balanceHere.toLocaleString('th-TH')} {item.unit}
                  </span>
                )}
              </label>
              {kind === 'TRANSFER' ? (
                <label className="block">
                  <Label required>คลังปลายทาง</Label>
                  <select required value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
                    <option value="">-- เลือกคลังปลายทาง --</option>
                    {data.locations
                      .filter((l) => toOption(l.projectId) !== location)
                      .map((l) => (
                        <option key={toOption(l.projectId)} value={toOption(l.projectId)}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <label className="block">
                  <Label required>{kind === 'ADJUST' ? 'ยอดตรวจนับจริง' : 'จำนวน'}</Label>
                  <input
                    type="number"
                    step="any"
                    min={kind === 'ADJUST' ? 0 : 0.001}
                    required
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className={inputClass}
                  />
                </label>
              )}
            </div>

            {kind === 'TRANSFER' && (
              <label className="block">
                <Label required>จำนวน</Label>
                <input type="number" step="any" min={0.001} required value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} />
              </label>
            )}

            {kind === 'RECEIVE' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <Label>ราคาทุนต่อหน่วย (บาท)</Label>
                  <input type="number" step="0.01" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className={inputClass} />
                </label>
                <label className="block">
                  <Label>ชื่อคลัง / ตำแหน่งจัดเก็บ</Label>
                  <input value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} placeholder="เช่น ห้องเก็บของชั้น 1" className={inputClass} />
                </label>
                <label className="block col-span-2">
                  <Label>ผู้ขาย / เลขที่เอกสารอ้างอิง</Label>
                  <input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="เช่น ใบส่งของ 12345" className={inputClass} />
                </label>
              </div>
            )}

            {kind === 'ISSUE' && (
              <label className="block">
                <Label>ตำแหน่งหน้างานที่ใช้</Label>
                <input value={locationUsed} onChange={(e) => setLocationUsed(e.target.value)} placeholder="เช่น ชั้น 3 โซน A" className={inputClass} />
              </label>
            )}

            {kind === 'ADJUST' && item && qty !== '' && (
              <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                ส่วนต่าง {(Number(qty) - balanceHere).toLocaleString('th-TH')} {item.unit} · การปรับยอดต้องได้รับอนุมัติก่อนมีผลกับสต็อก
              </p>
            )}

            <label className="block">
              <Label required={kind === 'ADJUST'}>{kind === 'ADJUST' ? 'เหตุผลในการปรับยอด' : 'หมายเหตุ'}</Label>
              <textarea
                rows={2}
                required={kind === 'ADJUST'}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={kind === 'ADJUST' ? 'เช่น ตรวจนับพบชำรุด 2 ถุง' : 'ระบุรายละเอียดเพิ่มเติม...'}
                className={inputClass}
              />
            </label>
          </fieldset>

          {error && (
            <p role="alert" className="text-red-600 font-medium">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-100">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isPending || !itemId || qty === ''}
              className="px-4 py-2 rounded-lg font-semibold text-white bg-[#2453d4] hover:bg-[#1c43ab] disabled:opacity-60"
            >
              {isPending ? 'กำลังบันทึก...' : kind === 'ADJUST' ? 'ส่งคำขอปรับยอด' : 'บันทึกรายการ'}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

/** Create a catalog item, or edit one (incl. its reorder point). */
export function ItemDialog({ item, onClose }: { item: StockItemDto | null; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    category: item?.category ?? 'วัสดุโครงสร้าง',
    unit: item?.unit ?? 'ถุง',
    unitCost: item ? String(item.unitCost) : '',
    reorderPoint: item ? String(item.reorderPoint) : '',
    notes: item?.notes ?? '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <DialogShell title={item ? `แก้ไขวัสดุ ${item.sku}` : 'เพิ่มข้อมูลวัสดุใหม่'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = await saveStockItemAction({
              id: item?.id,
              sku: form.sku,
              name: form.name,
              category: form.category,
              unit: form.unit,
              unitCost: Number(form.unitCost || 0),
              reorderPoint: Number(form.reorderPoint || 0),
              notes: form.notes,
            });
            if (!r.ok) {
              setError(r.error);
              return;
            }
            router.refresh();
            onClose();
          });
        }}
        className="p-5 space-y-3.5 text-xs"
      >
        <fieldset disabled={isPending} className="space-y-3.5">
          <label className="block">
            <Label>รหัสวัสดุ (SKU)</Label>
            <input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="เว้นว่างให้ระบบออกรหัสให้" className={inputClass} />
          </label>
          <label className="block">
            <Label required>ชื่อวัสดุ / สินค้า</Label>
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label>หมวดหมู่</Label>
              <input value={form.category} onChange={(e) => set('category', e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <Label required>หน่วยนับ</Label>
              <input required value={form.unit} onChange={(e) => set('unit', e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <Label>ราคาทุนต่อหน่วย (บาท)</Label>
              <input type="number" step="0.01" min={0} value={form.unitCost} onChange={(e) => set('unitCost', e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <Label>จุดสั่งซื้อ (แจ้งเตือนเมื่อเหลือไม่เกิน)</Label>
              <input type="number" step="any" min={0} value={form.reorderPoint} onChange={(e) => set('reorderPoint', e.target.value)} className={inputClass} />
            </label>
          </div>
          <label className="block">
            <Label>หมายเหตุ</Label>
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="text-red-600 font-medium">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-100">
            ยกเลิก
          </button>
          <button type="submit" disabled={isPending} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg font-semibold text-white bg-[#2453d4] hover:bg-[#1c43ab] disabled:opacity-60">
            {!item && <Plus className="w-3.5 h-3.5" />}
            {isPending ? 'กำลังบันทึก...' : 'บันทึกวัสดุ'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
