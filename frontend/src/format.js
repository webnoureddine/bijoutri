import { isRtl, locale, t } from './i18n';

// The shop's units and currency, set by ShopProvider as soon as the settings arrive.
export const shop = { currencySymbol: 'DA', currencyDecimals: 2, weightUnit: 'g', weightDecimals: 2, priceQuantity: 1 };
export function setShopFormat(s) {
  Object.assign(shop, s);
}

const SYMBOLS_AR = { DA: 'دج', DZD: 'دج', 'د.ج': 'دج' };
const UNITS = { g: { ar: 'غ' }, kg: { ar: 'كغ' }, lal: { ar: 'لال' }, tola: { ar: 'تولة' } };

export const currency = () => (isRtl ? SYMBOLS_AR[shop.currencySymbol] || shop.currencySymbol : shop.currencySymbol);
export const unit = () => (isRtl ? UNITS[shop.weightUnit]?.ar || shop.weightUnit : shop.weightUnit);
// What the daily price refers to: "per g", "per 10 g"...
export const priceBasis = () => (shop.priceQuantity && shop.priceQuantity !== 1 ? t('per {n} {u}', { n: shop.priceQuantity, u: unit() }) : t('per {u}', { u: unit() }));

const nf = (min, max) => new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max });

export function plain(n) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  const d = shop.currencyDecimals ?? 2;
  return Math.abs(v - Math.round(v)) < 0.005 ? nf(0, 0).format(Math.round(v)) : nf(d, d).format(v);
}
export const money = (n) => (n == null || n === '' ? '—' : `${plain(n)} ${currency()}`);
export const weight = (n) => (n == null || n === '' ? '—' : `${nf(0, Math.max(shop.weightDecimals ?? 2, 2)).format(Number(n))} ${unit()}`);
export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

export function isoDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export function addDays(iso, days) {
  const d = iso ? new Date(`${iso}T00:00:00`) : new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
export function fmtDate(iso, withYear = true) {
  if (!iso) return '—';
  const d = new Date(String(iso).length > 10 ? iso : `${iso}T00:00:00`);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function daysFromToday(iso) {
  if (!iso) return null;
  return Math.round((new Date(`${iso}T00:00:00`) - new Date(`${isoDate()}T00:00:00`)) / 86400000);
}
export function dueLabel(iso) {
  const n = daysFromToday(iso);
  if (n == null) return '';
  if (n === 0) return t('Due today');
  if (n === 1) return t('Due tomorrow');
  if (n > 1) return t('In {n} days', { n });
  return n === -1 ? t('1 day late') : t('{n} days late', { n: -n });
}
// WhatsApp link with an Algerian number turned into the international form (05.. -> 2135..)
export function whatsapp(phone, text) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (p.startsWith('0')) p = `213${p.slice(1)}`;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
