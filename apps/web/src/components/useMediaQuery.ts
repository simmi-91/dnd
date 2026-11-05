import { useCallback, useSyncExternalStore } from 'react';

/** Brytepunktet fra kapittel 8: nettbrett og laptop fra 700 px. */
export const WIDE_QUERY = '(min-width: 700px)';

/** Følger en media query. Uten `matchMedia` (f.eks. i tester) regnes det som mobil. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  const get = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, get, () => false);
}
