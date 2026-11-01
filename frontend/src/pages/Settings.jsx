import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, del, errorText, get, patch, post, setTokens, upload } from '../api';
import { useAuth } from '../auth.jsx';
import { MakingSelect } from '../components/pickers.jsx';
import { fmtDateTime, money, setShopFormat, weight } from '../format';
import { t } from '../i18n';
import { useShop } from '../shop.jsx';
import { Avatar, Badge, Empty, Field, Icon, Loading, Modal, NumberInput, PageHeader, Panel, PhotoPicker, useFetch, useUi } from '../ui.jsx';

// ------------------------------------------------------------------ my account
function Account() {
  const ui = useUi();
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ full_name: user.full_name || '', email: user.email || '', phone: user.phone || '', jobTitle: user.jobTitle || '' });
  const [photo, setPhoto] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ old_password: '', new_password: '', again: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [twofa, setTwofa] = useState(null);
  const [code, setCode] = useState('');
  const logins = useFetch(() => get('auth/logins/', { page_size: 8 }), [], { live: false });

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
      if (photo) fd.append('profileImage', photo);
      if (photo === null) fd.append('remove', '1');
      const res = await api.post('auth/me/', fd);
      setUser(res.data);
      ui.success(t('Saved.'));
    } catch (err) { ui.error(errorText(err)); }
    setBusy(false);
  };
  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.again) { ui.error(t('The two passwords do not match.')); return; }
    setPwBusy(true);
    try {
      const res = await post('auth/password/', { old_password: pw.old_password, new_password: pw.new_password });
      setTokens({ access: res.access, refresh: res.refresh });
      setPw({ old_password: '', new_password: '', again: '' });
      ui.success(t('Password changed. Your other devices were signed out.'));
    } catch (err) { ui.error(errorText(err)); }
    setPwBusy(false);
  };
  const startTwofa = async () => { try { setTwofa(await post('auth/2fa/setup/')); } catch (e) { ui.error(errorText(e)); } };
  const enableTwofa = async () => { try { setUser(await post('auth/2fa/enable/', { code })); setTwofa(null); setCode(''); ui.success(t('Two-step sign-in is on.')); } catch (e) { ui.error(errorText(e)); } };
  const disableTwofa = async () => {
    const password = window.prompt(t('Type your password to turn it off'));
    if (!password) return;
    try { setUser(await post('auth/2fa/disable/', { password })); ui.success(t('Two-step sign-in is off.')); } catch (e) { ui.error(errorText(e)); }
  };

  return (
    <div className="grid-2">
      <Panel title={t('My profile')}>
        <form className="stack" onSubmit={saveProfile}>
          <PhotoPicker value={user.profileImage} onPick={setPhoto} round size={84} />
          <Field label={t('Full name')}><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} maxLength={60} /></Field>
          <div className="form-grid">
            <Field label={t('Email')}><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={t('Phone')}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Field label={t('Job')}><input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} maxLength={40} /></Field>
          <div><button className="btn btn-primary" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button></div>
          <p className="muted small" style={{ margin: 0 }}>{t('Username')}: <b>{user.username}</b> · {user.role === 'owner' ? t('Owner') : t('Employee')}</p>
        </form>
      </Panel>
      <div className="stack">
        <Panel title={t('Password')}>
          <form className="stack" onSubmit={savePassword}>
            <Field label={t('Current password')}><input type="password" autoComplete="current-password" value={pw.old_password} onChange={(e) => setPw({ ...pw, old_password: e.target.value })} /></Field>
            <div className="form-grid">
              <Field label={t('New password')} hint={t('At least 8 characters, not only numbers')}><input type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
              <Field label={t('Repeat new password')}><input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
            </div>
            <div><button className="btn btn-primary" disabled={pwBusy || !pw.new_password}>{t('Change password')}</button></div>
          </form>
        </Panel>
        <Panel title={t('Two-step sign-in')} action={user.totpEnabled ? <Badge kind="paid">{t('On')}</Badge> : <Badge kind="draft">{t('Off')}</Badge>}>
          <p className="muted" style={{ marginTop: 0 }}>{t('After your password, the app asks for a 6-digit code from your phone (Google Authenticator, Microsoft Authenticator…). Someone who steals your password still cannot get in.')}</p>
          {user.totpEnabled ? <button className="btn" onClick={disableTwofa}>{t('Turn off')}</button> : twofa ? (
            <div className="stack">
              <div className="row" style={{ alignItems: 'flex-start' }}><img src={twofa.qr} alt="" width={160} height={160} /><div className="small muted grow">{t('1. Scan this code with the authenticator app.')}<br />{t('2. Type the 6-digit code it shows.')}<br /><code style={{ wordBreak: 'break-all' }}>{twofa.secret}</code></div></div>
              <div className="row"><input className="otp-input" style={{ maxWidth: 220 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" /><button className="btn btn-primary" onClick={enableTwofa} disabled={code.length < 6}>{t('Turn on')}</button></div>
            </div>
          ) : <button className="btn btn-primary" onClick={startTwofa}><Icon name="shield" size={18} />{t('Set up')}</button>}
        </Panel>
        <Panel title={t('My recent sign-ins')} flush>
          {logins.data?.results?.length ? <div className="list">{logins.data.results.map((l) => (
            <div key={l.id} className="list-item"><Icon name={l.success ? 'check' : 'alert'} /><div className="grow"><div className="cell-main">{fmtDateTime(l.at)}</div><div className="cell-sub">{l.ip} · {(l.userAgent || '').slice(0, 60)}</div></div>{!l.success && <Badge kind="late">{t('Failed')}</Badge>}</div>
          ))}</div> : <Empty title={t('No sign-ins yet')} />}
        </Panel>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ shop identity
function ShopTab() {
  const ui = useUi();
  const { settings, setSettings } = useShop();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { logo, ...body } = form;
      const s = await patch('shop/', body);
      setSettings(s);
      ui.success(t('Saved.'));
    } catch (err) { ui.error(errorText(err)); }
    setBusy(false);
  };
  const logo = async (file) => { try { setSettings(await upload('shop/logo/', 'logo', file)); } catch (e) { ui.error(errorText(e)); } };
  return (
    <form onSubmit={save}>
      <div className="grid-2">
        <Panel title={t('Your shop')}>
          <div className="stack">
            <PhotoPicker value={settings.logo} onPick={logo} size={84} label={t('Logo')} />
            <Field label={t('Shop name')}><input value={form.shopName} onChange={(e) => set({ shopName: e.target.value })} maxLength={80} /></Field>
            <Field label={t('Address')}><input value={form.address} onChange={(e) => set({ address: e.target.value })} maxLength={200} /></Field>
            <div className="form-grid">
              <Field label={t('Phone')}><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <Field label={t('Email')}><input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            </div>
          </div>
        </Panel>
        <Panel title={t('On the invoice')}>
          <div className="stack">
            <div className="form-grid">
              <Field label="RC" hint={t('Trade register number')}><input value={form.rc} onChange={(e) => set({ rc: e.target.value })} /></Field>
              <Field label="NIF" hint={t('Tax ID')}><input value={form.nif} onChange={(e) => set({ nif: e.target.value })} /></Field>
              <Field label="NIS"><input value={form.nis} onChange={(e) => set({ nis: e.target.value })} /></Field>
              <Field label="AI" hint={t('Article of taxation')}><input value={form.ai} onChange={(e) => set({ ai: e.target.value })} /></Field>
              <Field label={t('Tax name')}><input value={form.taxLabel} onChange={(e) => set({ taxLabel: e.target.value })} maxLength={20} /></Field>
              <Field label={t('Tax rate %')} hint={t('0 = no tax line')}><NumberInput value={form.taxRate} onChange={(v) => set({ taxRate: v })} /></Field>
            </div>
            <Field label={t('Message at the bottom of the invoice')}><input value={form.invoiceFooter} onChange={(e) => set({ invoiceFooter: e.target.value })} maxLength={300} /></Field>
          </div>
        </Panel>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn btn-primary btn-big" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button></div>
    </form>
  );
}

