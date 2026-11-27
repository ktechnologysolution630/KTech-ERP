'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { StretchTabs } from '@/components/stretch-tabs';
import { compactNumber, niceAxisMax } from '@/domain/chart';
import { formatMoneyDisplay } from '@/domain/money';

const baht = (n: number) => formatMoneyDisplay(n, 0);

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* Sparkline                                                            */
/* ------------------------------------------------------------------ */

export function Sparkline({ values, color = 'currentColor', className = '' }: { values: number[]; color?: string; className?: string }) {
  const w = 96;
  const h = 32;
  if (values.length < 2 || values.every((v) => v === 0)) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
        <line x1={2} x2={w - 2} y1={h / 2} y2={h / 2} stroke={color} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />
      </svg>
    );
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [2 + (i / (values.length - 1)) * (w - 4), 3 + (1 - (v - min) / span) * (h - 6)] as const);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Catmull-Rom curve through the points, as cubic Béziers. */
function smoothPath(pts: readonly (readonly [number, number])[]) {
  if (pts.length === 0) return '';
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Monthly net cash: bars above the line when more came in than went out */
/* ------------------------------------------------------------------ */

export function CashNetBars({ rows, inColor, outColor }: { rows: { label: string; fullLabel: string; net: number }[]; inColor: string; outColor: string }) {
  const [active, setActive] = useState<number | null>(null);
  const largest = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const shown = active !== null ? rows[active] : null;
  return (
    <div>
      <div className="h-4 text-[11px] text-slate-500">
        {shown ? (
          <>
            {shown.fullLabel} · <span className="font-mono font-semibold" style={{ color: shown.net >= 0 ? inColor : outColor }}>{shown.net >= 0 ? '+' : '−'}{baht(Math.abs(shown.net))}</span>
          </>
        ) : (
          'ชี้ที่แท่งเพื่อดูยอดสุทธิของเดือน'
        )}
      </div>
      <div className="relative mt-2 flex h-24 items-stretch gap-1">
        <div className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
        {rows.map((r, i) => {
          const pct = (Math.abs(r.net) / largest) * 50;
          return (
            <div
              key={r.fullLabel}
              tabIndex={0}
              role="img"
              aria-label={`${r.fullLabel}: สุทธิ ${r.net >= 0 ? 'บวก' : 'ลบ'} ${baht(Math.abs(r.net))} บาท`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className={`relative flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand ${active === i ? 'bg-slate-100' : ''}`}
            >
              {r.net !== 0 && (
                <div
                  className="absolute inset-x-[15%] rounded-[3px]"
                  style={{
                    background: r.net >= 0 ? inColor : outColor,
                    height: `max(${pct}%, 2px)`,
                    ...(r.net >= 0 ? { bottom: '50%' } : { top: '50%' }),
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {rows.map((r, i) => (
          <span key={r.fullLabel} className={`flex-1 text-center text-[9px] text-slate-400 ${(rows.length - 1 - i) % 3 !== 0 ? 'invisible' : ''}`}>
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Year at a glance: smooth line chart with a switch between views      */
/* ------------------------------------------------------------------ */

export interface YearSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  values: number[];
}

export interface YearView {
  key: string;
  label: string;
  series: YearSeries[];
  emptyText: string;
}

export function YearAtAGlance({ months, views }: { months: { label: string; fullLabel: string }[]; views: YearView[] }) {
  const [viewKey, setViewKey] = useState(views[0]!.key);
  const [active, setActive] = useState<number | null>(null);
  const view = views.find((v) => v.key === viewKey) ?? views[0]!;
  const largest = Math.max(0, ...view.series.flatMap((s) => s.values));
  const axisMax = niceAxisMax(largest);
  const W = 640;
  const H = 200;
  const padT = 8;
  const padB = 8;
  const x = (i: number) => (months.length <= 1 ? W / 2 : (i / (months.length - 1)) * W);
  const y = (v: number) => padT + (1 - v / axisMax) * (H - padT - padB);

  // Each time the view changes the lines are drawn in from the left, like a pen across the chart
  const wipe = useRef<SVGRectElement>(null);
    useLayoutEffect(() => {
    if (!wipe.current || reducedMotion()) return;
    const tl = gsap.timeline();
    tl.fromTo(wipe.current, { attr: { width: 0 } }, { attr: { width: W + 20 }, duration: 1.1, ease: 'power2.inOut' });
    return () => {
      tl.kill();
    };
  }, [viewKey, largest]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-[11px] text-slate-600">
          {view.series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden>
                <line x1="1" x2="15" y1="3" y2="3" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={s.dashed ? '3 3' : undefined} />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
        <StretchTabs ariaLabel="เลือกกราฟ" options={views.map((v) => ({ value: v.key, label: v.label }))} value={viewKey} onChange={(k) => { setViewKey(k); setActive(null); }} />
      </div>

      {largest === 0 ? (
        <div className="flex h-52 items-center justify-center text-xs text-slate-400">{view.emptyText}</div>
      ) : (
        <div className="mt-4 flex gap-2">
          <div className="relative h-52 w-9 shrink-0 text-right text-[10px] text-slate-400">
            {[1, 0.5, 0].map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${((padT + (1 - t) * (H - padT - padB)) / H) * 100}%` }}>
                {compactNumber(axisMax * t)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-52" onMouseLeave={() => setActive(null)}>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                <defs>
                  <clipPath id={`yw-${view.key}`}>
                    <rect ref={wipe} x={-10} y={-20} width={W + 20} height={H + 40} />
                  </clipPath>
                  {view.series.map((s) => (
                    <linearGradient key={s.key} id={`yg-${view.key}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                {[1, 0.5, 0].map((t) => (
                  <line key={t} x1={0} x2={W} y1={y(axisMax * t)} y2={y(axisMax * t)} stroke={t === 0 ? '#d2d2d7' : '#f0f0f2'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                <g clipPath={`url(#yw-${view.key})`}>
                {view.series.map((s) => {
                  const pts = s.values.map((v, i) => [x(i), y(v)] as const);
                  const line = smoothPath(pts);
                  return (
                    <g key={s.key}>
                      {!s.dashed && <path d={`${line} L${x(s.values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#yg-${view.key}-${s.key})`} />}
                      <path d={line} fill="none" stroke={s.color} strokeWidth={2.25} strokeDasharray={s.dashed ? '5 5' : undefined} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                    </g>
                  );
                })}
                </g>
                {active !== null && <line x1={x(active)} x2={x(active)} y1={padT} y2={H - padB} stroke="#86868b" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
              </svg>
              {active !== null &&
                view.series.map((s) => (
                  <span
                    key={s.key}
                    className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                    style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(s.values[active] ?? 0) / H) * 100}%`, background: s.color }}
                  />
                ))}
              <div className="absolute inset-0 flex">
                {months.map((m, i) => (
                  <div
                    key={m.fullLabel}
                    tabIndex={0}
                    role="img"
                    aria-label={`${m.fullLabel}: ${view.series.map((s) => `${s.label} ${baht(s.values[i] ?? 0)}`).join(', ')}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="flex-1 outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                ))}
              </div>
              {active !== null && (
                <div
                  className="pointer-events-none absolute top-0 z-10 w-48 rounded-xl border border-slate-200 bg-white/95 p-2.5 text-[11px] shadow-lg backdrop-blur"
                  style={{
                    left:
                      active < months.length / 2
                        ? `clamp(0px, calc(${(x(active) / W) * 100}% + 10px), calc(100% - 192px))`
                        : `clamp(0px, calc(${(x(active) / W) * 100}% - 202px), calc(100% - 192px))`,
                  }}
                >
                  <div className="mb-1.5 font-semibold text-slate-900">{months[active]!.fullLabel}</div>
                  {view.series.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
                      <span className="inline-flex items-center gap-1.5 text-slate-600">
                        <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                        {s.label}
                      </span>
                      <span className="font-mono font-medium text-slate-900">{baht(s.values[active] ?? 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-1.5 flex">
              {months.map((m, i) => (
                <span
                  key={m.fullLabel}
                  className={`flex min-w-0 flex-1 justify-center whitespace-nowrap text-[10px] text-slate-500 ${months.length > 6 && (months.length - 1 - i) % 2 === 1 ? 'invisible sm:visible' : ''}`}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabbed panel: one card, several lists, a sliding pill to switch      */
/* ------------------------------------------------------------------ */

export function TabbedPanel({ tabs }: { tabs: { key: string; label: string; count?: number; tone?: 'red' | 'amber'; content: React.ReactNode }[] }) {
  const [key, setKey] = useState(tabs[0]!.key);
  const tab = tabs.find((t) => t.key === key) ?? tabs[0]!;
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!panel.current || reducedMotion()) return;
    const rows = panel.current.querySelectorAll('tbody tr, li');
    gsap.fromTo(panel.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
    if (rows.length) gsap.fromTo(rows, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.035, ease: 'power2.out', delay: 0.05 });
  }, [key]);
  return (
    <div>
      <StretchTabs
        ariaLabel="เลือกรายการ"
        size="md"
        value={key}
        onChange={setKey}
        options={tabs.map((t) => ({
          value: t.key,
          label: (
            <span className="inline-flex items-center gap-1.5">
              {t.label}
              {t.count !== undefined && (
                <span
                  className={`min-w-5 rounded-full px-1.5 text-[10px] font-semibold leading-4 ${
                    t.count === 0 ? 'bg-slate-200 text-slate-500' : t.tone === 'red' ? 'bg-rose-500 text-white' : t.tone === 'amber' ? 'bg-amber-400 text-amber-950' : 'bg-slate-700 text-white'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </span>
          ),
        }))}
      />
      <div ref={panel} role="tabpanel" className="mt-4">
        {tab.content}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section bar: stays under the header, the pill follows the scroll    */
/* ------------------------------------------------------------------ */

export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [current, setCurrent] = useState(sections[0]!.id);
  const jumping = useRef<number | null>(null);

  useEffect(() => {
    const onScroll = () => {
      if (jumping.current !== null) return;
      // The last section whose top has passed the line just below the sticky bars
      let id = sections[0]!.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) id = s.id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) id = sections[sections.length - 1]!.id;
      setCurrent(id);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [sections]);

  const go = (id: string) => {
    setCurrent(id);
    const el = document.getElementById(id);
    if (!el) return;
    if (jumping.current !== null) window.clearTimeout(jumping.current);
    jumping.current = window.setTimeout(() => {
      jumping.current = null;
    }, 900);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div className="sticky top-16 z-20 flex justify-center">
      <StretchTabs ariaLabel="ไปที่หัวข้อ" variant="dark" size="md" options={sections.map((s) => ({ value: s.id, label: s.label }))} value={current} onChange={go} />
    </div>
  );
}
