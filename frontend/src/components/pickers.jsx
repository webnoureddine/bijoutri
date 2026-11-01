import { useEffect, useRef, useState } from 'react';
import { get } from '../api';
import { money } from '../format';
import { t } from '../i18n';
import { MAKING, useShop } from '../shop.jsx';
import { Field, useDebounced } from '../ui.jsx';

export const EMPTY_CUSTOMER = { customerId: null, name: '', phone: '', address: '', email: '' };
export const asCustomer = (c) => (c ? { customerId: c.customerId, name: c.name || '', phone: c.phone || '', address: c.address || '', email: c.email || '' } : EMPTY_CUSTOMER);

// Type a name or a phone number: pick an existing customer, or keep typing to add a new one.
export function CustomerPicker({ value, onChange, errors = {}, locked = false, optional = false, compact = false }) {
  const [matches, setMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(Boolean(value.address || value.email));
  const typed = value.customerId ? '' : (value.name.length >= 2 ? value.name : value.phone.length >= 3 ? value.phone : '');
  const query = useDebounced(typed, 250);
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    if (!query) { setMatches([]); return undefined; }
    get('customers/', { q: query, all: 1 }).then((rows) => alive && setMatches(rows.slice(0, 6))).catch(() => alive && setMatches([]));
    return () => { alive = false; };
  }, [query]);

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (c) => { onChange(asCustomer(c)); setOpen(false); };
  const phoneOwner = !value.customerId && value.phone && matches.find((m) => m.phone === value.phone.trim());

  return (
    <div className="stack" style={{ gap: 12 }} ref={box}>
      <div className="form-grid">
        <Field label={optional ? t('Customer (optional)') : t('Customer name')} error={errors.name}>
          <div className="suggest">
            <input value={value.name} disabled={locked} placeholder={t('Name or phone to search')} autoComplete="off"
              onChange={(e) => { onChange({ ...value, name: e.target.value, customerId: null }); setOpen(true); }} onFocus={() => setOpen(true)} />
            {open && !value.customerId && matches.length > 0 && (
              <div className="suggest-list" role="listbox">
                {matches.map((c) => (
                  <button type="button" key={c.customerId} onClick={() => pick(c)} role="option">
                    <span className="cell-main">{c.name}</span>
                    <span className="cell-sub">{[c.phone, c.address].filter(Boolean).join(' · ') || t('No contact details')}{c.dueAmount > 0 ? ` · ${t('owes {amount}', { amount: money(c.dueAmount) })}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label={t('Phone')} error={errors.phone || (phoneOwner && phoneOwner.name.toLowerCase() !== value.name.trim().toLowerCase() ? t('This phone already belongs to {name}.', { name: phoneOwner.name }) : undefined)}>
          <input value={value.phone} disabled={locked} inputMode="tel" maxLength={20}
            onChange={(e) => { onChange({ ...value, phone: e.target.value }); setOpen(true); }} />
        </Field>
        {(more || !compact) && (
          <>
            <Field label={t('Address')}><input value={value.address} disabled={locked} maxLength={120} onChange={(e) => onChange({ ...value, address: e.target.value })} /></Field>
            <Field label={t('Email')} hint={t('To tell them when an order is ready')}><input type="email" value={value.email} disabled={locked} onChange={(e) => onChange({ ...value, email: e.target.value })} /></Field>
          </>
        )}
      </div>
      <div className="row">
        {value.customerId ? (
          <>
            <span className="pill-note old">{t('Existing customer')}</span>
            {!locked && <button type="button" className="link-btn small" onClick={() => onChange({ ...EMPTY_CUSTOMER })}>{t('Change customer')}</button>}
          </>
        ) : value.name.trim() ? <span className="pill-note new">{t('New customer, saved automatically')}</span> : null}
        {compact && !more && <button type="button" className="link-btn small" onClick={() => setMore(true)}>{t('Add address / email')}</button>}
      </div>
    </div>
  );
}

// Metal/karat select. `withPrice` shows today's selling price next to each.
export function GradeSelect({ value, onChange, includeInactive = false, allowEmpty = false, ...rest }) {
  const { grades } = useShop();
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} {...rest}>
      {allowEmpty && <option value="">{t('—')}</option>}
      {grades.filter((g) => includeInactive || g.isActive).map((g) => <option key={g.gradeId} value={g.gradeId}>{g.name}</option>)}
    </select>
  );
}

export function MakingSelect({ value, onChange, ...rest }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {MAKING().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
  );
}

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          {o.dot && <i className="dot" style={{ background: o.dot }} />}{o.label}
        </button>
      ))}
    </div>
  );
}
