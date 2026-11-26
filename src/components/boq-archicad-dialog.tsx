'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Box, CheckCircle2, Download, Loader2, RefreshCw, X } from 'lucide-react';
import {
  ARCHICAD_BRIDGE_URL,
  BRIDGE_FILES,
  bridgeStatusSchema,
  bridgeTakeoffSchema,
  readBridgeRows,
  type ArchicadRow,
  type BridgeStatus,
} from '@/domain/archicad-bridge';
import { findInTakeoff, type ExistingItem } from '@/domain/ai-takeoff-merge';
import { QuantityPickTable } from '@/components/boq-quantity-pick-table';

export type ArchicadPickedItem = ArchicadRow;

type Conn = { state: 'checking' } | { state: 'no-bridge' } | { state: 'ready'; status: BridgeStatus };

/**
 * Pulls quantities from the Archicad model open on this computer, through the bridge the user runs
 * next to Archicad. The browser talks to the bridge on 127.0.0.1; nothing goes through the ERP server.
 */
export function ArchicadDialog({ existing, onAdd, onClose }: { existing: ExistingItem[]; onAdd: (items: ArchicadPickedItem[]) => void; onClose: () => void }) {
  const [conn, setConn] = useState<Conn>({ state: 'checking' });
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ArchicadRow[]>([]);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [pulled, setPulled] = useState(false);

  const probe = useCallback(
    () =>
      fetch(`${ARCHICAD_BRIDGE_URL}/status`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((json) => setConn({ state: 'ready', status: bridgeStatusSchema.parse(json) }))
        .catch(() => setConn({ state: 'no-bridge' })),
    [],
  );

  const check = useCallback(() => {
    setConn({ state: 'checking' });
    setError('');
    void probe();
  }, [probe]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const pull = async () => {
    setLoading(true);
    setError('');
    setWarnings([]);
    try {
      const res = await fetch(`${ARCHICAD_BRIDGE_URL}/takeoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const body = bridgeTakeoffSchema.parse(await res.json());
      if (!body.ok) {
        setError(body.error || 'ดึงปริมาณไม่สำเร็จ');
        if (res.status === 503) check();
        return;
      }
      const { rows: got, dropped } = readBridgeRows(body.rows);
      const dup = findInTakeoff(got, existing);
      setRows(got);
      // Rows already in the take-off start unticked so they are not counted twice
      setPicked(dup.map((d) => !d));
      setWarnings([...body.warnings, ...(dropped > 0 ? [`ข้าม ${dropped} แถวที่ไม่มีปริมาณ`] : [])]);
      setPulled(true);
    } catch {
      setError('ติดต่อตัวเชื่อมไม่ได้ ตรวจว่าหน้าต่างตัวเชื่อมยังเปิดอยู่');
      check();
    } finally {
      setLoading(false);
    }
  };

  const already = useMemo(() => findInTakeoff(rows, existing), [rows, existing]);
  const chosen = rows.filter((_, i) => picked[i]);
  const archicad = conn.state === 'ready' ? conn.status.archicad : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="ดึงปริมาณจาก Archicad">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Box className="h-4 w-4 text-brand" /> ดึงปริมาณจาก Archicad
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {/* Connection */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              {conn.state === 'checking' && (
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> กำลังหาตัวเชื่อมบนเครื่องนี้…
                </span>
              )}
              {conn.state === 'no-bridge' && (
                <span className="flex items-center gap-1.5 font-semibold text-amber-700">
                  <AlertCircle className="h-4 w-4" /> ยังไม่พบตัวเชื่อม Archicad บนเครื่องนี้
                </span>
              )}
              {conn.state === 'ready' && !archicad && (
                <span className="flex items-center gap-1.5 font-semibold text-amber-700">
                  <AlertCircle className="h-4 w-4" /> ตัวเชื่อมทำงานแล้ว แต่ยังไม่พบ Archicad ให้เปิด Archicad พร้อมโปรเจกต์
                </span>
              )}
              {conn.state === 'ready' && archicad && (
                <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> เชื่อมต่อ {archicad.version || 'Archicad'} แล้ว
                  {archicad.project && <span className="font-normal text-slate-600">· โปรเจกต์ {archicad.project}</span>}
                </span>
              )}
            </div>
            <button type="button" onClick={check} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50" title="ตรวจการเชื่อมต่ออีกครั้ง">
              <RefreshCw className="h-3 w-3" /> ตรวจอีกครั้ง
            </button>
          </div>

          {conn.state === 'no-bridge' && (
            <ol className="list-decimal space-y-1 rounded-lg bg-slate-50 p-3 pl-7 text-slate-700">
              <li>
                ดาวน์โหลด 2 ไฟล์นี้ไว้ในโฟลเดอร์เดียวกันบนเครื่องที่ติดตั้ง Archicad (ทำครั้งเดียว ต้องมี Python 3):
                <span className="mt-1 flex flex-wrap gap-2">
                  {BRIDGE_FILES.map((t) => (
                    <a key={t.href} href={t.href} download className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-brand hover:bg-blue-50" title={t.hint}>
                      <Download className="h-3 w-3" /> {t.label}
                    </a>
                  ))}
                </span>
              </li>
              <li>เปิด Archicad พร้อมโปรเจกต์ แล้วดับเบิลคลิก start_archicad_bridge.bat (เปิดหน้าต่างนั้นค้างไว้)</li>
              <li>กด &quot;ตรวจอีกครั้ง&quot; ถ้าเบราว์เซอร์ถามสิทธิ์เข้าถึงอุปกรณ์ในเครือข่าย ให้กดอนุญาต</li>
            </ol>
          )}

          {conn.state === 'ready' && archicad && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-700">ดึงจาก:</span>
              <label className="flex items-center gap-1">
                <input type="radio" name="ac-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> ทั้งโมเดล
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="ac-scope" checked={scope === 'selected'} onChange={() => setScope('selected')} /> เฉพาะที่เลือกไว้ใน Archicad
              </label>
              <button type="button" onClick={() => void pull()} disabled={loading} className="ml-auto flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Box className="h-3.5 w-3.5" />}
                {loading ? 'กำลังถอดปริมาณ…' : pulled ? 'ดึงใหม่' : 'ดึงปริมาณ'}
              </button>
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 font-semibold text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          {pulled && rows.length === 0 && !error && <p className="rounded-lg bg-slate-50 p-3 text-slate-600">ไม่พบชิ้นส่วนที่มีปริมาณในโมเดล{scope === 'selected' ? 'ส่วนที่เลือก' : ''}</p>}

          {rows.length > 0 && <QuantityPickTable rows={rows} picked={picked} already={already} onPick={setPicked} />}
          {warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-slate-500">
              {warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" disabled={chosen.length === 0} onClick={() => onAdd(chosen)} className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-hover disabled:opacity-40">
            เพิ่ม {chosen.length} รายการ
          </button>
        </div>
      </div>
    </div>
  );
}
