import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translateY(8px)' },
  { opacity: 1, transform: 'none' },
];

/**
 * One 8px fade-up of the page container when the path changes (not on tab or filter changes,
 * which only touch the query string). Uses the Web Animations API, so the page is not remounted;
 * skipped when the user prefers reduced motion or the browser lacks the API (tests).
 */
export function usePageTransition<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const animation = el.animate(KEYFRAMES, {
      duration: 250,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
    });
    return () => animation.cancel();
  }, [pathname]);
  return ref;
}
