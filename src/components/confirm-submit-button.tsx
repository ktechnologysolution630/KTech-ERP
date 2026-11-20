'use client';

import type { ReactNode } from 'react';

/** A submit button that asks first, for steps that cannot be undone such as cancelling a document */
export function ConfirmSubmitButton({ message, className, children }: { message: string; className?: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
