'use client';

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Places a drop-down list against its box with fixed positioning, so a table or dialog that
 * scrolls or clips (overflow) cannot cut the list off. Opens upward when there is no room below.
 */
export function useFloatingList(anchor: RefObject<HTMLElement | null>, open: boolean, preferred = 288): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const up = below < Math.min(preferred, 200) && above > below;
      const maxHeight = Math.max(120, Math.min(preferred, up ? above : below));
      setStyle({
        position: 'fixed',
        left: r.left,
        minWidth: r.width,
        maxWidth: Math.min(576, window.innerWidth - r.left - 8),
        maxHeight,
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    // Follow the box every frame while open: page animations, scrolling and layout shifts all move it
    let frame = 0;
    let last = '';
    const tick = () => {
      const r = anchor.current?.getBoundingClientRect();
      const key = r ? `${r.left},${r.top},${r.width},${r.height},${window.innerWidth},${window.innerHeight}` : '';
      if (key !== last) {
        last = key;
        place();
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [anchor, open, preferred]);

  return open ? style : undefined;
}
