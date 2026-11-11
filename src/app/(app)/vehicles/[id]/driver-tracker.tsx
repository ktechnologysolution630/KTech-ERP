'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigation, Pause, Play, WifiOff } from 'lucide-react';
import { MAX_ACCURACY_M, MAX_POINTS_PER_SEND, SEND_EVERY_MS, distanceKm } from '@/domain/vehicle';
import type { PositionInput } from '@/server/services/vehicles';
import { sendPositionsAction } from '../actions';

/** A point is kept when the vehicle moved this far, or this long passed, since the last one */
const MIN_MOVE_KM = 0.015;
const MIN_GAP_MS = 30_000;
/** Kept on the phone while offline; past this the oldest go */
const MAX_QUEUE = 5000;

type Point = { lat: number; lng: number; accuracyM: number | null; speedKmh: number | null; at: string };

const queueKey = (tripId: string) => `ktec-vt-queue:${tripId}`;
const onKey = (tripId: string) => `ktec-vt-on:${tripId}`;
function readQueue(tripId: string): Point[] {
  try {
    return JSON.parse(localStorage.getItem(queueKey(tripId)) ?? '[]') as Point[];
  } catch {
    return [];
  }
}
function writeQueue(tripId: string, q: Point[]) {
  try {
    localStorage.setItem(queueKey(tripId), JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch {
    // Storage full or blocked: the points in memory are still sent
  }
}
function flag(tripId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(onKey(tripId), '1');
    else localStorage.removeItem(onKey(tripId));
  } catch {}
}
function wasOn(tripId: string) {
  try {
    return localStorage.getItem(onKey(tripId)) === '1';
  } catch {
    return false;
  }
}

function geoError(err: GeolocationPositionError) {
  if (err.code === err.PERMISSION_DENIED) return 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาเปิดสิทธิ์ตำแหน่งให้เบราว์เซอร์ในการตั้งค่าของเครื่อง แล้วกดเริ่มอีกครั้ง';
  if (err.code === err.POSITION_UNAVAILABLE) return 'หาตำแหน่งไม่ได้ กรุณาเปิด GPS และอยู่ในที่โล่ง';
  return 'หาตำแหน่งช้าเกินไป ระบบจะลองต่อเอง';
}

/**
 * The driver's phone sends where the vehicle is while the trip is open. It keeps the screen awake
 * (a locked phone stops the browser from reading GPS), keeps points on the phone when the signal
 * drops and sends them once it is back, and starts again by itself if the page is reopened.
 */
export function DriverTracker({ tripId }: { tripId: string }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFix, setLastFix] = useState<Point | null>(null);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [queued, setQueued] = useState(0);
  const [offline, setOffline] = useState(false);
  const [awake, setAwake] = useState<boolean | null>(null);
  const [stopped, setStopped] = useState(false);

  const watch = useRef<number | null>(null);
  const queue = useRef<Point[]>([]);
  const last = useRef<Point | null>(null);
  const sending = useRef(false);
  const lock = useRef<WakeLockSentinel | null>(null);

  const keepAwake = useCallback(async () => {
    try {
      if (!('wakeLock' in navigator)) return setAwake(false);
      lock.current = await navigator.wakeLock.request('screen');
      setAwake(true);
      lock.current.addEventListener('release', () => setAwake(false));
    } catch {
      setAwake(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    void lock.current?.release().catch(() => {});
    lock.current = null;
    flag(tripId, false);
    setOn(false);
  }, [tripId]);

  const flush = useCallback(async () => {
    if (sending.current || queue.current.length === 0) return;
    sending.current = true;
    const batch = queue.current.slice(0, MAX_POINTS_PER_SEND);
    try {
      const r = await sendPositionsAction(tripId, batch satisfies PositionInput[]);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      queue.current = queue.current.slice(batch.length);
      writeQueue(tripId, queue.current);
      setQueued(queue.current.length);
      setLastSent(new Date());
      setOffline(false);
      if (!r.value.tracking) {
        // The trip was closed: nothing more to send
        setStopped(true);
        stop();
      }
    } catch {
      setOffline(true);
    } finally {
      sending.current = false;
    }
  }, [tripId, stop]);

  const start = useCallback(() => {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('เครื่องหรือเบราว์เซอร์นี้ระบุตำแหน่งไม่ได้');
      return;
    }
    if (watch.current !== null) return;
    queue.current = readQueue(tripId);
    setQueued(queue.current.length);
    watch.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        setError(null);
        const p: Point = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracyM: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
          speedKmh: coords.speed !== null && coords.speed >= 0 ? Math.round(coords.speed * 3.6 * 10) / 10 : null,
          at: new Date(timestamp).toISOString(),
        };
        setLastFix(p);
        if ((p.accuracyM ?? 0) > MAX_ACCURACY_M) return;
        const prev = last.current;
        const moved = !prev || distanceKm(prev, p) >= MIN_MOVE_KM;
        const waited = !prev || new Date(p.at).getTime() - new Date(prev.at).getTime() >= MIN_GAP_MS;
        if (!moved && !waited) return;
        last.current = p;
        queue.current.push(p);
        writeQueue(tripId, queue.current);
        setQueued(queue.current.length);
      },
      (err) => setError(geoError(err)),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 },
    );
    flag(tripId, true);
    setOn(true);
    void keepAwake();
  }, [tripId, keepAwake]);

  // Send on a timer while on; also send what was left from last time
  useEffect(() => {
    if (!on) return;
    void flush();
    const t = setInterval(() => void flush(), SEND_EVERY_MS);
    return () => clearInterval(t);
  }, [on, flush]);

  // The screen lock is lost whenever the page is hidden; take it back on return, and send at once
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && watch.current !== null) {
        void keepAwake();
        void flush();
      }
    };
    const online = () => void flush();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', online);
    };
  }, [keepAwake, flush]);

  // Reopening the page carries on where the driver left off
  useEffect(() => {
    if (wasOn(tripId)) start();
    return () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
      void lock.current?.release().catch(() => {});
    };
  }, [tripId, start]);

  if (stopped) return null;

  return (
    <section className={`space-y-3 rounded-xl border p-4 ${on ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`} aria-label="ส่งตำแหน่งรถ">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Navigation className={`h-4 w-4 ${on ? 'text-emerald-600' : 'text-amber-600'}`} />
          {on ? 'กำลังส่งตำแหน่งรถ' : 'ยังไม่ได้ส่งตำแหน่งรถ'}
        </h2>
        {on ? (
          <button type="button" onClick={stop} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
            <Pause className="h-3.5 w-3.5" /> หยุดชั่วคราว
          </button>
        ) : (
          <button type="button" onClick={start} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            <Play className="h-4 w-4" /> เริ่มส่งตำแหน่ง
          </button>
        )}
      </div>

      <p className="text-xs text-slate-700">
        {on
          ? 'เปิดหน้านี้ค้างไว้ระหว่างขับ ห้ามล็อกจอหรือสลับไปแอปอื่นนาน ไม่เช่นนั้นตำแหน่งจะหยุดส่ง'
          : 'กดเริ่มก่อนออกรถ และอนุญาตให้เบราว์เซอร์ใช้ตำแหน่งของเครื่อง'}
      </p>

      {on && (
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-white p-2">
            <dt className="text-slate-500">ความแม่นยำ</dt>
            <dd className="font-semibold text-slate-900">{lastFix?.accuracyM !== null && lastFix?.accuracyM !== undefined ? `±${lastFix.accuracyM} ม.` : 'กำลังหา...'}</dd>
          </div>
          <div className="rounded-lg bg-white p-2">
            <dt className="text-slate-500">ความเร็ว</dt>
            <dd className="font-semibold text-slate-900">{lastFix?.speedKmh !== null && lastFix?.speedKmh !== undefined ? `${Math.round(lastFix.speedKmh)} กม./ชม.` : '-'}</dd>
          </div>
          <div className="rounded-lg bg-white p-2">
            <dt className="text-slate-500">ส่งล่าสุด</dt>
            <dd className="font-semibold text-slate-900">{lastSent ? lastSent.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}</dd>
          </div>
          <div className="rounded-lg bg-white p-2">
            <dt className="text-slate-500">รอส่ง</dt>
            <dd className="font-semibold text-slate-900">{queued} จุด</dd>
          </div>
        </dl>
      )}

      {on && awake === false && <p className="text-xs font-medium text-amber-800">เครื่องนี้สั่งให้จอเปิดค้างไม่ได้ กรุณาตั้งให้หน้าจอไม่ล็อกอัตโนมัติระหว่างขับ</p>}
      {offline && (
        <p className="flex items-center gap-1 text-xs font-medium text-amber-800">
          <WifiOff className="h-3.5 w-3.5" /> สัญญาณอินเทอร์เน็ตขาด เก็บตำแหน่งไว้ในเครื่องก่อน จะส่งให้เมื่อสัญญาณกลับมา
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
