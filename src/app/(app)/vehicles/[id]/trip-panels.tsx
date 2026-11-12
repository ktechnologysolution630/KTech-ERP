'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, Trash2, X } from 'lucide-react';
import { formatMoneyDisplay } from '@/domain/money';
import { formatThaiDate } from '@/domain/thai';
import { EXPENSE_KIND_LABEL, EXPENSE_KINDS, FUEL_LEVELS, type LiveState, type TripExpenseKind } from '@/domain/vehicle';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { withRetry } from '@/lib/retry-action';
import { MAX_ODOMETER_KM } from '@/domain/vehicle';
import { addTripExpenseAction, cancelTripAction, decideTripAction, loadTripRouteAction, removeTripExpenseAction, returnTripAction, startTripAction } from '../actions';
import { VehicleMap } from '../vehicle-map';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#2453d4] focus:outline-none focus:ring-2 focus:ring-blue-100';
const labelCls = 'mb-1 block text-xs font-semibold text-slate-700';
const MAX_PHOTOS = 6;
/** Shown when the server did not answer even after trying again */
const NO_ANSWER = 'ส่งข้อมูลไม่สำเร็จ เซิร์ฟเวอร์ไม่ตอบกลับ กรุณารอสักครู่แล้วกดอีกครั้ง';
const RETRYING = 'กำลังเชื่อมต่อเซิร์ฟเวอร์อีกครั้ง...';

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
      {error}
    </p>
  ) : null;
}

