import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LANGS, lang, setLang, t } from './i18n';

// ------------------------------------------------------------------ icons (24px stroke icons)
const PATHS = {
  home: 'M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2 M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M17 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8',
  orders: 'M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M8 12h8 M8 16h5',
  bills: 'M6 2h12v20l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  tool: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  truck: 'M1 4h13v12H1z M14 9h4l3 3v4h-7 M5.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  trend: 'M22 7l-8.5 8.5-5-5L2 17 M16 7h6v6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  gem: 'M6 3h12l4 6-10 12L2 9z M2 9h20 M12 21L8 9l4-6 4 6z',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  trash: 'M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  print: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  x: 'M18 6L6 18 M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  menu: 'M3 12h18 M3 6h18 M3 18h18',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  chevron: 'M9 18l6-6-6-6',
  back: 'M15 18l-6-6 6-6',
  lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  coins: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M18.1 10.4A6 6 0 1 1 10.3 18 M7 6h1v4 M16.7 13.9l.7.7-2.8 2.8',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 8v8 M10 8v8 M13 8v8 M17 8v8',
  scale: 'M12 3v18 M5 21h14 M6 7h12 M6 7l-3 7a3 3 0 0 0 6 0z M18 7l-3 7a3 3 0 0 0 6 0z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  refresh: 'M23 4v6h-6 M1 20v-6h6 M3.5 9a9 9 0 0 1 14.9-3.4L23 10 M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z M7 7h.01',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z',
};

export function Icon({ name, size = 20, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(PATHS[name] || '').split(' M').map((d, i) => <path key={i} d={i === 0 ? d : `M${d}`} />)}
    </svg>
  );
}

// ------------------------------------------------------------------ toasts & confirm
const UiContext = createContext(null);
export const useUi = () => useContext(UiContext);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const nextId = useRef(1);
  const dismiss = useCallback((id) => setToasts((l) => l.filter((x) => x.id !== id)), []);
  const push = useCallback((kind, message) => {
    const id = nextId.current++;
    setToasts((l) => [...l.slice(-3), { id, kind, message }]);
    if (kind !== 'error') setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);
  const confirm = useCallback((options) => new Promise((resolve) => setDialog({ ...options, resolve })), []);
  const answer = (v) => { dialog?.resolve(v); setDialog(null); };
  const value = useMemo(() => ({ success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m), confirm }), [push, confirm]);
  return (
    <UiContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast-${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={x.kind === 'error' ? 'alert' : x.kind === 'info' ? 'refresh' : 'check'} />
            <span>{x.message}</span>
            <button className="icon-btn" onClick={() => dismiss(x.id)} aria-label={t('Close')}><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
      {dialog && (
        <Modal title={dialog.title} onClose={() => answer(false)} small footer={<>
          <button className="btn" onClick={() => answer(false)}>{dialog.cancelLabel || t('Cancel')}</button>
          <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answer(true)} autoFocus>{dialog.confirmLabel || t('Confirm')}</button>
        </>}>
          <p className="muted">{dialog.message}</p>
        </Modal>
      )}
    </UiContext.Provider>
  );
}

