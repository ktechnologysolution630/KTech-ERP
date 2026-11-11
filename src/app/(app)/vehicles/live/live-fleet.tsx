'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { agoText, formatThaiDateTime, LIVE_STATE_LABEL, type LiveState } from '@/domain/vehicle';
import type { LiveVehicle } from '@/server/services/vehicles';
import { loadFleetLiveAction, loadTripRouteAction } from '../actions';
import { VehicleMap, type MapMarker } from '../vehicle-map';

const POLL_MS = 10_000;
const STATE_DOT: Record<LiveState, string> = { MOVING: 'bg-emerald-500', STOPPED: 'bg-blue-500', NO_SIGNAL: 'bg-slate-400', WAITING: 'bg-slate-300' };

export function LiveFleet({ initial }: { initial: { vehicles: LiveVehicle[]; at: string } }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [route, setRoute] = useState<[number, number][]>([]);
  // Relative times are worked out in the browser only, so the server's HTML matches the first render
  const [now, setNow] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await loadFleetLiveAction();
      if (r.ok) {
        setData(r.value);
        setError(null);
      } else setError(r.error);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ จะลองใหม่อัตโนมัติ');
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while the page is on screen; a hidden tab stops asking and catches up when shown again
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisible = () => {
      if (document.hidden) stop();
      else {
        void refresh();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisible);
    const clock = setInterval(() => setNow(new Date()), 5000);
    const first = setTimeout(() => setNow(new Date()), 0);
    return () => {
      stop();
      clearInterval(clock);
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // The selected vehicle's route, redrawn as new positions arrive
  useEffect(() => {
    if (!selected) return;
    let live = true;
    void loadTripRouteAction(selected).then((r) => {
      if (live && r.ok) setRoute(r.value);
    });
    return () => {
      live = false;
    };
  }, [selected, data.at]);

  const ago = (d: string | null) => (now ? agoText(d, now) : formatThaiDateTime(d));

  const markers = useMemo<MapMarker[]>(
    () =>
      data.vehicles
        .filter((v) => v.lat !== null && v.lng !== null)
        .map((v) => ({
          id: v.tripId,
          lat: v.lat!,
          lng: v.lng!,
          state: v.state,
          label: v.plateNo || v.vehicleCode,
          details: [
            `${v.vehicleName} · ${v.driverName}`,
            `${LIVE_STATE_LABEL[v.state]}${v.speedKmh ? ` ${v.speedKmh} กม./ชม.` : ''}`,
            `อัปเดต ${ago(v.lastSeenAt)}`,
            v.destination ? `ปลายทาง: ${v.destination}` : '',
          ].filter(Boolean),
          href: `/vehicles/${v.tripId}`,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, now],
  );

  const counts = data.vehicles.reduce<Record<LiveState, number>>((c, v) => ({ ...c, [v.state]: c[v.state] + 1 }), { MOVING: 0, STOPPED: 0, NO_SIGNAL: 0, WAITING: 0 });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(['MOVING', 'STOPPED', 'NO_SIGNAL', 'WAITING'] as LiveState[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
            <span className={`h-2 w-2 rounded-full ${STATE_DOT[s]}`} /> {LIVE_STATE_LABEL[s]} {counts[s]}
          </span>
        ))}
        <button type="button" onClick={() => void refresh()} disabled={loading} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'กำลังโหลด...' : `อัปเดต ${ago(data.at)}`}
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <VehicleMap markers={markers} route={selected ? route : undefined} selectedId={selected} onSelect={setSelected} className="h-[60vh] min-h-[360px]" />

        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="text-sm font-bold text-slate-900">รถที่ออกใช้งาน {data.vehicles.length} คัน</h2>
          {data.vehicles.length === 0 && <p className="py-6 text-center text-xs text-slate-500">ตอนนี้ไม่มีรถออกใช้งาน</p>}
          <ul className="max-h-[56vh] space-y-2 overflow-y-auto">
            {data.vehicles.map((v) => (
              <li key={v.tripId}>
                <button
                  type="button"
                  onClick={() => setSelected(selected === v.tripId ? null : v.tripId)}
                  aria-pressed={selected === v.tripId}
                  className={`w-full rounded-lg border p-2.5 text-left text-xs transition ${selected === v.tripId ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      {v.plateNo || v.vehicleCode} <span className="font-normal text-slate-500">{v.vehicleName}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-slate-700">
                      <span className={`h-2 w-2 rounded-full ${STATE_DOT[v.state]}`} />
                      {LIVE_STATE_LABEL[v.state]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-600">
                    {v.driverName}
                    {v.projectCode ? ` · ${v.projectCode}` : ''}
                    {v.speedKmh ? ` · ${v.speedKmh} กม./ชม.` : ''}
                  </p>
                  <p className="text-slate-500">อัปเดต {ago(v.lastSeenAt)}</p>
                  {v.overdue && (
                    <p className="mt-1 inline-flex items-center gap-1 font-semibold text-red-700">
                      <AlertTriangle className="h-3.5 w-3.5" /> เกินเวลาคืน ({formatThaiDateTime(v.plannedEnd)})
                    </p>
                  )}
                </button>
                <Link href={`/vehicles/${v.tripId}`} prefetch={false} className="mt-0.5 inline-block px-1 text-[11px] font-semibold text-[#2453d4] hover:underline">
                  {v.tripNumber} ดูรายละเอียด
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
