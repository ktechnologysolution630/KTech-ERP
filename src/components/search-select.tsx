'use client';

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { filterBySearch } from '@/lib/search-match';

interface Opt {
  value: string;
  label: string;
  group?: string;
  disabled: boolean;
}

const MAX_SHOWN = 100;

/** Plain text of option children such as `{p.code} - {p.name}` */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** The <option>s under a select's children, looking through fragments, arrays and <optgroup>s */
function collectOptions(children: ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode; value?: unknown; disabled?: boolean; label?: string }>(child)) return;
    if (child.type === 'option') {
      const label = textOf(child.props.children).replace(/\s+/g, ' ').trim();
      out.push({ value: child.props.value == null ? label : String(child.props.value), label, group, disabled: !!child.props.disabled });
    } else if (child.type === 'optgroup') {
      collectOptions(child.props.children, child.props.label, out);
    } else {
      collectOptions(child.props.children, group, out);
    }
  });
  return out;
}

const nativeValueSetter = () => Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;

/**
 * Drop-in for `<select>` on long lists (projects, vendors, customers, items, accounts): the box
 * takes typing and suggests matching options at once, by code or name, in Thai or English.
 * A hidden native <select> with the same props stays underneath, so `name`, `required`,
 * `onChange`, `value`/`defaultValue` and form submission behave exactly as before.
 */
export function SearchSelect({
  children,
  className,
  placeholder,
  id,
  style,
  'aria-label': ariaLabel,
  title,
  ...selectProps
}: SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) {
  const listId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => collectOptions(children), [children]);

  const initial = selectProps.value ?? selectProps.defaultValue;
  const [ownValue, setCurrent] = useState<string>(initial == null ? (options[0]?.value ?? '') : String(initial));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  // A controlled select follows its value prop; an uncontrolled one, what was last picked
  const current = selectProps.value !== undefined ? String(selectProps.value) : ownValue;

  // Read back what the native select holds (first render, form reset, options changing)
  const syncFromSelect = useCallback(() => {
    if (selectRef.current) setCurrent(selectRef.current.value);
  }, []);
  useEffect(syncFromSelect, [syncFromSelect, options]);
  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form) return;
    const onReset = () => setTimeout(syncFromSelect, 0);
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [syncFromSelect]);

  const selected = options.find((o) => o.value === current);
  // The empty-value option ("เลือกโครงการ", "ทุกผู้ขาย") reads as the placeholder
  const placeholderText = placeholder ?? options.find((o) => o.value === '')?.label ?? 'พิมพ์เพื่อค้นหา';
  const shownText = query ?? (selected && selected.value !== '' ? selected.label : '');

  const matches = useMemo(() => filterBySearch(options, query ?? '', (o) => `${o.label} ${o.group ?? ''}`), [options, query]);
  const shown = matches.slice(0, MAX_SHOWN);

  const close = () => {
    setOpen(false);
    setQuery(null);
  };

  const pick = (opt: Opt) => {
    const el = selectRef.current;
    if (!el || opt.disabled) return;
    if (el.value !== opt.value) {
      nativeValueSetter()?.call(el, opt.value);
      // React and any form listener (auto-search filters) see a real change
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // A controlled parent may refuse the change; show what the select holds afterwards
    setCurrent(el.value);
    close();
  };

  const disabled = !!selectProps.disabled;

  return (
    <div
      className={twMerge(
        'relative inline-flex items-center text-xs focus-within:border-brand',
        // Without classes of its own it looks like a plain bordered box
        className ?? 'rounded border border-slate-300 bg-white px-2 py-1.5',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      style={style}
      title={title}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required={selectProps.required || undefined}
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        disabled={disabled}
        value={shownText}
        placeholder={placeholderText}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        // Let a click on an option land before the list closes
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && shown[active]) {
              e.preventDefault();
              pick(shown[active]);
            }
          } else if (e.key === 'Escape') {
            if (open) e.preventDefault();
            close();
          } else if (e.key === 'Tab' && open && query && shown.length === 1) {
            // Tab past a box narrowed to one option takes that option
            pick(shown[0]);
          }
        }}
        className="w-full min-w-0 flex-1 truncate bg-transparent pr-5 text-inherit outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
      <select
        ref={selectRef}
        {...selectProps}
        tabIndex={-1}
        aria-hidden
        onInvalid={(e) => {
          selectProps.onInvalid?.(e);
          inputRef.current?.focus();
        }}
        onChange={(e) => {
          selectProps.onChange?.(e);
          setCurrent(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px opacity-0"
      >
        {children}
      </select>

      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-72 w-max min-w-full max-w-[min(36rem,90vw)] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-xs text-slate-700 shadow-lg"
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">ไม่พบรายการที่ตรงกับ “{query}”</li>
          ) : (
            shown.map((o, i) => (
              <li
                key={`${o.value}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === current}
                aria-disabled={o.disabled || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-1.5 ${o.disabled ? 'cursor-not-allowed text-slate-300' : ''} ${
                  i === active ? 'bg-blue-50 text-slate-900' : ''
                } ${o.value === current ? 'font-semibold text-brand' : ''} ${o.value === '' ? 'text-slate-500' : ''}`}
              >
                {o.group && <span className="mr-1 text-[10px] text-slate-400">{o.group} ›</span>}
                {o.label || '—'}
              </li>
            ))
          )}
          {matches.length > MAX_SHOWN && (
            <li className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
              แสดง {MAX_SHOWN} จาก {matches.length} รายการ — พิมพ์เพิ่มเพื่อกรอง
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
