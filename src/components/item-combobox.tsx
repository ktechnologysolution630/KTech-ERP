'use client';

import { Fragment, useId, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { filterBySearch, similarBySearch } from '@/lib/search-match';
import { useFloatingList } from './use-floating-list';

export interface ComboItem {
  id: string;
  code: string;
  name: string;
}

const MAX_SHOWN = 50;
const MAX_NEAR = 8;

/**
 * Text box that searches a list as you type. Picking an entry calls `onPick`; typing anything
 * else is free text (`onType`), so a line need not come from the list. "อื่นๆ" at the bottom of
 * the list says so: it drops a picked entry and leaves the box for a name of one's own.
 */
export function ItemCombobox({
  items,
  value,
  selectedId,
  onType,
  onPick,
  placeholder = 'พิมพ์ชื่อหรือรหัส เพื่อค้นหา / กรอกเอง',
  className = '',
  related,
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
  /** More entries of the same kind as the typed text (e.g. the same item group), offered as close matches */
  related?: (text: string) => ComboItem[];
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** "อื่นๆ" was chosen: the box asks for a name of one's own */
  const [other, setOther] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listStyle = useFloatingList(boxRef, open, 240);

  // While an entry is picked, show the whole list so another can be chosen
  const matches = (selectedId ? items : filterBySearch(items, value, (i) => `${i.code} ${i.name}`)).slice(0, MAX_SHOWN);
  /**
   * Close matches under the direct ones: names spelt alike or sharing words, then entries of the
   * same kind, so "สังกะสีลอนเล็ก" still offers "สังกะสีลอนใหญ่" from the register
   */
  const near: ComboItem[] = [];
  if (!selectedId && value.trim()) {
    const seen = new Set(matches.map((m) => m.id));
    for (const it of [...similarBySearch(items, value, (i) => i.name), ...(related?.(value) ?? [])]) {
      if (near.length >= MAX_NEAR || seen.has(it.id)) continue;
      seen.add(it.id);
      near.push(it);
    }
  }
  /** Keyboard order: direct matches, close matches, then "อื่นๆ" */
  const options = [...matches, ...near];
  const otherIndex = options.length;

  const pick = (item: ComboItem) => {
    onPick(item);
    setOther(false);
    setOpen(false);
  };
  /** A picked entry gives way to an empty box; text already typed stays as the name */
  const pickOther = () => {
    if (selectedId) onType('');
    setOther(true);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? (active === otherIndex ? `${listId}-other` : options[active] ? `${listId}-${active}` : undefined) : undefined}
        value={value}
        placeholder={other && !selectedId ? 'ระบุชื่อรายการ' : placeholder}
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
            setActive((a) => Math.min(a + 1, otherIndex));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && active === otherIndex) {
            e.preventDefault();
            pickOther();
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full rounded border border-slate-300 bg-white py-1.5 pl-2 pr-12 text-xs focus:border-brand focus:outline-none"
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
        <ul id={listId} role="listbox" style={listStyle} className="z-[60] w-max overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-lg">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-slate-500">
              {items.length === 0 ? 'ยังไม่มีสินค้าในทะเบียน' : 'ไม่พบชื่อนี้ตรงๆ ในทะเบียนสินค้า'}
              {near.length === 0 ? ' — ใช้ข้อความที่พิมพ์เป็นรายการใหม่' : ''}
            </li>
          )}
          {options.map((it, i) => (
            <Fragment key={it.id}>
              {i === matches.length && (
                <li role="presentation" className="border-t border-slate-100 bg-amber-50/60 px-3 pb-1 pt-1.5 text-[11px] font-semibold text-amber-800">
                  รายการใกล้เคียง
                </li>
              )}
              <li
                id={`${listId}-${i}`}
                role="option"
                aria-selected={it.id === selectedId}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(it)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-blue-50' : ''} ${it.id === selectedId ? 'font-semibold text-brand' : 'text-slate-700'}`}
              >
                <span className="font-mono text-[11px] text-slate-500">{it.code}</span> {it.name}
              </li>
            </Fragment>
          ))}
          <li
            id={`${listId}-other`}
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={pickOther}
            onMouseEnter={() => setActive(otherIndex)}
            className={`mt-1 cursor-pointer border-t border-slate-100 px-3 py-1.5 text-slate-700 ${active === otherIndex ? 'bg-blue-50' : ''}`}
          >
            อื่นๆ <span className="text-[11px] text-slate-400">— ระบุชื่อรายการเอง</span>
          </li>
        </ul>
      )}
    </div>
  );
}