// ------------------------------------------------------------------ units, currency, metals
const PRESETS = [
  { key: 'dz', label: 'Algérie · g · DA', values: { currencyCode: 'DZD', currencySymbol: 'DA', currencyDecimals: 2, weightUnit: 'g', weightDecimals: 2, priceQuantity: 1 } },
  { key: 'ma', label: 'Maroc · g · DH', values: { currencyCode: 'MAD', currencySymbol: 'DH', currencyDecimals: 2, weightUnit: 'g', weightDecimals: 2, priceQuantity: 1 } },
  { key: 'tn', label: 'Tunisie · g · DT', values: { currencyCode: 'TND', currencySymbol: 'DT', currencyDecimals: 3, weightUnit: 'g', weightDecimals: 2, priceQuantity: 1 } },
  { key: 'eu', label: 'Europe · g · €', values: { currencyCode: 'EUR', currencySymbol: '€', currencyDecimals: 2, weightUnit: 'g', weightDecimals: 2, priceQuantity: 1 } },
  { key: 'np', label: 'Tola / lal · Rs', values: { currencyCode: 'NPR', currencySymbol: 'Rs.', currencyDecimals: 2, weightUnit: 'lal', weightDecimals: 3, priceQuantity: 100 } },
];

function GradeModal({ grade, onClose, onSaved }) {
  const ui = useUi();
  const [form, setForm] = useState(grade || { name: '', metal: 'gold', purity: '', color: '#c9a227', isActive: true, sortOrder: 10 });
  const save = async () => {
    if (!form.name.trim()) return;
    try {
      const body = { ...form, purity: form.purity === '' ? null : Number(form.purity) };
      if (grade) await patch(`grades/${grade.gradeId}/`, body); else await post('grades/', body);
      onSaved();
    } catch (e) { ui.error(errorText(e)); }
  };
  return (
    <Modal small title={grade ? t('Change metal') : t('New metal')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save}>{t('Save')}</button></>}>
      <Field label={t('Name shown everywhere')} hint={t('e.g. Or 18K, Or 21K, Argent 925, Plaqué or')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} /></Field>
      <div className="form-grid">
        <Field label={t('Metal')}><select value={form.metal} onChange={(e) => setForm({ ...form, metal: e.target.value })}><option value="gold">{t('Gold')}</option><option value="silver">{t('Silver')}</option><option value="platinum">{t('Platinum')}</option><option value="other">{t('Other')}</option></select></Field>
        <Field label={t('Purity (‰)')} hint="750 = 18K"><NumberInput value={form.purity ?? ''} onChange={(v) => setForm({ ...form, purity: v })} /></Field>
        <Field label={t('Colour')}><input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ padding: 4 }} /></Field>
        <Field label={t('Order in lists')}><NumberInput value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} step={1} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />{t('In use')}</label>
    </Modal>
  );
}

