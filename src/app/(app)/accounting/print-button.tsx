'use client';

import { Printer } from 'lucide-react';

/** Prints the report copy placed in the page's PrintRoot */
export function PrintButton({ label = 'พิมพ์ A4' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
      <Printer className="h-4 w-4" /> {label}
    </button>
  );
}
