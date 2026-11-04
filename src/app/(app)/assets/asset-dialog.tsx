'use client';

import React from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, onClose, busy, wide, children }: { title: string; onClose: () => void; busy?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className={`flex max-h-full w-full flex-col rounded-xl border border-slate-200 bg-white text-xs shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h3 className="truncate text-sm font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
