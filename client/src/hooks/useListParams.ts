import { useSearchParams } from 'react-router-dom';

/**
 * List filters and page kept in the URL query string, so views can be shared and survive a
 * reload (spec §12.1). Changing any filter goes back to page 1.
 */
export function useListParams() {
  const [params, setParams] = useSearchParams();
  const update = (changes: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  const clear = () => setParams({}, { replace: true });
  return {
    get: (key: string) => params.get(key) ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
    update,
    clear,
    hasAny: (...keys: string[]) => keys.some((k) => params.get(k)),
  };
}
