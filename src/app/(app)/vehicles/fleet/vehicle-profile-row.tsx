'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { VehicleRow } from '@/server/services/vehicles';
import { saveVehicleProfileAction } from '../actions';

const cell = 'w-full rounded border border-slate-300 px-2 py-1 text-xs text-right';
const toNum = (s: string) => (s.trim() === '' ? null : Number(s));

export function VehicleProfileRow({ vehicle: v, due, editable }: { vehicle: VehicleRow; due: { dueAtKm: number; remainingKm: number; due: boolean } | null; editable: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [plate, setPlate] = useState(v.plateNo);
  const [odo, setOdo] = useState(v.odometerKm?.toString() ?? '');
  const [every, setEvery] = useState(v.serviceEveryKm?.toString() ?? '');
  const [lastSvc, setLastSvc] = useState(v.lastServiceKm?.toString() ?? '');
  const [bookable, setBookable] = useState(v.bookable);

  const save = () => {
    setError(null);
    const nums = [toNum(odo), toNum(every), toNum(lastSvc)];
    if (nums.some((n) => n !== null && (!Number.isFinite(n) || n < 0))) return setError('ตัวเลขไม่ถูกต้อง');
    startTransition(async () => {
      const r = await saveVehicleProfileAction(v.id, { plateNo: plate, odometerKm: nums[0]!, serviceEveryKm: nums[1] === null ? null : Math.round(nums[1]), lastServiceKm: nums[2]!, bookable });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      router.refresh();
    });
  };

  const km = (n: number | null) => (n === null ? '-' : n.toLocaleString('th-TH'));

  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <p className="font-semibold text-slate-900">{v.name}</p>
        <p className="text-slate-500">
          {v.code}
          {v.inUseTripId && (
            <>
              {' · '}
              <Link href={`/vehicles/${v.inUseTripId}`} prefetch={false} className="font-semibold text-emerald-700 underline">
                กำลังใช้งาน
              </Link>
            </>
          )}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-red-700">
            {error}
          </p>
        )}
      </td>
      {editing ? (
        <>
          <td className="px-3 py-2">
            <input value={plate} onChange={(e) => setPlate(e.target.value)} aria-label="ทะเบียนรถ" className={`${cell} text-left`} />
          </td>
          <td className="px-3 py-2">
            <input type="number" min={0} step="0.1" value={odo} onChange={(e) => setOdo(e.target.value)} aria-label="เลขไมล์ล่าสุด" className={cell} />
          </td>
          <td className="px-3 py-2">
            <input type="number" min={0} step="1" value={every} onChange={(e) => setEvery(e.target.value)} aria-label="ซ่อมบำรุงทุกกี่กิโลเมตร" className={cell} />
          </td>
          <td className="px-3 py-2">
            <input type="number" min={0} step="0.1" value={lastSvc} onChange={(e) => setLastSvc(e.target.value)} aria-label="ซ่อมบำรุงล่าสุดที่เลขไมล์" className={cell} />
          </td>
          <td className="px-3 py-2 text-slate-400">-</td>
          <td className="px-3 py-2">
            <input type="checkbox" checked={bookable} onChange={(e) => setBookable(e.target.checked)} aria-label="ให้จองได้" />
          </td>
          <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-slate-300 px-2 py-1">
              ยกเลิก
            </button>
            <button type="button" disabled={pending} onClick={save} className="rounded bg-[#2453d4] px-2 py-1 font-semibold text-white disabled:opacity-50">
              {pending ? 'กำลังบันทึก' : 'บันทึก'}
            </button>
          </td>
        </>
      ) : (
        <>
          <td className="px-3 py-2">{v.plateNo || '-'}</td>
          <td className="px-3 py-2 text-right">{km(v.odometerKm)}</td>
          <td className="px-3 py-2 text-right">{km(v.serviceEveryKm)}</td>
          <td className="px-3 py-2 text-right">{km(v.lastServiceKm)}</td>
          <td className={`px-3 py-2 ${due?.due ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
            {due ? (due.remainingKm <= 0 ? `เลยกำหนด ${km(-due.remainingKm)} กม.` : `อีก ${km(due.remainingKm)} กม.`) : '-'}
          </td>
          <td className="px-3 py-2">{v.bookable ? 'ได้' : <span className="text-red-700">งดจอง</span>}</td>
          <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
            {v.bookable && (
              <Link href={`/vehicles/new?vehicle=${v.id}`} prefetch={false} className="rounded border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">
                จอง
              </Link>
            )}
            {editable && (
              <button type="button" onClick={() => setEditing(true)} className="rounded border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">
                แก้ไข
              </button>
            )}
          </td>
        </>
      )}
    </tr>
  );
}
