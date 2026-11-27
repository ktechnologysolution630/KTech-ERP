'use client';

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { gsap } from 'gsap';

type Edges = { t: number; r: number; b: number; l: number };

export interface StretchTabOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Makes the tab a link (for tabs kept in the URL); the pill moves at once, before the new page loads */
  href?: string;
}

/**
 * Tabs whose highlight stretches toward the new tab: the leading edge moves first and fast,
 * the trailing edge catches up. The highlight is a full-size copy of the row clipped to the
 * chosen tab, so the label colour flips exactly under the pill.
 */
export function StretchTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = 'light',
  size = 'sm',
  className = '',
}: {
  options: StretchTabOption<T>[];
  value: T;
  onChange?: (v: T) => void;
  ariaLabel: string;
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const edges = useRef<Edges | null>(null);
  // Follows `value`, but moves straight away on a click so link tabs don't wait for the page
  const [shown, setShown] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setShown(value);
  }

  const slide = useCallback((animate: boolean) => {
    const box = row.current;
    const layer = pill.current;
    const target = box?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(shown)}"]`);
    if (!box || !layer || !target) return;
    const W = box.scrollWidth;
    const H = box.scrollHeight;
    const to: Edges = {
      t: target.offsetTop,
      l: target.offsetLeft,
      r: W - (target.offsetLeft + target.offsetWidth),
      b: H - (target.offsetTop + target.offsetHeight),
    };
    const clip = (e: Edges) => `inset(${e.t}px ${e.r}px ${e.b}px ${e.l}px round 999px)`;
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const st = edges.current;
    if (!st || !animate || reduce) {
      gsap.killTweensOf(edges.current ?? {});
      edges.current = { ...to };
      gsap.set(layer, { clipPath: clip(to) });
      return;
    }
    gsap.killTweensOf(st);
    const fwd = to.l > st.l;
    const [lead, trail] = fwd ? (['r', 'l'] as const) : (['l', 'r'] as const);
    const draw = () => gsap.set(layer, { clipPath: clip(st) });
    gsap.to(st, { t: to.t, b: to.b, [lead]: to[lead], duration: 0.36, ease: 'power3.out', onUpdate: draw });
    gsap.to(st, { [trail]: to[trail], duration: 0.55, ease: 'power3.inOut', onUpdate: draw });
  }, [shown]);

  useLayoutEffect(() => {
    slide(true);
  }, [slide, options.length]);

  useLayoutEffect(() => {
    const onResize = () => slide(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [slide]);

  const pad = size === 'md' ? 'px-3.5 py-1.5 text-xs' : 'px-3 py-1 text-[11px]';
  const track = variant === 'dark' ? 'bg-white/80 border border-slate-200/70 shadow-xs backdrop-blur' : 'bg-slate-100';
  const idle = variant === 'dark' ? 'text-slate-600 hover:text-slate-900' : 'text-slate-500 hover:text-slate-800';
  const layerBg = variant === 'dark' ? 'bg-ink' : 'bg-white';
  const activeText = variant === 'dark' ? 'text-white' : 'text-slate-900';

  return (
    <div className={`w-fit max-w-full overflow-x-auto rounded-full [scrollbar-width:none] ${track} ${className}`}>
      <div ref={row} role="tablist" aria-label={ariaLabel} className="relative inline-flex p-1">
        {options.map((o) => {
          const cls = `shrink-0 whitespace-nowrap rounded-full font-medium transition-colors ${pad} ${idle}`;
          const pick = () => {
            setShown(o.value);
            onChange?.(o.value);
          };
          return o.href ? (
            <Link key={o.value} href={o.href} role="tab" aria-selected={o.value === shown} data-tab={o.value} onClick={pick} className={cls}>
              {o.label}
            </Link>
          ) : (
            <button key={o.value} type="button" role="tab" aria-selected={o.value === shown} data-tab={o.value} onClick={pick} className={cls}>
              {o.label}
            </button>
          );
        })}
        {/* The pill: the same row in active colours, clipped to the current tab */}
        <div ref={pill} aria-hidden className={`pointer-events-none absolute inset-0 inline-flex p-1 ${layerBg}`} style={{ clipPath: 'inset(0 100% 0 0 round 999px)' }}>
          {options.map((o) => (
            <span key={o.value} className={`shrink-0 whitespace-nowrap rounded-full font-medium ${pad} ${activeText}`}>
              {o.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
