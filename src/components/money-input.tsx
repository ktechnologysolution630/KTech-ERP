'use client';

import { useState } from 'react';
import { parseDecimalInput } from '@/domain/money';

export function formatMoneyDisplay(value: string | number | undefined | null, decimals = 2): string {
  if (value === undefined || value === null || value === '') return '';
  const d = parseDecimalInput(String(value));
  if (!d) return String(value);
  const parts = d.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export function MoneyInput({
  name,
  defaultValue = '0.00',
  value: controlledValue,
  onChangeValue,
  decimals = 2,
  placeholder = '0.00',
  className = '',
  required = false,
}: {
  name?: string;
  defaultValue?: string | number;
  value?: string;
  onChangeValue?: (numericStr: string) => void;
  decimals?: number;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const [display, setDisplay] = useState(() =>
    formatMoneyDisplay(controlledValue ?? defaultValue, decimals),
  );
  const [rawValue, setRawValue] = useState(() => {
    const parsed = parseDecimalInput(String(controlledValue ?? defaultValue));
    return parsed ? parsed.toFixed(decimals) : '0.00';
  });

  const handleBlur = (text: string) => {
    const parsed = parseDecimalInput(text);
    if (parsed) {
      const fixed = parsed.toFixed(decimals);
      setRawValue(fixed);
      setDisplay(formatMoneyDisplay(fixed, decimals));
      onChangeValue?.(fixed);
    } else if (!text.trim()) {
      setRawValue('0.00');
      setDisplay('');
      onChangeValue?.('0.00');
    }
  };

  return (
    <div className="relative">
      {name && <input type="hidden" name={name} value={rawValue} />}
      <input
        type="text"
        inputMode="decimal"
        required={required}
        value={display}
        placeholder={placeholder}
        onChange={(e) => {
          setDisplay(e.target.value);
          const parsed = parseDecimalInput(e.target.value);
          if (parsed) {
            const fixed = parsed.toFixed(decimals);
            setRawValue(fixed);
            onChangeValue?.(fixed);
          }
        }}
        onBlur={(e) => handleBlur(e.target.value)}
        className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm focus:border-blue-600 focus:outline-none ${className}`}
      />
    </div>
  );
}
