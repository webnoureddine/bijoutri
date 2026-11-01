import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearTokens, get, getTokens, post, setTokens } from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const loadProfile = useCallback(async () => {
    const profile = await get('auth/me/');
    setUser(profile);
    return profile;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (getTokens().access) {
        try {
          await loadProfile();
        } catch {
          clearTokens();
        }
      }
      if (alive) setReady(true);
    })();
    const onLogout = () => setUser(null);
    window.addEventListener('auth:logout', onLogout);
    return () => {
      alive = false;
      window.removeEventListener('auth:logout', onLogout);
    };
  }, [loadProfile]);

  // Returns { otpRequired: true } when a 6-digit code is needed next.
  const login = useCallback(async ({ username, password, otp, remember }) => {
    const data = await post('auth/login/', { username, password, otp, remember });
    if (data.otpRequired) return data;
    setTokens({ access: data.access, refresh: data.refresh }, remember);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    const { refresh } = getTokens();
    try {
      if (refresh) await post('auth/logout/', { refresh });
    } catch {
      /* already invalid */
    }
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user, ready, login, logout, reloadProfile: loadProfile, setUser, isOwner: user?.role === 'owner',
  }), [user, ready, login, logout, loadProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
