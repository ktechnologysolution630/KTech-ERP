'use client';

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import gsap from 'gsap';

/**
 * App-wide motion, Apple style: short, soft and never in the way of work.
 * Everything here is skipped when the user's system asks for reduced motion.
 */

const EASE = 'expo.out';
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Most rows worth animating; long tables animate their first screen only so big lists stay instant */
const MAX_ROWS = 24;
const MAX_BLOCKS = 14;

/**
 * The page fades and rises into place on every navigation (including tab changes), then its main
 * blocks and the first table rows follow in a light stagger.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion()) return;

    const blocks = collectBlocks(root);
    const rows = Array.from(root.querySelectorAll<HTMLElement>('tbody > tr')).slice(0, MAX_ROWS);

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: EASE } });
      tl.fromTo(root, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, clearProps: 'opacity,transform' });
      if (blocks.length > 1) {
        tl.fromTo(
          blocks,
          { opacity: 0, y: 14 },
          // A leftover transform would trap fixed-position dialogs inside the block, so it is always cleared
          { opacity: 1, y: 0, duration: 0.6, stagger: 0.045, clearProps: 'opacity,transform' },
          0.04,
        );
      }
      if (rows.length) {
        tl.fromTo(rows, { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.012, clearProps: 'opacity' }, 0.12);
      }
    }, root);
    return () => ctx.revert();
  }, [pathname, search]);

  return <div ref={ref}>{children}</div>;
}

/** The page's top-level blocks: the children of the first wrapper that holds more than one element */
function collectBlocks(root: HTMLElement): HTMLElement[] {
  let node: Element = root;
  for (let depth = 0; depth < 4; depth++) {
    const kids = Array.from(node.children).filter((k) => !(k instanceof HTMLScriptElement) && !k.classList.contains('fixed'));
    if (kids.length > 1) return kids.slice(0, MAX_BLOCKS) as HTMLElement[];
    if (kids.length === 0) break;
    node = kids[0]!;
  }
  return [];
}

/** Buttons and button-like links */
const PRESSABLE = 'button:not(:disabled), [role="button"], a[class*="bg-brand"], a[class*="bg-blue-"], a[class*="rounded-xl"][class*="border"], label[class*="rounded"][class*="cursor-pointer"]';

/**
 * Shell-wide micro-interactions, attached once:
 * - buttons sink a little when pressed and spring back,
 * - dialogs and sheets fade in while their panel scales up from 96%,
 * - sidebar groups unfold smoothly when opened.
 */
export function useShellMotion() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const pressed = new Set<HTMLElement>();
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(PRESSABLE);
      if (!el || el.closest('[data-no-press]')) return;
      pressed.add(el);
      gsap.to(el, { scale: 0.97, duration: 0.12, ease: 'power2.out', overwrite: 'auto' });
    };
    const up = () => {
      pressed.forEach((el) =>
        gsap.to(el, { scale: 1, duration: 0.45, ease: 'elastic.out(1, 0.55)', overwrite: 'auto', clearProps: 'transform' }),
      );
      pressed.clear();
    };
    document.addEventListener('pointerdown', down, { passive: true });
    document.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('pointercancel', up, { passive: true });
    window.addEventListener('blur', up);

    const observer = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (isOverlay(n)) animateOverlay(n);
          else if (n.closest('aside') && n.tagName === 'DIV' && n.parentElement?.closest('aside')) animateUnfold(n);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      observer.disconnect();
    };
  }, []);
}

function isOverlay(el: HTMLElement): boolean {
  if (el.getAttribute('role') === 'dialog' || el.tagName === 'DIALOG') return true;
  const c = el.classList;
  return c.contains('fixed') && c.contains('inset-0') && el.children.length > 0;
}

function animateOverlay(el: HTMLElement) {
  const panel = el.firstElementChild as HTMLElement | null;
  gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power1.out', clearProps: 'opacity' });
  if (panel) {
    gsap.fromTo(
      panel,
      { opacity: 0, scale: 0.96, y: 8 },
      { opacity: 1, scale: 1, y: 0, duration: 0.42, ease: EASE, clearProps: 'opacity,transform' },
    );
  }
}

/** Sidebar sub-menus open by height so the list below glides down instead of jumping */
function animateUnfold(el: HTMLElement) {
  if (!el.querySelector('a')) return;
  gsap.fromTo(
    el,
    { height: 0, opacity: 0, overflow: 'hidden' },
    { height: 'auto', opacity: 1, duration: 0.32, ease: 'power3.out', clearProps: 'height,opacity,overflow' },
  );
}
