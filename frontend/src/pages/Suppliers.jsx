import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, errorText, get, patch, post, upload } from '../api';
import { GradeSelect } from '../components/pickers.jsx';
import { fmtDate, isoDate, money, num, priceBasis, shop, unit, weight } from '../format';
import { t, tn } from '../i18n';
import { METHODS, methodLabel, useShop } from '../shop.jsx';
import { Avatar, Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, NumberInput, PageHeader, Panel, PhotoPicker, SearchBox, useDebounced, useFetch, useUi } from '../ui.jsx';

function SupplierModal({ supplier, onClose, onSaved }) {
  const ui = useUi();
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', address: '', nif: '', rc: '', note: '', isActive: true, ...(supplier || {}) });
  const [photo, setPhoto] = useState(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    if (!form.name.trim()) { setError(t('Enter the name.')); return; }
    setBusy(true);
    const body = { name: form.name, company: form.company, phone: form.phone, email: form.email, address: form.address, nif: form.nif, rc: form.rc, note: form.note, isActive: form.isActive };
    try {
      let saved = supplier ? await patch(`suppliers/${supplier.supplierId}/`, body) : await post('suppliers/', body);
      if (photo !== undefined) saved = await upload(`suppliers/${saved.supplierId}/photo/`, 'photo', photo);
      ui.success(t('Supplier saved.'));
      onSaved(saved);
    } catch (e) { ui.error(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title={supplier ? t('Change supplier') : t('New supplier')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button></>}>
      <PhotoPicker value={supplier?.photo} onPick={setPhoto} size={88} label={t('Photo or logo')} />
      <div className="form-grid">
        <Field label={t('Name')} error={error}><input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} /></Field>
        <Field label={t('Company')}><input value={form.company} onChange={(e) => set({ company: e.target.value })} maxLength={80} /></Field>
        <Field label={t('Phone')}><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" maxLength={20} /></Field>
        <Field label={t('Email')}><input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label={t('Address')} className="span-2"><input value={form.address} onChange={(e) => set({ address: e.target.value })} maxLength={160} /></Field>
        <Field label="NIF"><input value={form.nif} onChange={(e) => set({ nif: e.target.value })} maxLength={40} /></Field>
        <Field label="RC"><input value={form.rc} onChange={(e) => set({ rc: e.target.value })} maxLength={40} /></Field>
        <Field label={t('Note')} className="span-2"><input value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function PurchaseModal({ supplier, onClose, onSaved }) {
  const ui = useUi();
  const { grades, gradeById } = useShop();
  const [form, setForm] = useState({ date: isoDate(), reference: '', grade: grades[0]?.gradeId, note: '', paidNow: '', payMethod: 'cash' });
  const [lines, setLines] = useState([{ k: 1, name: '', quantity: 1, weight: '', unitPrice: '', makingCharge: '', addToStock: true }]);
  const [busy, setBusy] = useState(false);
  const pq = num(shop.priceQuantity) || 1;
  const amount = (l) => (num(l.weight) * num(l.unitPrice)) / pq + num(l.makingCharge);
  const total = lines.reduce((s, l) => s + amount(l), 0);
  const setL = (k, p) => setLines((all) => all.map((l) => (l.k === k ? { ...l, ...p } : l)));
  const save = async () => {
    if (lines.some((l) => !l.name.trim() || !(num(l.weight) > 0))) { ui.error(t('Every line needs a name and a weight.')); return; }
    setBusy(true);
    try {
      await post('purchases/', { supplier: supplier.supplierId, date: form.date, reference: form.reference, grade: form.grade, note: form.note, paidNow: num(form.paidNow) || null, payMethod: form.payMethod,
        lines: lines.map((l) => ({ name: l.name, quantity: num(l.quantity) || 1, weight: num(l.weight), unitPrice: num(l.unitPrice), makingCharge: num(l.makingCharge), addToStock: l.addToStock })) });
      ui.success(t('Purchase saved.'));
      onSaved();
    } catch (e) { ui.error(errorText(e)); setBusy(false); }
  };
  return (
    <Modal wide title={t('New purchase from {name}', { name: supplier.name })} onClose={onClose}
      footer={<><span className="grow cell-main">{t('Total')}: {money(total)}</span><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save purchase')}</button></>}>
      <div className="form-grid">
        <Field label={t('Date')}><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label={t('Supplier invoice no.')}><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} maxLength={40} /></Field>
        <Field label={t('Metal')}><GradeSelect value={form.grade} onChange={(g) => { setForm({ ...form, grade: g }); setLines((all) => all.map((l) => (l.unitPrice === '' ? { ...l, unitPrice: gradeById(g)?.rate?.buyPrice ?? '' } : l))); }} /></Field>
        <Field label={t('Note')}><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} /></Field>
      </div>
      <div className="items">
        {lines.map((l, i) => (
          <div key={l.k} className="tline">
            <div className="tline-grid" style={{ gridTemplateColumns: '2fr 0.7fr 1fr 1fr 1fr' }}>
              <Field label={i === 0 ? t('What') : undefined}><input value={l.name} onChange={(e) => setL(l.k, { name: e.target.value })} placeholder={t('Rings, chains, raw gold…')} /></Field>
              <Field label={i === 0 ? t('Pieces') : undefined}><NumberInput value={l.quantity} onChange={(v) => setL(l.k, { quantity: v })} min={1} /></Field>
              <Field label={i === 0 ? t('Total weight ({u})', { u: unit() }) : undefined}><NumberInput value={l.weight} onChange={(v) => setL(l.k, { weight: v })} /></Field>
              <Field label={i === 0 ? t('Price {basis}', { basis: priceBasis() }) : undefined}><NumberInput value={l.unitPrice} onChange={(v) => setL(l.k, { unitPrice: v })} /></Field>
              <Field label={i === 0 ? t('Making (total)') : undefined}><NumberInput value={l.makingCharge} onChange={(v) => setL(l.k, { makingCharge: v })} /></Field>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="check small"><input type="checkbox" checked={l.addToStock} onChange={(e) => setL(l.k, { addToStock: e.target.checked })} />{t('Add these pieces to stock')}</label>
              <span className="row"><b className="num">{money(amount(l))}</b>{lines.length > 1 && <button className="icon-btn" onClick={() => setLines((all) => all.filter((x) => x.k !== l.k))}><Icon name="x" size={16} /></button>}</span>
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-small" onClick={() => setLines((all) => [...all, { k: Date.now(), name: '', quantity: 1, weight: '', unitPrice: all[0]?.unitPrice ?? '', makingCharge: '', addToStock: true }])}><Icon name="plus" size={16} />{t('Another line')}</button>
      </div>
      <div className="form-grid">
        <Field label={t('Paid now')}><NumberInput value={form.paidNow} onChange={(v) => setForm({ ...form, paidNow: v })} /></Field>
        <Field label={t('Paid by')}><select value={form.payMethod} onChange={(e) => setForm({ ...form, payMethod: e.target.value })}>{METHODS().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('Pieces added to stock get a code; open them later in Stock to add a photo.')}</p>
    </Modal>
  );
}

function PayModal({ supplier, onClose, onSaved }) {
  const ui = useUi();
  const { grades, gradeById } = useShop();
  const [form, setForm] = useState({ method: 'cash', amount: supplier.balance > 0 ? supplier.balance : '', metalWeight: '', metalGrade: grades[0]?.gradeId, metalRate: '', date: isoDate(), note: '' });
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const rate = form.metalRate !== '' ? num(form.metalRate) : gradeById(form.metalGrade)?.rate?.sellPrice || 0;
  const metalValue = (num(form.metalWeight) * rate) / (num(shop.priceQuantity) || 1);
  const save = async () => {
    setBusy(true);
    try {
      await post('supplier-payments/', { supplier: supplier.supplierId, date: form.date, method: form.method, note: form.note,
        ...(form.method === 'metal' ? { metalWeight: num(form.metalWeight), metalGrade: form.metalGrade, metalRate: rate || null } : { amount: num(form.amount) }) });
      ui.success(t('Payment saved.'));
      onSaved();
    } catch (e) { ui.error(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title={t('Pay {name}', { name: supplier.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save payment')}</button></>}>
      <p className="muted" style={{ margin: 0 }}>{t('You owe: {amount}', { amount: money(supplier.balance) })}</p>
      <Field label={t('Paid by')}>
        <select value={form.method} onChange={(e) => set({ method: e.target.value })}>
          {METHODS().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          <option value="metal">{t('Gold / metal (weight)')}</option>
        </select>
      </Field>
      {form.method === 'metal' ? (
        <div className="form-grid">
          <Field label={t('Metal')}><GradeSelect value={form.metalGrade} onChange={(g) => set({ metalGrade: g, metalRate: '' })} /></Field>
          <Field label={t('Weight given ({u})', { u: unit() })}><NumberInput value={form.metalWeight} onChange={(v) => set({ metalWeight: v })} /></Field>
          <Field label={t('Price {basis}', { basis: priceBasis() })}><NumberInput value={form.metalRate !== '' ? form.metalRate : rate || ''} onChange={(v) => set({ metalRate: v })} /></Field>
          <Field label={t('Value')}><div className="balance ok" style={{ margin: 0 }}><b className="num">{money(metalValue)}</b></div></Field>
        </div>
      ) : <Field label={t('Amount')}><NumberInput value={form.amount} onChange={(v) => set({ amount: v })} /></Field>}
      <div className="form-grid">
        <Field label={t('Date')}><input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label={t('Note')}><input value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}

export default function Suppliers() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useFetch(() => get('suppliers/', { q }), [q]);
  const owed = (data || []).reduce((s, x) => s + Math.max(x.balance || 0, 0), 0);
  return (
    <>
      <PageHeader title={t('Suppliers')} subtitle={data ? t('You owe {amount} in total', { amount: money(owed) }) : ''} actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('New supplier')}</button>} />
      <div className="toolbar"><SearchBox value={text} onChange={setText} placeholder={t('Name, company or phone')} /></div>
      {error && <ErrorBox message={errorText(error)} onRetry={reload} />}
      {loading && !data ? <Loading /> : data?.length === 0 ? <Panel><Empty icon="truck" title={t('No suppliers yet')}>{t('Add the workshops and wholesalers you buy from, then record purchases and payments.')}</Empty></Panel> : (
        <div className="grid-3">
          {data?.map((s) => (
            <button key={s.supplierId} type="button" className="panel" style={{ textAlign: 'start', cursor: 'pointer', font: 'inherit', padding: 18, opacity: s.isActive ? 1 : 0.55 }} onClick={() => navigate(`/suppliers/${s.supplierId}`)}>
              <div className="cell-flex"><Avatar src={s.photo} name={s.name} size={54} square /><div className="grow"><div className="cell-main">{s.name}</div><div className="cell-sub">{s.company || s.phone || s.address || '—'}</div></div></div>
              <div className="sum-row" style={{ marginTop: 10 }}><span className="muted">{t('You owe')}</span><b className={`num ${s.balance > 0 ? 'late' : ''}`}>{money(s.balance)}</b></div>
            </button>
          ))}
        </div>
      )}
      {adding && <SupplierModal onClose={() => setAdding(false)} onSaved={(s) => navigate(`/suppliers/${s.supplierId}`)} />}
    </>
  );
}

export function SupplierDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ui = useUi();
  const { data: s, loading, error, reload } = useFetch(() => get(`suppliers/${id}/`), [id]);
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('purchases');
  if (loading && !s) return <Loading />;
  if (error && !s) return <ErrorBox message={errorText(error)} onRetry={reload} />;
  const done = () => { setModal(null); reload(); };
  const remove = async () => {
    if (!(await ui.confirm({ title: t('Remove {name}?', { name: s.name }), message: t('A supplier with purchases is only hidden, never erased.'), confirmLabel: t('Remove'), danger: true }))) return;
    try { await del(`suppliers/${s.supplierId}/`); navigate('/suppliers'); } catch (e) { ui.error(errorText(e)); }
  };
  const delPurchase = async (p) => {
    if (!(await ui.confirm({ title: t('Delete this purchase?'), message: money(p.totalAmount), confirmLabel: t('Delete'), danger: true }))) return;
    try { await del(`purchases/${p.purchaseId}/`); reload(); } catch (e) { ui.error(errorText(e)); }
  };
  const delPayment = async (p) => {
    if (!(await ui.confirm({ title: t('Delete this payment?'), message: money(p.amount), confirmLabel: t('Delete'), danger: true }))) return;
    try { await del(`supplier-payments/${p.paymentId}/`); reload(); } catch (e) { ui.error(errorText(e)); }
  };
  return (
    <>
      <PageHeader back={<Link className="back" to="/suppliers"><Icon name="chevron" size={14} />{t('Suppliers')}</Link>}
        title={<span className="cell-flex"><Avatar src={s.photo} name={s.name} size={52} square />{s.name}</span>}
        subtitle={[s.company, s.phone, s.address, s.nif && `NIF ${s.nif}`, s.rc && `RC ${s.rc}`].filter(Boolean).join(' · ')}
        actions={<>
          <button className="btn btn-primary" onClick={() => setModal('purchase')}><Icon name="plus" size={18} />{t('New purchase')}</button>
          <button className="btn btn-gold" onClick={() => setModal('pay')}><Icon name="coins" size={18} />{t('Pay')}</button>
          <button className="btn" onClick={() => setModal('edit')}><Icon name="edit" size={18} /></button>
          <button className="btn" onClick={remove}><Icon name="trash" size={18} /></button>
        </>} />
      <div className="stats">
        <div className={`stat ${s.balance > 0 ? 'alert' : ''}`}><div className="stat-label">{t('You owe')}</div><div className="stat-value" style={{ fontSize: '1.35rem' }}>{money(s.balance)}</div></div>
        <div className="stat"><div className="stat-label">{t('Bought in total')}</div><div className="stat-value" style={{ fontSize: '1.35rem' }}>{money(s.totalBought)}</div></div>
        <div className="stat"><div className="stat-label">{t('Weight bought')}</div><div className="stat-value" style={{ fontSize: '1.35rem' }}>{weight(s.totalWeight)}</div></div>
        <div className="stat"><div className="stat-label">{t('Their pieces in stock')}</div><div className="stat-value">{s.stockCount}</div></div>
      </div>
      <div className="tabs">
        <button className={tab === 'purchases' ? 'on' : ''} onClick={() => setTab('purchases')}>{t('Purchases')} ({s.purchases.length})</button>
        <button className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>{t('Payments')} ({s.payments.length})</button>
      </div>
      <Panel flush>
        {tab === 'purchases' ? (s.purchases.length === 0 ? <Empty icon="truck" title={t('No purchases yet')} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('Date')}</th><th>{t('Invoice')}</th><th className="right">{t('Weight')}</th><th className="right">{t('Total')}</th><th className="right">{t('Still owed')}</th><th /></tr></thead>
            <tbody>{s.purchases.map((p) => (
              <tr key={p.purchaseId}>
                <td>{fmtDate(p.date)}<div className="cell-sub">{tn(p.lineCount, 'line', 'lines')}{p.createdBy ? ` · ${p.createdBy.name}` : ''}</div></td>
                <td>{p.reference || '—'}{p.note && <div className="cell-sub">{p.note}</div>}</td>
                <td className="right num">{weight(p.totalWeight)}</td>
                <td className="right num">{money(p.totalAmount)}</td>
                <td className="right num">{p.remaining > 0.005 ? money(p.remaining) : <Badge kind="paid" />}</td>
                <td className="right"><button className="icon-btn" onClick={() => delPurchase(p)} aria-label={t('Delete')}><Icon name="trash" size={16} /></button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )) : (s.payments.length === 0 ? <Empty icon="coins" title={t('No payments yet')} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('Date')}</th><th>{t('Paid by')}</th><th className="right">{t('Amount')}</th><th /></tr></thead>
            <tbody>{s.payments.map((p) => (
              <tr key={p.paymentId}>
                <td>{fmtDate(p.date)}{p.by && <div className="cell-sub">{p.by.name}</div>}</td>
                <td>{methodLabel(p.method)}{p.metalWeight ? ` · ${weight(p.metalWeight)}` : ''}{p.note && <div className="cell-sub">{p.note}</div>}</td>
                <td className="right num">{money(p.amount)}</td>
                <td className="right"><button className="icon-btn" onClick={() => delPayment(p)} aria-label={t('Delete')}><Icon name="trash" size={16} /></button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
      </Panel>
      {modal === 'edit' && <SupplierModal supplier={s} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'purchase' && <PurchaseModal supplier={s} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'pay' && <PayModal supplier={s} onClose={() => setModal(null)} onSaved={done} />}
    </>
  );
}
