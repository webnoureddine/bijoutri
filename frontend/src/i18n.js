import { ar } from './locales/ar';
import { fr } from './locales/fr';

// Keys are the English text. The language is read once at start; switching reloads the page so
// every label (including ones built at module level) uses the same language.
export const LANGS = [
  { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
];
const DICTS = { ar, fr };

function readLang() {
  try {
    const saved = localStorage.getItem('jm_lang');
    if (saved && (saved === 'en' || DICTS[saved])) return saved;
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || 'fr').slice(0, 2);
  return DICTS[nav] || nav === 'en' ? nav : 'fr';
}

export const lang = readLang();
export const isRtl = lang === 'ar';
export const locale = lang === 'ar' ? 'ar-DZ-u-nu-latn' : lang === 'fr' ? 'fr-FR' : 'en-GB';

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
}

export function setLang(next) {
  try {
    localStorage.setItem('jm_lang', next);
  } catch {
    /* private mode */
  }
  window.location.reload();
}

const fill = (text, vars) => (vars ? text.replace(/\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);

// t('Save')   t('Bill #{id}', { id: 4 })
export function t(key, vars) {
  const dict = DICTS[lang];
  return fill((dict && dict[key]) ?? key, vars);
}

// Plural helper: tn(3, 'item', 'items') -> "3 articles"
export function tn(n, one, many) {
  // Arabic counts 11 and up take the singular noun (11 قطعة), 3 to 10 the plural (3 قطع).
  const singular = n === 1 || (lang === 'ar' && n > 10);
  return t(singular ? `{n} ${one}` : `{n} ${many}`, { n });
}

// Server messages are English; translate the ones we know (exact text or pattern).
const PATTERNS = [
  [/^This phone already belongs to (.+?)\. Pick them from the list or check the number\.$/, 'This phone already belongs to {name}. Pick them from the list or check the number.'],
  [/^This phone already belongs to (.+?)\.$/, 'This phone already belongs to {name}.'],
  [/^Order #(\d+) already has a saved bill\.$/, 'Order #{name} already has a saved bill.'],
  [/^Payment is more than the remaining (.+)\.$/, 'Payment is more than the remaining {name}.'],
  [/^Too many wrong passwords\. Try again in (\d+) minutes\.$/, 'Too many wrong passwords. Try again in {name} minutes.'],
  [/^(.+) is already sold or reserved\.$/, '{name} is already sold or reserved.'],
  [/^(.+) has left and cannot get new work\.$/, '{name} has left and cannot get new work.'],
  [/^(.+) has work history\. Set a leaving date instead of deleting\.$/, '{name} has work history. Set a leaving date instead of deleting.'],
  [/^Request was throttled\. Expected available in (\d+) seconds\.$/, 'Too many attempts. Wait {name} seconds.'],
];
export function tServer(message) {
  if (typeof message !== 'string') return message;
  const dict = DICTS[lang];
  if (dict && dict[message]) return dict[message];
  for (const [re, key] of PATTERNS) {
    const m = message.match(re);
    if (m) return t(key, { name: m[1] });
  }
  return message;
}
