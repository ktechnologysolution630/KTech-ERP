'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { dateFieldProblem, formatDateText, maskDateText, parseDateText } from '@/domain/thai';

type DateInputProps = Pick<
  React.InputHTMLAttributes<HTMLInputElement>,
  'id' | 'name' | 'required' | 'disabled' | 'className' | 'onChange' | 'aria-label'
> & {
  value?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
};

/**
 * A native date input orders its fields by the browser's language, which the page cannot change,
 * so people on an English browser see month first. This shows day/month/year everywhere. A real
 * date input stays underneath: it holds the ISO value, submits with the form, opens the calendar
 * and fires the change events, so it swaps in for <input type="date"> as it is.
 */
export function DateInput({ id, name, required, disabled, className = '', onChange, value, defaultValue, min, max, 'aria-label': ariaLabel }: DateInputProps) {
  const nativeRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const typing = useRef(false);
  const [text, setText] = useState(() => formatDateText(value ?? defaultValue));
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    // What the parent holds wins, unless it is what the text already says or text is still being fixed
    if (value !== undefined && (parseDateText(text) ?? '') !== value) setText(formatDateText(value));
    // Only a new value from outside should replace what is being typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const native = nativeRef.current;
    if (!native) return;
    const message = disabled ? null : dateFieldProblem({ text, iso: native.value, min, max, required });
    native.setCustomValidity(message ?? '');
  });

  /** Sends the value through the native input, so the parent and the form see an ordinary change. */
  const emit = (iso: string) => {
    const native = nativeRef.current;
    if (!native || native.value === iso) return;
    typing.current = true;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(native, iso);
    native.dispatchEvent(new Event('input', { bubbles: true }));
    typing.current = false;
  };

  const settle = () => {
    const iso = parseDateText(text);
    setProblem(text.trim() !== '' && !iso);
    emit(iso ?? '');
    if (iso) setText(formatDateText(iso));
  };

  const openCalendar = () => {
    const native = nativeRef.current;
    if (!native || disabled) return;
    try {
      native.showPicker();
    } catch {
      native.focus();
    }
  };

  return (
    <span className={`relative inline-block focus-within:border-[#2453d4] ${disabled ? 'cursor-not-allowed bg-slate-50 opacity-70' : ''} ${className}`}>
      <span className="flex items-center gap-1">
        <input
          ref={textRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          size={10}
          maxLength={10}
          placeholder="วว/ดด/ปปปป"
          aria-label={ariaLabel}
          aria-invalid={problem || undefined}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            const masked = maskDateText(e.target.value);
            setText(masked);
            setProblem(false);
            // Sent as soon as it is whole; a part-typed date stays here until the field is left
            const iso = masked.length === 10 ? parseDateText(masked) : null;
            if (iso) emit(iso);
          }}
          onBlur={settle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') settle();
          }}
          className={`w-full min-w-[5.5rem] flex-1 bg-transparent outline-none disabled:cursor-not-allowed ${problem ? 'text-red-600' : ''}`}
        />
        <button type="button" onClick={openCalendar} disabled={disabled} tabIndex={-1} aria-label="เปิดปฏิทิน" className="shrink-0 text-slate-400 hover:text-[#2453d4] disabled:cursor-not-allowed">
          <Calendar className="h-3.5 w-3.5" />
        </button>
      </span>
      <input
        ref={nativeRef}
        type="date"
        name={name}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        {...(value !== undefined ? { value } : { defaultValue })}
        onChange={(e) => {
          if (!typing.current) {
            setText(formatDateText(e.target.value));
            setProblem(false);
          }
          onChange?.(e);
        }}
        // A form that refuses this field puts focus here; people need to be in the visible one
        onFocus={() => textRef.current?.focus()}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
    </span>
  );
}
