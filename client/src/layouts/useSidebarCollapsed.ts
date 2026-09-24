import { useCallback, useEffect, useState } from 'react';

const KEY = 'medassist.sidebarCollapsed';

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Desktop sidebar collapsed to icons: a per-browser display preference (not app state). */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(KEY, c ? '0' : '1');
      } catch {
        // Storage unavailable (private mode): the preference just isn't remembered.
      }
      return !c;
    });
  }, []);
  return [collapsed, toggle];
}

/** True while the media query matches (false where matchMedia is unavailable, e.g. tests). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