// ------------------------------------------------------------------ layout bits
export function Modal({ title, onClose, children, footer, small = false, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector('input:not([type=hidden]):not([type=file]), select, textarea');
    if (first && !ref.current.querySelector('[autofocus]')) first.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={`modal ${small ? 'modal-small' : ''} ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="page-head">
      <div className="page-title">
        {back}
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = '', flush = false }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && <header className="panel-head"><h2>{title}</h2>{action}</header>}
      <div className={flush ? '' : 'panel-body'}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Chips({ options, value, onChange, label }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          {o.label}{o.count != null && <span className="chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, autoFocus, onEnter }) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || t('Search')} aria-label={placeholder || t('Search')}
        autoFocus={autoFocus} onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(value); } }} />
      {value && <button type="button" className="icon-btn" onClick={() => onChange('')} aria-label={t('Clear')}><Icon name="x" size={16} /></button>}
    </div>
  );
}

const STATUS = {
  pending: ['Not started', 'slate'], inprogress: ['At the workshop', 'blue'], completed: ['Ready', 'green'],
  submitted: ['Delivered', 'ink'], draft: ['Draft', 'slate'], due: ['Unpaid', 'amber'], paid: ['Paid', 'green'],
  late: ['Late', 'red'], instock: ['In stock', 'green'], reserved: ['Reserved', 'amber'], sold: ['Sold', 'ink'],
  owner: ['Owner', 'gold'], employee: ['Employee', 'slate'],
};
export function Badge({ kind, children }) {
  const [label, tone] = STATUS[kind] || [kind, 'slate'];
  return <span className={`badge badge-${tone}`}>{children || t(label)}</span>;
}

export function GradeTag({ name, color }) {
  if (!name) return null;
  return <span className="grade-tag"><i style={{ background: color || '#c9a227' }} />{name}</span>;
}

export function Pager({ page, totalPages, onPage }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('Previous')}</button>
      <span>{t('Page {p} of {n}', { p: page, n: totalPages })}</span>
      <button className="btn btn-small" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>{t('Next')}</button>
    </div>
  );
}

export function Empty({ title, children, icon = 'gem', action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label }) {
  return <div className="loading" role="status"><i className="spinner" />{label || t('Loading…')}</div>;
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" /><span>{message}</span>
      {onRetry && <button className="btn btn-small" onClick={onRetry}>{t('Try again')}</button>}
    </div>
  );
}

export function Avatar({ src, name, size = 40, square = false }) {
  const initials = (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className={`avatar ${square ? 'square' : ''}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}

// Choose / change / remove a photo. `onPick(file|null)`; shows a preview immediately.
export function PhotoPicker({ value, onPick, label, round = false, size = 96 }) {
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);
  const shown = preview === '' ? null : preview || value;
  return (
    <div className="photo-pick">
      <button type="button" className={`photo-box ${round ? 'round' : ''}`} style={{ width: size, height: size }} onClick={() => input.current.click()} aria-label={label || t('Add photo')}>
        {shown ? <img src={shown} alt="" /> : <Icon name="camera" size={size / 3.4} />}
      </button>
      <div className="stack-sm">
        <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
          const f = e.target.files[0];
          if (f) { setPreview(URL.createObjectURL(f)); onPick(f); }
          e.target.value = '';
        }} />
        <button type="button" className="btn btn-small" onClick={() => input.current.click()}><Icon name="camera" size={16} />{shown ? t('Change photo') : t('Add photo')}</button>
        {shown && <button type="button" className="link-btn small" onClick={() => { setPreview(''); onPick(null); }}>{t('Remove photo')}</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ hooks
export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

// { data, loading, error, reload }. Re-runs when deps change, ignores stale answers, and refreshes
// quietly when a colleague changes something (the 'data:changed' event from ShopProvider).
export function useFetch(fetcher, deps, { live = true } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState((s) => ({ data: s.data, loading: false, error })));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  useEffect(() => {
    if (!live) return undefined;
    const on = () => setTick((x) => x + 1);
    window.addEventListener('data:changed', on);
    return () => window.removeEventListener('data:changed', on);
  }, [live]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { ...state, reload };
}

export function NumberInput({ value, onChange, step = 'any', min = 0, ...rest }) {
  return (
    <input type="number" inputMode="decimal" step={step} min={min} value={value ?? ''}
      onChange={(e) => onChange(e.target.value)} onWheel={(e) => e.target.blur()} {...rest} />
  );
}

export function LangSwitch({ compact = false }) {
  return (
    <div className={`lang-switch ${compact ? 'compact' : ''}`} role="group" aria-label="Language / Langue / اللغة">
      {LANGS.map((l) => (
        <button key={l.code} type="button" className={lang === l.code ? 'on' : ''} lang={l.code} onClick={() => lang !== l.code && setLang(l.code)}>
          {compact ? l.code.toUpperCase() : l.label}
        </button>
      ))}
    </div>
  );
}
