import { useCallback, useEffect, useState, type UIEvent } from 'react';

/** Pixels from the bottom that still count as "at the end" (sub-pixel scroll positions). */
const SLACK = 8;

const atBottom = (el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight - SLACK;

/**
 * True once the element has been scrolled to its end – or has nothing to scroll. Used to keep
 * "Approve" disabled until the doctor has seen the whole AI draft. Starts over when `resetKey`
 * changes (a new draft). Pass `attach` as the ref and `onScroll` to the scrolling element.
 */
export function useScrolledToEnd<T extends HTMLElement>(resetKey: string) {
  const [element, setElement] = useState<T | null>(null);
  /** The key the end was reached for. */
  const [seenFor, setSeenFor] = useState<string | null>(null);

  const check = useCallback(
    (el: HTMLElement | null) => {
      if (el && atBottom(el)) setSeenFor(resetKey);
    },
    [resetKey],
  );

  useEffect(() => {
    // After layout: a short draft that fits needs no scrolling.
    const frame = requestAnimationFrame(() => check(element));
    const onResize = () => check(element);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [element, check]);

  return {
    attach: setElement,
    atEnd: seenFor === resetKey,
    onScroll: (e: UIEvent<T>) => check(e.currentTarget),
  };
}