function UnitsTab() {
  const ui = useUi();
  const { settings, setSettings, reloadRates } = useShop();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const gradesList = useFetch(() => get('grades/'), []);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const changedUnit = form.weightUnit !== settings.weightUnit || Number(form.priceQuantity) !== settings.priceQuantity;
  const save = async () => {
    if (changedUnit && !(await ui.confirm({ title: t('Change the weight unit?'), message: t('Weights already saved are not converted. Change it only when you start, before entering stock and sales.'), confirmLabel: t('Change') }))) return;
    setBusy(true);
    try {
      const keys = ['currencyCode', 'currencySymbol', 'currencyDecimals', 'weightUnit', 'weightDecimals', 'priceQuantity', 'defaultMakingMode', 'stockCodePrefix'];
      const s = await patch('shop/', Object.fromEntries(keys.map((k) => [k, form[k]])));
      setShopFormat(s);
      setSettings(s);
      ui.success(t('Saved.'));
    } catch (err) { ui.error(errorText(err)); }
    setBusy(false);
  };
  const removeGrade = async (g) => {
    if (!(await ui.confirm({ title: t('Remove {name}?', { name: g.name }), message: t('If it was already used, it is only hidden.'), confirmLabel: t('Remove'), danger: true }))) return;
    try { await del(`grades/${g.gradeId}/`); gradesList.reload(); reloadRates(); } catch (e) { ui.error(errorText(e)); }
  };
  return (
    <div className="grid-2">
      <Panel title={t('Money and weights')}>
        <div className="stack">
          <Field label={t('Quick setup')}><div className="chips">{PRESETS.map((p) => <button key={p.key} type="button" className="chip" onClick={() => set(p.values)}>{p.label}</button>)}</div></Field>
          <div className="form-grid">
            <Field label={t('Currency code')}><input value={form.currencyCode} onChange={(e) => set({ currencyCode: e.target.value.toUpperCase() })} maxLength={8} /></Field>
            <Field label={t('Currency symbol')} hint={t('Shown after amounts')}><input value={form.currencySymbol} onChange={(e) => set({ currencySymbol: e.target.value })} maxLength={8} /></Field>
            <Field label={t('Decimals for money')}><NumberInput value={form.currencyDecimals} onChange={(v) => set({ currencyDecimals: v })} step={1} /></Field>
            <Field label={t('Weight unit')}><select value={form.weightUnit} onChange={(e) => set({ weightUnit: e.target.value })}>{['g', 'kg', 'lal', 'tola', 'ct', 'oz'].map((u) => <option key={u} value={u}>{u}</option>)}</select></Field>
            <Field label={t('Decimals for weights')}><NumberInput value={form.weightDecimals} onChange={(v) => set({ weightDecimals: v })} step={1} /></Field>
            <Field label={t('The daily price is for')} hint={t('1 = price per {u}', { u: form.weightUnit })}><div className="input-addon"><NumberInput value={form.priceQuantity} onChange={(v) => set({ priceQuantity: v })} /><span>{form.weightUnit}</span></div></Field>
            <Field label={t('Usual making charge')}><MakingSelect value={form.defaultMakingMode} onChange={(v) => set({ defaultMakingMode: v })} /></Field>
            <Field label={t('Stock code starts with')}><input value={form.stockCodePrefix} onChange={(e) => set({ stockCodePrefix: e.target.value.toUpperCase() })} maxLength={6} /></Field>
          </div>
          <div className="balance ok"><span>{t('Example')}</span><b>{money(12600)} · {weight(4.25)}</b></div>
          <div><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button></div>
        </div>
      </Panel>
      <Panel title={t('Metals and karats you sell')} flush action={<button className="btn btn-small btn-primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('Add')}</button>}>
        {gradesList.loading && !gradesList.data ? <Loading /> : (
          <div className="list">{(gradesList.data || []).map((g) => (
            <div key={g.gradeId} className="list-item" style={{ opacity: g.isActive ? 1 : 0.5 }}>
              <i className="dot" style={{ background: g.color, width: 18, height: 18 }} />
              <div className="grow"><div className="cell-main">{g.name}</div><div className="cell-sub">{t({ gold: 'Gold', silver: 'Silver', platinum: 'Platinum', other: 'Other' }[g.metal])}{g.purity ? ` · ${g.purity}‰` : ''}{g.isActive ? '' : ` · ${t('hidden')}`}</div></div>
              <button className="icon-btn" onClick={() => setEditing(g)} aria-label={t('Change')}><Icon name="edit" size={16} /></button>
              <button className="icon-btn" onClick={() => removeGrade(g)} aria-label={t('Remove')}><Icon name="trash" size={16} /></button>
            </div>
          ))}</div>
        )}
      </Panel>
      {editing && <GradeModal grade={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); gradesList.reload(); reloadRates(); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ workers (accounts)
function WorkerModal({ worker, onClose, onSaved }) {
  const ui = useUi();
  const [form, setForm] = useState({ full_name: '', username: '', email: '', phone: '', jobTitle: '', role: 'employee', is_active: true, password: '', ...(worker || {}), ...(worker ? { password: '' } : {}) });
  const [photo, setPhoto] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { full_name: form.full_name, username: form.username.trim(), email: form.email, phone: form.phone, jobTitle: form.jobTitle, role: form.role, is_active: form.is_active };
      if (form.password) body.password = form.password;
      const saved = worker ? await patch(`users/${worker.id}/`, body) : await post('users/', body);
      if (photo !== undefined) {
        const fd = new FormData();
        if (photo) fd.append('profileImage', photo); else fd.append('remove', '1');
        await api.patch(`users/${saved.id}/`, fd);
      }
      ui.success(t('Saved.'));
      onSaved();
    } catch (e) { ui.error(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title={worker ? t('Change worker account') : t('New worker account')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={busy || !form.username.trim()}>{busy ? t('Saving…') : t('Save')}</button></>}>
      <PhotoPicker value={worker?.profileImage} onPick={setPhoto} round size={88} />
      <div className="form-grid">
        <Field label={t('Full name')}><input value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} maxLength={60} /></Field>
        <Field label={t('Job')}><input value={form.jobTitle} onChange={(e) => set({ jobTitle: e.target.value })} maxLength={40} placeholder={t('Seller, cashier…')} /></Field>
        <Field label={t('Username')} hint={t('Used to sign in')}><input value={form.username} onChange={(e) => set({ username: e.target.value })} autoCapitalize="none" maxLength={150} /></Field>
        <Field label={worker ? t('New password') : t('Password')} hint={worker ? t('Leave empty to keep it') : t('At least 8 characters, not only numbers')}><input type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label={t('Phone')}><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label={t('Email')}><input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label={t('Access')}><select value={form.role} onChange={(e) => set({ role: e.target.value })}><option value="employee">{t('Employee: daily work')}</option><option value="owner">{t('Owner: everything')}</option></select></Field>
        <Field label={t('Status')}><label className="check" style={{ minHeight: 46 }}><input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />{t('Can sign in')}</label></Field>
      </div>
    </Modal>
  );
}

function WorkersTab() {
  const ui = useUi();
  const { user } = useAuth();
  const { settings, setSettings } = useShop();
  const { data, loading, reload } = useFetch(() => get('users/'), []);
  const [editing, setEditing] = useState(null);
  const toggle = async (key) => { try { setSettings(await patch('shop/', { [key]: !settings[key] })); } catch (e) { ui.error(errorText(e)); } };
  const signout = async (w) => { try { await post(`users/${w.id}/signout/`); ui.success(t('{name} is signed out on every device.', { name: w.name })); } catch (e) { ui.error(errorText(e)); } };
  const RIGHTS = [
    ['employeesCanSetRates', t("Employees can set today's prices")],
    ['employeesCanDiscount', t('Employees can give discounts')],
    ['employeesSeeSales', t('Employees see sales totals and charts')],
    ['employeesSeeCost', t('Employees see cost prices')],
  ];
  return (
    <div className="cols-main">
      <Panel title={t('Worker accounts')} flush action={<button className="btn btn-small btn-primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('New account')}</button>}>
        {loading && !data ? <Loading /> : (
          <div className="list">{data.map((w) => (
            <div key={w.id} className="list-item" style={{ opacity: w.is_active ? 1 : 0.5 }}>
              <Avatar src={w.profileImage} name={w.name} size={46} />
              <div className="grow">
                <div className="cell-main">{w.name} {w.id === user.id && <span className="muted small">({t('you')})</span>}</div>
                <div className="cell-sub">@{w.username}{w.jobTitle ? ` · ${w.jobTitle}` : ''} · {w.last_login ? t('last seen {date}', { date: fmtDateTime(w.last_login) }) : t('never signed in')}</div>
              </div>
              <span className="row" style={{ gap: 4 }}>
                <Badge kind={w.role} />{!w.is_active && <Badge kind="late">{t('Blocked')}</Badge>}{w.totpEnabled && <Icon name="shield" size={18} />}
                <button className="icon-btn" title={t('Sign out everywhere')} onClick={() => signout(w)}><Icon name="logout" size={16} /></button>
                <button className="icon-btn" onClick={() => setEditing(w)} aria-label={t('Change')}><Icon name="edit" size={16} /></button>
              </span>
            </div>
          ))}</div>
        )}
      </Panel>
      <Panel title={t('What employees may do')}>
        <div className="stack" style={{ gap: 12 }}>
          {RIGHTS.map(([k, label]) => <label key={k} className="check"><input type="checkbox" checked={Boolean(settings[k])} onChange={() => toggle(k)} />{label}</label>)}
          <p className="muted small" style={{ margin: 0 }}>{t('Employees can always sell, take orders, add stock, record payments and work with craftsmen. Only owners delete, change saved sales, manage suppliers, accounts and settings.')}</p>
        </div>
      </Panel>
      {editing && <WorkerModal worker={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ activity & backup
const ACTIONS = {
  'bill.create': 'made a sale', 'bill.update': 'changed a sale', 'bill.delete': 'deleted a sale', 'bill.payment': 'recorded a payment',
  'order.create': 'took an order', 'order.update': 'changed an order', 'order.delete': 'deleted an order', 'order.status': 'changed an order status',
  'stock.create': 'added to stock', 'stock.update': 'changed a piece', 'stock.delete': 'deleted a piece', 'rates.set': 'set the prices',
  'work.give': 'gave work', 'work.receive': 'received work', 'work.delete': 'cancelled work', 'customer.create': 'added a customer',
  'supplier.payment': 'paid a supplier', 'purchase.create': 'recorded a purchase', 'user.create': 'created an account', 'user.update': 'changed an account',
  'backup.download': 'downloaded a backup', 'shop.update': 'changed the settings',
};

function ActivityTab() {
  const [page, setPage] = useState(1);
  const { data, loading } = useFetch(() => get('activity/', { page }), [page]);
  const logins = useFetch(() => get('auth/logins/', { all: 1, page_size: 15 }), []);
  return (
    <div className="cols-main">
      <Panel title={t('Who did what')} flush>
        {loading && !data ? <Loading /> : data?.results.length === 0 ? <Empty title={t('Nothing yet')} /> : (
          <div className="list">{data.results.map((a) => (
            <div key={a.id} className="list-item"><Avatar name={a.user?.name || '?'} size={34} /><div className="grow"><div><b>{a.user?.name || '—'}</b> {t(ACTIONS[a.action] || a.action)}</div><div className="cell-sub">{a.label}</div></div><span className="cell-sub nowrap">{fmtDateTime(a.at)}</span></div>
          ))}</div>
        )}
        {data?.totalPages > 1 && <div className="pager"><button className="btn btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('Previous')}</button><button className="btn btn-small" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>{t('Next')}</button></div>}
      </Panel>
      <Panel title={t('Sign-ins')} flush>
        <div className="list">{(logins.data?.results || []).map((l) => (
          <div key={l.id} className="list-item"><Icon name={l.success ? 'check' : 'alert'} /><div className="grow"><div className="cell-main">{l.user?.name || l.username}</div><div className="cell-sub">{fmtDateTime(l.at)} · {l.ip}</div></div>{!l.success && <Badge kind="late">{t({ bad_password: 'Wrong password', locked: 'Locked', bad_code: 'Wrong code', inactive: 'Blocked' }[l.reason] || 'Failed')}</Badge>}</div>
        ))}</div>
      </Panel>
    </div>
  );
}

function BackupTab() {
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const res = await api.get('backup/', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { ui.error(errorText(e)); }
    setBusy(false);
  };
  return (
    <Panel title={t('Backup')}>
      <p style={{ marginTop: 0 }}>{t('Download a copy of all your data (stock, sales, customers, suppliers…). Keep it on a USB key or in your email. Do it at least once a week.')}</p>
      <button className="btn btn-primary btn-big" onClick={download} disabled={busy}><Icon name="download" />{busy ? t('Preparing…') : t('Download a backup')}</button>
      <p className="muted small">{t('Photos are not inside this file. When you use Supabase, photos and data are also kept online.')}</p>
    </Panel>
  );
}

export default function Settings() {
  const { isOwner } = useAuth();
  const { settings } = useShop();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (isOwner ? 'shop' : 'account');
  const TABS = isOwner
    ? [['shop', t('Shop'), 'home'], ['units', t('Units & metals'), 'scale'], ['workers', t('Workers'), 'users'], ['account', t('My account'), 'user'], ['activity', t('Activity'), 'clock'], ['backup', t('Backup'), 'download']]
    : [['account', t('My account'), 'user']];
  useEffect(() => { if (!TABS.some(([k]) => k === tab)) setParams({ tab: TABS[0][0] }, { replace: true }); });
  if (!settings) return <Loading />;
  return (
    <>
      <PageHeader title={t('Settings')} />
      <div className="tabs">{TABS.map(([k, label, icon]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setParams({ tab: k }, { replace: true })}><Icon name={icon} size={18} />{label}</button>)}</div>
      {tab === 'account' && <Account />}
      {tab === 'shop' && isOwner && <ShopTab />}
      {tab === 'units' && isOwner && <UnitsTab />}
      {tab === 'workers' && isOwner && <WorkersTab />}
      {tab === 'activity' && isOwner && <ActivityTab />}
      {tab === 'backup' && isOwner && <BackupTab />}
    </>
  );
}
