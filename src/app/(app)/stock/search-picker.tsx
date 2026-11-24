'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export interface PickerOption {
  value: string;
  label: string;
  /** Extra text that matches the search but is not shown (e.g. category) */
  keywords?: string;
}

/** Every word of the query must appear somewhere in the text (case-insensitive, Thai-safe). */
export function textMatches(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w) || hay.replace(/[-\s]/g, '').includes(w.replace(/[-\s]/g, '')));
}

/**
 * A dropdown you can type into: the first entry is "all" (value ''), the rest are filtered as you type.
 * Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
 */
export function SearchPicker({
  value,
  onChange,
  options,
  allLabel,
  placeholder,
  ariaLabel,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  allLabel: string;
  placeholder: string;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const list = useMemo(() => {
    const matched = query.trim() ? options.filter((o) => textMatches(`${o.label} ${o.keywords ?? ''}`, query.trim())) : options;
    return [{ value: '', label: allLabel }, ...matched.slice(0, 200)];
  }, [options, query, allLabel]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <div className={`flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs ${open ? 'border-brand' : 'border-slate-200'}`}>
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          value={open ? query : (selected?.label ?? allLabel)}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery('');
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(e.target.value.trim() ? 1 : 0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const o = list[active] ?? list[0];
              if (o) pick(o.value);
            } else if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className={`min-w-0 flex-1 bg-transparent focus:outline-none ${!open && value ? 'font-medium text-slate-900' : 'text-slate-700'}`}
        />
        {value && !open ? (
          <button type="button" aria-label="ล้างตัวเลือก" onClick={() => pick('')} className="text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute right-0 z-30 mt-1 max-h-72 w-full min-w-[260px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-lg">
          {list.map((o, i) => (
            <li
              key={o.value || '__all'}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-slate-100' : ''} ${o.value === value ? 'font-semibold text-brand' : 'text-slate-700'} ${i === 0 ? 'border-b border-slate-100' : ''}`}
            >
              {o.label}
            </li>
          ))}
          {list.length === 1 && query.trim() && <li className="px-3 py-2 text-slate-400">ไม่พบ “{query.trim()}”</li>}
        </ul>
      )}
    </div>
  );
}
