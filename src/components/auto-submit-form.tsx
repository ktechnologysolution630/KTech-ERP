'use client';

import { useEffect, useRef, useTransition, type FormHTMLAttributes } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const TYPING_DELAY_MS = 350;
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', '']);

/** Query string of a GET form, leaving out empty fields so URLs stay short */
function formQuery(form: HTMLFormElement): string {
  const params = new URLSearchParams();
  new FormData(form).forEach((v, k) => {
    if (typeof v === 'string' && v.trim() !== '') params.append(k, v.trim());
  });
  return params.toString();
}

/**
 * Filter form (GET) that applies itself: typing in a text box searches after a short pause,
 * and changing a dropdown, date or checkbox applies at once — no button or Enter needed.
 * It navigates in place, so the cursor stays in the box while results update.
 */
export function AutoSubmitForm({ children, className, ...rest }: FormHTMLAttributes<HTMLFormElement>) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPending, startTransition] = useTransition();

  const apply = () => {
    const form = formRef.current;
    if (!form) return;
    if (timer.current) clearTimeout(timer.current);
    const qs = formQuery(form);
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Only named boxes are filters; a search-select's own typing box has no name
  const isText = (el: EventTarget) => el instanceof HTMLInputElement && TEXT_TYPES.has(el.type);

  return (
    <form
      {...rest}
      ref={formRef}
      aria-busy={isPending || undefined}
      data-pending={isPending || undefined}
      className={`${className ?? ''} transition-opacity data-[pending]:opacity-80`}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      onInput={(e) => {
        if (!isText(e.target) || !(e.target as HTMLInputElement).name) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(apply, TYPING_DELAY_MS);
      }}
      onChange={(e) => {
        // Text boxes are handled while typing; this is for selects, dates and checkboxes
        if (isText(e.target) || !(e.target as unknown as { name?: string }).name) return;
        apply();
      }}
    >
      {children}
    </form>
  );
}
