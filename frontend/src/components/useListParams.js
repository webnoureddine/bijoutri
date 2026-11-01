import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// Keeps list filters in the address bar so links and the back button restore them.
export function useListParams(defaults) {
  const [params, setParams] = useSearchParams();
  const value = {};
  Object.keys(defaults).forEach((k) => { value[k] = params.get(k) ?? defaults[k]; });
  const set = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === '' || v == null || v === defaults[k]) next.delete(k);
        else next.set(k, v);
      });
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams, defaults]);
  return [value, set];
}