/** Approve or refuse a request */
export function DecisionPanel({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = (approve: boolean) => {
    setError(null);
    if (!approve && !note.trim()) return setError('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
    startTransition(async () => {
      try {
        const r = await withRetry(() => decideTripAction(tripId, approve, note), { onRetry: () => setError(RETRYING) });
        setError(null);
        if (!r.ok) return setError(r.error);
        router.refresh();
      } catch {
        setError(NO_ANSWER);
      }
    });
  };
  return (
    <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <h2 className="text-sm font-bold text-slate-900">รอการอนุมัติจากคุณ</h2>
      {rejecting && <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="เหตุผลที่ไม่อนุมัติ" aria-label="เหตุผลที่ไม่อนุมัติ" className={field} />}
      <ErrorText error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {rejecting ? (
          <>
            <button type="button" onClick={() => setRejecting(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              กลับ
            </button>
            <button type="button" disabled={pending} onClick={() => decide(false)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {pending ? 'กำลังบันทึก...' : 'ยืนยันไม่อนุมัติ'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setRejecting(true)} className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700">
              <X className="h-4 w-4" /> ไม่อนุมัติ
            </button>
            <button type="button" disabled={pending} onClick={() => decide(true)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              <Check className="h-4 w-4" /> {pending ? 'กำลังบันทึก...' : 'อนุมัติ'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function CancelTripButton({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1 text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('ยกเลิกคำขอใช้รถนี้?')) return;
          setError(null);
          startTransition(async () => {
            const r = await cancelTripAction(tripId);
            if (!r.ok) return setError(r.error);
            router.refresh();
          });
        }}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? 'กำลังยกเลิก...' : 'ยกเลิกคำขอ'}
      </button>
      <ErrorText error={error} />
    </div>
  );
}

/** Taking the vehicle out, or bringing it back: odometer, fuel, photos of its condition */
export function HandoverForm({ tripId, stage, minOdometer }: { tripId: string; stage: 'START' | 'END'; minOdometer: number | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState('');
  const [note, setNote] = useState('');
  const [damage, setDamage] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setPreparing(true);
    const shrunk = await Promise.all([...files].map((f) => shrinkPhoto(f)));
    setPreparing(false);
    setPhotos((prev) => [...prev, ...shrunk].slice(0, MAX_PHOTOS));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const km = Number(odometer);
    if (odometer.trim() === '' || !Number.isFinite(km) || km < 0) return setError('กรุณากรอกเลขไมล์');
    if (km > MAX_ODOMETER_KM) return setError(`เลขไมล์ต้องไม่เกิน ${MAX_ODOMETER_KM.toLocaleString('th-TH')} กม. กรุณาตรวจตัวเลขอีกครั้ง`);
    if (minOdometer !== null && km < minOdometer) return setError(`เลขไมล์ต้องไม่น้อยกว่า ${minOdometer.toLocaleString('th-TH')} กม.`);
    if (!fuel) return setError('กรุณาเลือกระดับน้ำมัน');
    if (photos.length === 0) return setError('กรุณาถ่ายรูปสภาพรถอย่างน้อย 1 รูป');
    const form = new FormData();
    form.set('odometerKm', odometer);
    form.set('fuel', fuel);
    form.set('note', note);
    form.set('damage', damage);
    for (const p of photos) form.append('photos', p);
    startTransition(async () => {
      try {
        const r = await withRetry(() => (stage === 'START' ? startTripAction(tripId, form) : returnTripAction(tripId, form)), { onRetry: () => setError(RETRYING) });
        setError(null);
        // A first try that went through makes the second one find the trip already moved on
        if (!r.ok && !/สถานะ|ระหว่างใช้งาน/.test(r.error)) return setError(r.error);
        router.refresh();
      } catch {
        setError(NO_ANSWER);
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">{stage === 'START' ? 'รับรถ' : 'คืนรถ'}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`odo-${stage}`} className={labelCls}>
            เลขไมล์ (กม.) *
          </label>
          <input id={`odo-${stage}`} type="number" inputMode="decimal" step="0.1" min={minOdometer ?? 0} value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder={minOdometer !== null ? `ไม่น้อยกว่า ${minOdometer.toLocaleString('th-TH')}` : 'เลขบนหน้าปัด'} className={field} />
        </div>
        <div>
          <label htmlFor={`fuel-${stage}`} className={labelCls}>
            ระดับน้ำมัน *
          </label>
          <select id={`fuel-${stage}`} value={fuel} onChange={(e) => setFuel(e.target.value)} className={field}>
            <option value="">เลือก</option>
            {FUEL_LEVELS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        {stage === 'END' && (
          <div className="sm:col-span-2">
            <label htmlFor="damage" className={labelCls}>
              ความเสียหาย (ถ้ามี)
            </label>
            <input id="damage" value={damage} onChange={(e) => setDamage(e.target.value)} maxLength={1000} placeholder="เช่น กระจกข้างแตก, ยางรั่ว" className={field} />
          </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor={`note-${stage}`} className={labelCls}>
            หมายเหตุ
          </label>
          <input id={`note-${stage}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={stage === 'START' ? 'เช่น รอยเดิมที่มีอยู่ก่อนรับรถ' : ''} className={field} />
        </div>
      </div>

      <div>
        <p className={labelCls}>รูปสภาพรถ * (สูงสุด {MAX_PHOTOS} รูป)</p>
        <div className="flex flex-wrap gap-2">
          {previews.map((u, i) => (
            <div key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`รูปที่ ${i + 1}`} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
              <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label={`ลบรูปที่ ${i + 1}`} className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 text-red-600 shadow">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-[11px] text-slate-500 hover:bg-slate-50">
              <Camera className="h-5 w-5" />
              {preparing ? 'กำลังเตรียม' : 'ถ่ายรูป'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(e) => {
                  void addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>

      <ErrorText error={error} />
      <div className="flex justify-end">
        <button type="submit" disabled={pending || preparing} className="rounded-lg bg-[#2453d4] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
          {pending ? 'กำลังบันทึก...' : stage === 'START' ? 'ยืนยันรับรถ' : 'ยืนยันคืนรถ'}
        </button>
      </div>
    </form>
  );
}

export interface ExpenseView {
  id: string;
  kind: TripExpenseKind;
  amount: number;
  liters: number | null;
  paidOn: string;
  note: string;
  receiptUrl: string | null;
  canRemove: boolean;
}

/** Fuel, tolls and parking paid on the trip, each with its receipt */
export function ExpensesPanel({ tripId, expenses, canAdd }: { tripId: string; expenses: ExpenseView[]; canAdd: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<TripExpenseKind>('FUEL');
  const [amount, setAmount] = useState('');
  const [liters, setLiters] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!(Number(amount) > 0)) return setError('กรุณากรอกจำนวนเงิน');
    const form = new FormData();
    form.set('kind', kind);
    form.set('amount', amount);
    if (kind === 'FUEL' && liters) form.set('liters', liters);
    form.set('note', note);
    if (receipt) form.set('receipt', receipt);
    startTransition(async () => {
      try {
        const r = await addTripExpenseAction(tripId, form);
        if (!r.ok) return setError(r.error);
        setAmount('');
        setLiters('');
        setNote('');
        setReceipt(null);
        router.refresh();
      } catch {
        setError('ไม่ได้รับคำตอบจากเซิร์ฟเวอร์ กรุณาโหลดหน้าใหม่ดูว่ารายการถูกบันทึกแล้วหรือไม่ ก่อนกดเพิ่มอีกครั้ง');
      }
    });
  };

  const remove = (id: string) => {
    if (!window.confirm('ลบค่าใช้จ่ายรายการนี้?')) return;
    startTransition(async () => {
      const r = await removeTripExpenseAction(id);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">ค่าใช้จ่ายระหว่างใช้รถ</h2>
        <span className="text-sm font-bold text-slate-900">{formatMoneyDisplay(total.toFixed(2))} บาท</span>
      </div>
      {expenses.length === 0 ? (
        <p className="text-xs text-slate-500">ยังไม่มีค่าใช้จ่าย</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-xs">
          {expenses.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="font-semibold text-slate-800">
                  {EXPENSE_KIND_LABEL[e.kind]}
                  {e.liters ? ` ${e.liters} ลิตร` : ''}
                </p>
                <p className="text-slate-500">
                  {formatThaiDate(e.paidOn)}
                  {e.note ? ` · ${e.note}` : ''}
                  {e.receiptUrl && (
                    <>
                      {' · '}
                      <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#2453d4] underline">
                        ใบเสร็จ
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{formatMoneyDisplay(e.amount.toFixed(2))}</span>
                {e.canRemove && (
                  <button type="button" onClick={() => remove(e.id)} disabled={pending} aria-label="ลบค่าใช้จ่าย" className="text-slate-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <form onSubmit={add} className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
          <select value={kind} onChange={(e) => setKind(e.target.value as TripExpenseKind)} aria-label="ประเภทค่าใช้จ่าย" className={field}>
            {EXPENSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EXPENSE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input type="number" inputMode="decimal" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="จำนวนเงิน" aria-label="จำนวนเงิน" className={field} />
          {kind === 'FUEL' ? (
            <input type="number" inputMode="decimal" step="0.01" min={0} value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="ลิตร" aria-label="จำนวนลิตร" className={field} />
          ) : (
            <span />
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="หมายเหตุ" aria-label="หมายเหตุค่าใช้จ่าย" className={field} />
          <label className="col-span-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 sm:col-span-3">
            <Camera className="h-4 w-4" /> {receipt ? 'แนบใบเสร็จแล้ว' : 'ถ่ายรูปใบเสร็จ (ถ้ามี)'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) setReceipt(await shrinkPhoto(f));
              }}
            />
          </label>
          <button type="submit" disabled={pending} className="col-span-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-1">
            {pending ? 'กำลังบันทึก...' : 'เพิ่ม'}
          </button>
          <div className="col-span-2 sm:col-span-4">
            <ErrorText error={error} />
          </div>
        </form>
      )}
    </section>
  );
}

/** The route driven, redrawn every half minute while the trip is open */
export function TripRouteMap({ tripId, live, last }: { tripId: string; live: boolean; last: { lat: number; lng: number; state: LiveState; label: string } | null }) {
  const [route, setRoute] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      loadTripRouteAction(tripId)
        .then((r) => {
          if (!alive) return;
          if (r.ok) setRoute(r.value);
          else setError(r.error);
        })
        .catch(() => alive && setError('โหลดเส้นทางไม่สำเร็จ'));
    void load();
    const t = live ? setInterval(() => void load(), 30_000) : null;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [tripId, live]);
  const markers = last ? [{ id: tripId, lat: last.lat, lng: last.lng, state: last.state, label: last.label, details: [] }] : [];
  if (!last && route.length === 0) return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">{error ?? 'ยังไม่มีข้อมูลตำแหน่ง'}</p>;
  return <VehicleMap markers={markers} route={route} className="h-80" />;
}
