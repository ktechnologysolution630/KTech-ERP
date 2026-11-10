'use client';

import { useId, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export interface ComboItem {
  id: string;
  code: string;
  name: string;
}

const MAX_SHOWN = 50;

/**
 * Text box that searches a list as you type. Picking an entry calls `onPick`; typing anything
 * else is free text (`onType`), so a line need not come from the list.
 */
export function ItemCombobox({
  items,
  value,
  selectedId,
  onType,
  onPick,
  placeholder = 'พิมพ์ชื่อหรือรหัส เพื่อค้นหา / กรอกเอง',
  className = '',
}: {
  items: ComboItem[];
  /** Text shown in the box */
  value: string;
  /** Id of the picked entry, '' for free text */
  selectedId: string;
  onType: (text: string) => void;
  onPick: (item: ComboItem) => void;
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = value.trim().toLowerCase();
  // While an entry is picked, show the whole list so another can be chosen
  const matches = (selectedId || !q ? items : items.filter((i) => `${i.code} ${i.name}`.toLowerCase().includes(q))).slice(0, MAX_SHOWN);

  const pick = (item: ComboItem) => {
    onPick(item);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onType(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Let a click on an option land before the list closes
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full rounded border border-slate-300 bg-white py-1.5 pl-2 pr-12 text-xs focus:border-[#2453d4] focus:outline-none"
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {value && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onType('');
              inputRef.current?.focus();
            }}
            className="rounded p-0.5 text-slate-400 hover:text-slate-600"
            title="ล้าง"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="rounded p-0.5 text-slate-400 hover:text-slate-600"
          title="แสดงรายการ"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">
              {items.length === 0 ? 'ยังไม่มีสินค้าในคลัง' : 'ไม่พบในคลัง'} — ใช้ข้อความที่พิมพ์เป็นรายการใหม่
            </li>
          ) : (
            matches.map((it, i) => (
              <li
                key={it.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={it.id === selectedId}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(it)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-blue-50' : ''} ${it.id === selectedId ? 'font-semibold text-[#2453d4]' : 'text-slate-700'}`}
              >
                <span className="font-mono text-[11px] text-slate-500">{it.code}</span> {it.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
