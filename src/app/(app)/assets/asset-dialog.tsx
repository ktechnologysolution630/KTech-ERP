'use client';

import React from 'react';
import { X } from 'lucide-react';

/** On a phone it fills the screen from the bottom up; on wider screens it is a centred box. */
export function Dialog({ title, onClose, busy, wide, children }: { title: string; onClose: () => void; busy?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className={`flex max-h-[94dvh] w-full flex-col rounded-t-2xl border border-slate-200 bg-white text-sm shadow-xl sm:max-h-full sm:rounded-xl sm:text-xs ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 py-2 pl-5 pr-2 sm:py-3 sm:pr-4">
          <h3 className="truncate text-base font-bold text-slate-900 sm:text-sm">{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 sm:p-1" title="ปิด" aria-label="ปิด">
            <X className="h-5 w-5 sm:h-4 sm:w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
