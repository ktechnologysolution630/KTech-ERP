'use client';

import React, { useState } from 'react';
import { compactNumber, niceAxisMax } from '@/domain/chart';
import { formatMoneyDisplay } from '@/domain/money';

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

export interface ColumnRow {
  key: string;
  /** Axis label; may be shortened compared with `fullLabel` */
  label: string;
  fullLabel?: string;
  values: Record<string, number>;
}

const TICKS = [1, 0.75, 0.5, 0.25, 0];

function ChartCard({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Grouped columns on one axis, with a per-group tooltip and a table view of the same numbers. */
export function GroupedColumnChart({
  title,
  subtitle,
  series,
  rows,
  emptyText,
}: {
  title: string;
  subtitle: string;
  series: ColumnSeries[];
  rows: ColumnRow[];
  emptyText: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const largest = Math.max(0, ...rows.flatMap((r) => series.map((s) => r.values[s.key] ?? 0)));
  const axisMax = niceAxisMax(largest);

  const toggle = (
    <button type="button" onClick={() => setAsTable(!asTable)} className="shrink-0 text-[11px] font-medium text-[#2453d4] hover:underline">
      {asTable ? 'ดูเป็นกราฟ' : 'ดูเป็นตาราง'}
    </button>
  );

  return (
    <ChartCard title={title} subtitle={subtitle} action={largest > 0 ? toggle : undefined}>
      {largest === 0 ? (
        <div className="py-16 text-center text-xs text-slate-400">{emptyText}</div>
      ) : asTable ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ช่วง</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-right font-medium">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-1.5 text-slate-700">{r.fullLabel ?? r.label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right font-mono text-slate-800">{formatMoneyDisplay(r.values[s.key] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-600">
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            {/* Y axis */}
            <div className="relative h-48 w-9 shrink-0 text-right text-[10px] text-slate-400">
              {TICKS.map((t) => (
                <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>
                  {compactNumber(axisMax * t)}
                </span>
              ))}
            </div>

            <div className="min-w-0 flex-1">
              <div className="relative h-48">
                {TICKS.map((t) => (
                  <div key={t} className={`absolute inset-x-0 h-px ${t === 0 ? 'bg-slate-300' : 'bg-slate-100'}`} style={{ top: `${(1 - t) * 100}%` }} />
                ))}
                <div className="absolute inset-0 flex">
                  {rows.map((r, i) => (
                    <div
                      key={r.key}
                      tabIndex={0}
                      role="img"
                      aria-label={`${r.fullLabel ?? r.label}: ${series.map((s) => `${s.label} ${formatMoneyDisplay(r.values[s.key] ?? 0)}`).join(', ')}`}
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      className={`relative flex flex-1 items-end justify-center gap-0.5 rounded-t outline-none focus-visible:ring-2 focus-visible:ring-[#2453d4] ${active === i ? 'bg-slate-100/70' : ''}`}
                    >
                      {series.map((s) => {
                        const v = r.values[s.key] ?? 0;
                        return (
                          <div
                            key={s.key}
                            className="w-full max-w-[18px] rounded-t"
                            style={{ background: s.color, height: `${(v / axisMax) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
                {active !== null && rows[active] && (
                  <div
                    className="pointer-events-none absolute top-1 z-10 w-44 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] shadow-lg"
                    // Beside the hovered group, on the side with more room; clamped so it stays inside the chart (w-44 = 176px)
                    style={{
                      left:
                        active < rows.length / 2
                          ? `clamp(0px, calc(${((active + 1) / rows.length) * 100}% + 6px), calc(100% - 176px))`
                          : `clamp(0px, calc(${(active / rows.length) * 100}% - 182px), calc(100% - 176px))`,
                    }}
                  >
                    <div className="mb-1.5 font-semibold text-slate-900">{rows[active].fullLabel ?? rows[active].label}</div>
                    {series.map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                          <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="font-mono font-medium text-slate-900">{formatMoneyDisplay(rows[active].values[s.key] ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex">
                {rows.map((r, i) => (
                  <span
                    key={r.key}
                    // Too narrow for every label on a phone: keep every other one, counted from the latest
                    className={`flex min-w-0 flex-1 justify-center whitespace-nowrap text-[10px] text-slate-500 ${rows.length > 6 && (rows.length - 1 - i) % 2 === 1 ? 'invisible sm:visible' : ''}`}
                    title={r.fullLabel ?? r.label}
                  >
                    {r.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </ChartCard>
  );
}

/** One series, sorted bars with the value at the tip and its share of the total. */
export function HorizontalBarChart({
  title,
  subtitle,
  rows,
  color,
  emptyText,
}: {
  title: string;
  subtitle: string;
  rows: { label: string; amount: number }[];
  color: string;
  emptyText: string;
}) {
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const largest = Math.max(0, ...rows.map((r) => r.amount));
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {total === 0 ? (
        <div className="py-16 text-center text-xs text-slate-400">{emptyText}</div>
      ) : (
        <ul className="mt-5 space-y-4">
          {rows.map((r) => (
            <li key={r.label} title={`${r.label}: ${formatMoneyDisplay(r.amount)} บาท`}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-slate-700">{r.label}</span>
                <span className="shrink-0 font-mono text-slate-900">
                  {formatMoneyDisplay(r.amount, 0)} <span className="text-[10px] text-slate-500">({((r.amount / total) * 100).toFixed(0)}%)</span>
                </span>
              </div>
              <div className="mt-1.5 h-3">
                <div className="h-full rounded-r" style={{ background: color, width: `${(r.amount / largest) * 100}%`, minWidth: 2 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
