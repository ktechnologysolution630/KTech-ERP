'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { formatThaiDateTime, fromBangkokLocalInput, overlaps, toBangkokLocalInput, TRIP_STATUS_LABEL, type TripStatus } from '@/domain/vehicle';
import { requestTripAction } from '../actions';

interface Booking {
  assetId: string;
  number: string;
  start: string;
  end: string;
  status: TripStatus;
  driverName: string;
}

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#2453d4] focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold text-slate-700';

function nextHalfHour(addHours = 0) {
  const d = new Date(Date.now() + addHours * 3_600_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return toBangkokLocalInput(d);
}

export function TripRequestForm({
  vehicles,
  drivers,
  projects,
  bookings,
  me,
  initialVehicle,
}: {
  vehicles: { id: string; label: string }[];
  drivers: { id: string; name: string }[];
  projects: { id: string; label: string }[];
  bookings: Booking[];
  me: string;
  initialVehicle?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assetId, setAssetId] = useState(vehicles.some((v) => v.id === initialVehicle) ? initialVehicle! : '');
  const [driverId, setDriverId] = useState(me);
  const [projectId, setProjectId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [start, setStart] = useState(() => nextHalfHour());
  const [end, setEnd] = useState(() => nextHalfHour(4));
  const [error, setError] = useState<string | null>(null);

  const startAt = fromBangkokLocalInput(start);
  const endAt = fromBangkokLocalInput(end);
  const ofVehicle = useMemo(() => bookings.filter((b) => b.assetId === assetId), [bookings, assetId]);
  const clash = startAt && endAt ? ofVehicle.find((b) => overlaps({ start: startAt, end: endAt }, { start: new Date(b.start), end: new Date(b.end) })) : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!assetId) return setError('กรุณาเลือกรถ');
    if (!purpose.trim()) return setError('กรุณาระบุวัตถุประสงค์');
    if (!startAt || !endAt) return setError('กรุณาระบุวันเวลาออกและคืนรถ');
    if (endAt <= startAt) return setError('เวลาคืนรถต้องหลังเวลาออก');
    if (clash) return setError(`รถคันนี้ถูกจองช่วงเวลานี้แล้ว (${clash.number})`);
    startTransition(async () => {
      try {
        const r = await requestTripAction({ assetId, driverId, projectId: projectId || null, purpose, destination, plannedStart: startAt, plannedEnd: endAt });
        if (!r.ok) return setError(r.error);
        router.push(`/vehicles/${r.value}`);
      } catch {
        setError('ไม่ได้รับคำตอบจากเซิร์ฟเวอร์ กรุณารอสักครู่แล้วกดส่งอีกครั้ง (ถ้าคำขอถูกบันทึกไปแล้ว ระบบจะแจ้งว่ารถถูกจองช่วงนี้)');
      }
    });
  };

  if (vehicles.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        ยังไม่มีรถให้จอง กรุณาให้ฝ่ายดูแลทรัพย์สินเพิ่มรถในทะเบียนทรัพย์สิน หมวด &quot;ยานพาหนะ&quot;
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="vt-vehicle" className={label}>
            รถ *
          </label>
          <select id="vt-vehicle" value={assetId} onChange={(e) => setAssetId(e.target.value)} className={field} required>
            <option value="">เลือกรถ</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {assetId && (
          <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-700">
              <CalendarClock className="h-4 w-4" /> คิวจองของรถคันนี้
            </p>
            {ofVehicle.length === 0 ? (
              <p className="text-slate-500">ว่างตลอด ยังไม่มีใครจอง</p>
            ) : (
              <ul className="space-y-0.5 text-slate-600">
                {ofVehicle.slice(0, 8).map((b) => (
                  <li key={b.number} className={b === clash ? 'font-semibold text-red-700' : ''}>
                    {formatThaiDateTime(b.start)} – {formatThaiDateTime(b.end)} · {b.driverName} · {TRIP_STATUS_LABEL[b.status]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <label htmlFor="vt-start" className={label}>
            วันเวลาออก *
          </label>
          <input id="vt-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={field} required />
        </div>
        <div>
          <label htmlFor="vt-end" className={label}>
            วันเวลาคืนรถ *
          </label>
          <input id="vt-end" type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={field} required />
        </div>

        <div>
          <label htmlFor="vt-driver" className={label}>
            ผู้ขับ *
          </label>
          <select id="vt-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} className={field}>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.id === me ? ' (ฉัน)' : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">ผู้ขับเป็นคนรับรถ ส่งตำแหน่ง และคืนรถ</p>
        </div>
        <div>
          <label htmlFor="vt-project" className={label}>
            โครงการ
          </label>
          <select id="vt-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
            <option value="">สำนักงาน / ส่วนกลาง</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="vt-purpose" className={label}>
            วัตถุประสงค์ *
          </label>
          <textarea id="vt-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} maxLength={500} placeholder="เช่น ขนวัสดุไปหน้างาน, รับลูกค้าดูโครงการ" className={field} required />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="vt-dest" className={label}>
            ปลายทาง
          </label>
          <input id="vt-dest" value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={300} placeholder="สถานที่ที่จะไป" className={field} />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ยกเลิก
        </button>
        <button type="submit" disabled={pending} className="rounded-lg bg-[#2453d4] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
          {pending ? 'กำลังส่ง...' : 'ส่งคำขอใช้รถ'}
        </button>
      </div>
    </form>
  );
}
