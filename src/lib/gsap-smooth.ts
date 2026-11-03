import gsap from 'gsap';

/**
 * Detect if the client device is low-spec (e.g. <= 8GB RAM, <= 4 CPU threads, or prefers reduced motion)
 */
export function isLowSpecDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // Check reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return true;

  // Check device memory (Chrome/Edge API)
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory && nav.deviceMemory <= 8) {
    return true;
  }

  // Check CPU concurrency
  if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) {
    return true;
  }

  return false;
}

// Configure GSAP ticker for low CPU/GPU overhead
if (typeof window !== 'undefined') {
  // lagSmoothing(threshold, adjustedLag) - prevents sudden speedups if frames drop
  gsap.ticker.lagSmoothing(1000, 16);
}

/**
 * High-performance staggered entrance animation for cards/lists.
 * Uses only `transform` and `opacity` to avoid reflows.
 */
export function animateStaggerEntrance(
  targets: gsap.TweenTarget,
  options?: {
    stagger?: number;
    y?: number;
    duration?: number;
    onComplete?: () => void;
  },
) {
  if (typeof window === 'undefined') return;

  const isLow = isLowSpecDevice();
  const duration = isLow ? 0.2 : options?.duration ?? 0.35;
  const yOffset = isLow ? 8 : options?.y ?? 16;
  const staggerDelay = isLow ? 0.03 : options?.stagger ?? 0.06;

  return gsap.fromTo(
    targets,
    {
      opacity: 0,
      y: yOffset,
      force3D: true, // Promotes to GPU compositor layer
    },
    {
      opacity: 1,
      y: 0,
      duration,
      stagger: staggerDelay,
      ease: 'power2.out',
      clearProps: 'transform', // Clean up after animation so layout remains static
      onComplete: options?.onComplete,
    },
  );
}

/**
 * Snappy hover scale effect with zero layout thrashing
 */
export function animateHoverScale(
  element: HTMLElement,
  isHovered: boolean,
  scale = 1.015,
) {
  if (isLowSpecDevice()) return; // Skip scale transforms on low-spec for instant response

  gsap.to(element, {
    scale: isHovered ? scale : 1,
    duration: 0.2,
    ease: 'power1.out',
    force3D: true,
  });
}
