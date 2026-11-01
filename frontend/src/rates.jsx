import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get } from './api';
import { useAuth } from './auth';
import { t } from './i18n';

const RateContext = createContext(null);
export const useRates = () => useContext(RateContext);

export function RateProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ rate: null, isToday: false, loading: true });

  const reload = useCallback(async () => {
    try {
      const data = await get('rate/latest/');
      setState({ rate: data.rate, isToday: data.isToday, loading: false });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  const value = useMemo(() => ({ ...state, reload }), [state, reload]);
  return <RateContext.Provider value={value}>{children}</RateContext.Provider>;
}

// The three choices offered when picking the rate for an order or bill.
export function rateOptions(rate, type) {
  if (!rate) return [];
  return type === 'silver'
    ? [{ key: 'silver', label: t("Silver"), value: rate.silverRate }]
    : [
        { key: 'hallmark', label: t("Hallmark"), value: rate.hallmarkRate },
        { key: 'tajabi', label: t("Tajabi"), value: rate.tajabiRate },
      ];
}
