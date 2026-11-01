import axios from 'axios';
import { t, tServer } from './i18n';

const BASE = import.meta.env.VITE_API_URL || '/api';
export const api = axios.create({ baseURL: BASE });

const KEY = 'jm_tokens';
export function getTokens() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || sessionStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
// "Remember me" keeps the session in localStorage; otherwise it ends when the browser closes.
export function setTokens(tokens, remember) {
  try {
    const keep = remember ?? Boolean(localStorage.getItem(KEY));
    const value = JSON.stringify({ ...getTokens(), ...tokens });
    (keep ? localStorage : sessionStorage).setItem(KEY, value);
    (keep ? sessionStorage : localStorage).removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export function clearTokens() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

api.interceptors.request.use((config) => {
  const { access } = getTokens();
  if (access) config.headers.Authorization = `Bearer ${access}`;
  return config;
});

let refreshing = null;
async function refreshAccess() {
  const { refresh } = getTokens();
  if (!refresh) throw new Error('no refresh token');
  if (!refreshing) {
    refreshing = axios.post(`${BASE}/auth/refresh/`, { refresh })
      .then((res) => {
        setTokens({ access: res.data.access, ...(res.data.refresh ? { refresh: res.data.refresh } : {}) });
        return res.data.access;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.includes('auth/login') || original?.url?.includes('auth/refresh');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        const access = await refreshAccess();
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      } catch {
        clearTokens();
        window.dispatchEvent(new Event('auth:logout'));
      }
    }
    return Promise.reject(error);
  },
);

function flatten(value, label) {
  if (value == null) return [];
  if (typeof value === 'string') return [[label, value]];
  if (Array.isArray(value)) return value.flatMap((v) => flatten(v, label));
  if (typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => flatten(v, /^\d+$/.test(k) ? label : k));
  return [[label, String(value)]];
}

const LABELS = {
  name: 'Name', netWeight: 'Weight', weight: 'Weight', dueDate: 'Promised date', rate: 'Price', givenWeight: 'Metal given',
  returnedWeight: 'Weight returned', sellPrice: 'Selling price', staffName: 'Name', old_password: 'Current password',
  new_password: 'New password', password: 'Password', amount: 'Amount', orderItem: 'Item', staff: 'Craftsman', phone: 'Phone',
  email: 'Email', username: 'Username', code: 'Code', customer: 'Customer', supplier: 'Supplier', items: 'Items',
};

export function errorText(error) {
  if (!error?.response) return t('Cannot reach the server. Check the connection.');
  const { status, data } = error.response;
  if (status === 403) return tServer(data?.detail) || t('You are not allowed to do this.');
  if (status === 409) return t('Someone else changed this while you were editing. Reload the page to see their changes.');
  if (status >= 500 || typeof data !== 'object' || data === null) return t('The server had a problem. Try again.');
  const parts = flatten(data).filter(([k]) => k !== 'code').map(([k, msg]) => {
    const label = LABELS[k];
    return label ? `${t(label)}: ${tServer(msg)}` : tServer(msg);
  });
  return parts.length ? parts.join(' · ') : t('Something went wrong. Try again.');
}

export const get = (url, params) => api.get(url, { params }).then((r) => r.data);
export const post = (url, body, config) => api.post(url, body, config).then((r) => r.data);
export const put = (url, body) => api.put(url, body).then((r) => r.data);
export const patch = (url, body) => api.patch(url, body).then((r) => r.data);
export const del = (url) => api.delete(url).then((r) => r.data);
export const upload = (url, field, file) => {
  const fd = new FormData();
  if (file) fd.append(field, file);
  else fd.append('remove', '1');
  return api.post(url, fd).then((r) => r.data);
};
