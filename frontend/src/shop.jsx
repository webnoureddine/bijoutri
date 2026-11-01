import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get } from './api';
import { useAuth } from './auth';
import { setShopFormat } from './format';
import { t } from './i18n';

// Shop settings, metals (grades) with today's prices, and "a colleague changed something" polling.
const ShopContext = createContext(null);
export const useShop = () => useContext(ShopContext);

export function ShopProvider({ children, onRemoteChange }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [grades, setGrades] = useState([]); // active grades with .rate and .isToday
  const [allToday, setAllToday] = useState(true);
  const [loading, setLoading] = useState(true);
  const lastActivity = useRef(null);

  const reloadRates = useCallback(async () => {
    try {
      const data = await get('rates/today/');
      setGrades(data.grades);
      setAllToday(data.allToday);
    } catch {
      /* shown elsewhere */
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const s = await get('shop/');
      setShopFormat(s);
      setSettings(s);
      await reloadRates();
    } finally {
      setLoading(false);
    }
  }, [reloadRates]);

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  // Several people work at once: every 15 s ask "what is the latest change?". When it is someone
  // else's, every open list refreshes itself quietly (see useFetch in ui.jsx).
  useEffect(() => {
    if (!user) return undefined;
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const a = await get('activity/latest/');
        if (lastActivity.current !== null && a.id !== lastActivity.current) {
          if (a.user?.id !== user.id) {
            window.dispatchEvent(new CustomEvent('data:changed', { detail: a }));
            onRemoteChange?.(a);
          }
          if (a.action?.startsWith('rates') || a.action?.startsWith('shop')) reload();
        }
        if (!stop) lastActivity.current = a.id;
      } catch {
        /* offline for a moment */
      }
    };
    tick();
    const id = setInterval(tick, 15000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, reload, onRemoteChange]);

  const gradeById = useCallback((id) => grades.find((g) => g.gradeId === Number(id)), [grades]);
  const value = useMemo(() => ({ settings, grades, allToday, loading, reload, reloadRates, gradeById, setSettings }),
    [settings, grades, allToday, loading, reload, reloadRates, gradeById]);
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export const METHODS = () => [
  { value: 'cash', label: t('Cash') },
  { value: 'card', label: t('Card') },
  { value: 'cheque', label: t('Cheque') },
  { value: 'transfer', label: t('Bank transfer') },
];
export const methodLabel = (m) => ({ cash: t('Cash'), card: t('Card'), cheque: t('Cheque'), transfer: t('Bank transfer'), metal: t('Metal') }[m] || m);
export const MAKING = () => [
  { value: 'perWeight', label: t('Per weight unit') },
  { value: 'fixed', label: t('Per piece') },
  { value: 'percent', label: t('% of metal') },
];
