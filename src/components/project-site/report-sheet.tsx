'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CurvePoint } from '@/domain/site-report';

export const NAVY = '#173a7a';
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export const thaiShortDate = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${TH_MONTHS[m! - 1]} ${String(y! + 543).slice(2)}`;
};

export const pct = (n: number) => `${n}%`;
export const points = (n: number) => `${n > 0 ? '+' : ''}${n} pp`;

/** Copies the report into a body-level node that is the only thing shown when printing. */
export function PrintRoot({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<div className="print-root">{children}</div>, document.body);
}

/** One A4 sheet on screen; on paper the sheet's padding gives way to the page margin. */
export function A4Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="a4-page mx-auto w-[210mm] min-h-[297mm] bg-white p-[10mm] text-[11px] leading-snug text-slate-800 shadow-md border border-slate-200 space-y-3">
      {children}
    </div>
  );
}

export function Logo({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="h-10 w-10 object-contain" />;
  }
  return <div className="flex h-10 w-10 items-center justify-center rounded bg-[#2453d4] text-sm font-bold text-white">KT</div>;
}

/** Section heading bar, as on the printed forms. */
export function Band({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-bold text-white" style={{ background: NAVY }}>
      <span>{children}</span>
      {right}
    </div>
  );
}

export function Sheet({ title, children, right }: { title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="keep-together border border-[#173a7a]">
      <Band right={right}>{title}</Band>
      {children}
    </section>
  );
}

/** Two-column label/value table. */
export function InfoGrid({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 divide-y divide-slate-200">
      {rows.map(([label, value], i) => (
        <div key={i} className={`grid grid-cols-[42%_1fr] ${i === 0 || i === 1 ? '!border-t-0' : ''}`}>
          <dt className="bg-slate-50 px-2 py-1 font-semibold text-slate-700">{label}</dt>
          <dd className="px-2 py-1 text-slate-900">{value || '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({ head, rows, empty, align }: { head: string[]; rows: React.ReactNode[][]; empty: string; align?: ('left' | 'right' | 'center')[] }) {
  const cls = (i: number) => (align?.[i] === 'right' ? 'text-right' : align?.[i] === 'center' ? 'text-center' : 'text-left');
  return (
    <table className="w-full text-[10.5px]">
      <thead className="bg-slate-100 text-slate-700">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`px-2 py-1 font-semibold ${cls(i)}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={head.length} className="px-2 py-2 text-center text-slate-500">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1 align-top ${cls(j)}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

const PLAN = '#2a78d6';
const ACTUAL = '#eb6834';

/** S-curve of planned vs actual cumulative progress, with a hover readout. */
export function ProgressCurve({ curve, cutoff, height = 240 }: { curve: CurvePoint[]; cutoff: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (curve.length === 0) {
    return <div className="py-10 text-center text-slate-500">ยังไม่มีแผนงาน — ใส่วันเริ่มและวันเสร็จของงานใน Gantt เพื่อให้แสดงกราฟ</div>;
  }
  const W = 720;
  const left = 38;
  const right = 16;
  const top = 12;
  const bottom = 26;
  const plotW = W - left - right;
  const plotH = height - top - bottom;
  const x = (i: number) => left + (curve.length === 1 ? plotW / 2 : (i / (curve.length - 1)) * plotW);
  const y = (v: number) => top + (1 - Math.min(100, Math.max(0, v)) / 100) * plotH;
  const path = (get: (p: CurvePoint) => number | null) =>
    curve.reduce((d, p, i) => {
      const v = get(p);
      return v === null ? d : `${d}${d ? ' L' : 'M'} ${x(i)} ${y(v)}`;
    }, '');
  const labelEvery = Math.max(1, Math.ceil(curve.length / 7));
  const cutoffIndex = curve.findIndex((p) => p.date === cutoff);
  const last = curve.reduce((acc, p, i) => (p.actual !== null ? i : acc), -1);
  const active = hover === null ? null : curve[hover];

  return (
    <div>
      <div className="flex flex-wrap gap-4 px-1 pb-1 text-[10.5px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: PLAN }} /> แผนงานสะสม (Plan)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: ACTUAL }} /> ผลงานจริงสะสม (Actual)
        </span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="w-full"
          role="img"
          aria-label={`กราฟความก้าวหน้า ณ ${thaiShortDate(cutoff)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - box.left) / box.width) * W;
            const i = Math.round(((px - left) / plotW) * (curve.length - 1));
            setHover(Math.min(curve.length - 1, Math.max(0, i)));
          }}
        >
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#cbd5e1' : '#eef2f6'} />
              <text x={left - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#64748b">
                {v}%
              </text>
            </g>
          ))}
          {curve.map((p, i) =>
            i % labelEvery === 0 || i === curve.length - 1 ? (
              <text key={p.date} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === curve.length - 1 ? 'end' : 'middle'} fontSize="9" fill="#64748b">
                {thaiShortDate(p.date)}
              </text>
            ) : null,
          )}
          {cutoffIndex >= 0 && <line x1={x(cutoffIndex)} x2={x(cutoffIndex)} y1={top} y2={top + plotH} stroke="#94a3b8" />}
          <path d={path((p) => p.planned)} fill="none" stroke={PLAN} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path((p) => p.actual)} fill="none" stroke={ACTUAL} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {last >= 0 && curve[last]!.actual !== null && (
            <>
              <circle cx={x(last)} cy={y(curve[last]!.actual as number)} r="4" fill={ACTUAL} stroke="#fff" strokeWidth="2" />
              <text x={x(last)} y={y(curve[last]!.actual as number) - 9} textAnchor={last > curve.length * 0.8 ? 'end' : 'middle'} fontSize="10" fontWeight="700" fill="#0f172a">
                {curve[last]!.actual}%
              </text>
            </>
          )}
          <text x={W - right} y={y(curve.at(-1)!.planned) - 7} textAnchor="end" fontSize="10" fill="#334155">
            แผน {curve.at(-1)!.planned}%
          </text>
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotH} stroke="#475569" />}
        </svg>
        {active && hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-40 rounded-lg border border-slate-200 bg-white p-2 text-[10.5px] shadow-lg"
            style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% ${hover > curve.length / 2 ? '- 168px' : '+ 8px'}), calc(100% - 160px))` }}
          >
            <div className="mb-1 font-semibold text-slate-900">{thaiShortDate(active.date)}</div>
            <div className="flex justify-between text-slate-600">
              <span>แผน</span>
              <span className="font-mono text-slate-900">{active.planned}%</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>จริง</span>
              <span className="font-mono text-slate-900">{active.actual === null ? '-' : `${active.actual}%`}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
