import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, errorText, get, patch, post } from '../api';
import { useAuth } from '../auth.jsx';
import { useListParams } from '../components/useListParams';
import { dueLabel, fmtDate, money, whatsapp } from '../format';
import { t, tn } from '../i18n';
import { Avatar, Badge, Chips, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Pager, Panel, SearchBox, useDebounced, useFetch, useUi } from '../ui.jsx';

export function CustomerModal({ customer, onClose, onSaved }) {
  const ui = useUi();
  const [form, setForm] = useState({ name: customer?.name || '', phone: customer?.phone || '', address: customer?.address || '', email: customer?.email || '', note: customer?.note || '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    if (!form.name.trim()) { setErrors({ name: t('Enter the customer name.') }); return; }
    setBusy(true);
    try {
      const saved = customer ? await patch(`customers/${customer.customerId}/`, form) : await post('customers/', form);
      ui.success(t('Customer saved.'));
      onSaved(saved);
    } catch (e) {
      const d = e.response?.data;
      if (d && typeof d === 'object' && (d.phone || d.email || d.name)) setErrors({ name: d.name?.[0], phone: d.phone?.[0], email: d.email?.[0] });
      else ui.error(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={customer ? t('Change customer') : t('New customer')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button></>}>
      <Field label={t('Name')} error={errors.name}><input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} /></Field>
      <Field label={t('Phone')} error={errors.phone}><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" maxLength={20} /></Field>
      <Field label={t('Address')}><input value={form.address} onChange={(e) => set({ address: e.target.value })} maxLength={120} /></Field>
      <Field label={t('Email')} error={errors.email}><input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
      <Field label={t('Note')} hint={t('Ring size, preferences…')}><input value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} /></Field>
    </Modal>
  );
}

export default function Customers() {
  const navigate = useNavigate();
  const defaults = useMemo(() => ({ q: '', owing: '', page: '1' }), []);
  const [f, setF] = useListParams(defaults);
  const [text, setText] = useState(f.q);
  const q = useDebounced(text);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useFetch(() => get('customers/', { q, page: f.page, owing: f.owing }), [q, f.page, f.owing]);
  return (
    <>
      <PageHeader title={t('Customers')} subtitle={data ? tn(data.count, 'customer', 'customers') : ''} actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('New customer')}</button>} />
      <div className="toolbar">
        <SearchBox value={text} onChange={(v) => { setText(v); setF({ q: v }); }} placeholder={t('Name, phone or address')} />
        <Chips value={f.owing || 'all'} onChange={(v) => setF({ owing: v === 'all' ? '' : '1' })} options={[{ value: 'all', label: t('All') }, { value: '1', label: t('They owe you') }]} />
      </div>
      {error && <ErrorBox message={errorText(error)} onRetry={reload} />}
      <Panel flush>
        {loading && !data ? <Loading /> : data?.results.length === 0 ? <Empty icon="users" title={t('No customers found')}>{t('Customers are added automatically when you sell or take an order.')}</Empty> : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="table">
              <thead><tr><th>{t('Name')}</th><th>{t('Phone')}</th><th className="hide-sm">{t('Address')}</th><th className="right hide-sm">{t('Sales')}</th><th className="right">{t('Owes you')}</th></tr></thead>
              <tbody>
                {data?.results.map((c) => (
                  <tr key={c.customerId} className="click" onClick={() => navigate(`/customers/${c.customerId}`)}>
                    <td><div className="cell-flex"><Avatar name={c.name} size={34} /><span className="cell-main">{c.name}</span></div></td>
                    <td>{c.phone || '—'}</td>
                    <td className="hide-sm">{c.address || '—'}</td>
                    <td className="right num hide-sm">{c.billCount}</td>
                    <td className="right num">{c.dueAmount > 0 ? <b className="late">{money(c.dueAmount)}</b> : <span className="cell-sub">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={data?.page} totalPages={data?.totalPages} onPage={(p) => setF({ page: String(p) })} />
      </Panel>
      {adding && <CustomerModal onClose={() => setAdding(false)} onSaved={(c) => navigate(`/customers/${c.customerId}`)} />}
    </>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ui = useUi();
  const { isOwner } = useAuth();
  const { data: c, loading, error, reload } = useFetch(() => get(`customers/${id}/`), [id]);
  const [editing, setEditing] = useState(false);
  if (loading && !c) return <Loading />;
  if (error && !c) return <ErrorBox message={errorText(error)} onRetry={reload} />;
  const remove = async () => {
    if (!(await ui.confirm({ title: t('Delete {name}?', { name: c.name }), message: t('Only customers without orders or sales can be deleted.'), confirmLabel: t('Delete'), danger: true }))) return;
    try { await del(`customers/${c.customerId}/`); navigate('/customers'); } catch (e) { ui.error(errorText(e)); }
  };
  return (
    <>
      <PageHeader back={<Link className="back" to="/customers"><Icon name="chevron" size={14} />{t('Customers')}</Link>} title={c.name}
        subtitle={[c.phone, c.address, c.email].filter(Boolean).join(' · ') || t('No contact details')}
        actions={<>
          <Link className="btn btn-gold" to={`/sell?customer=${c.customerId}`}><Icon name="cart" size={18} />{t('Sell')}</Link>
          <Link className="btn" to={`/orders/new?customer=${c.customerId}`}><Icon name="orders" size={18} />{t('New order')}</Link>
          {c.phone && <a className="btn" href={whatsapp(c.phone, '')} target="_blank" rel="noreferrer"><Icon name="chat" size={18} />WhatsApp</a>}
          <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={18} />{t('Change')}</button>
          {isOwner && c.orders.length === 0 && c.bills.length === 0 && <button className="btn" onClick={remove}><Icon name="trash" size={18} /></button>}
        </>} />
      {c.note && <p className="muted">{c.note}</p>}
      {c.dueAmount > 0 && <div className="banner"><Icon name="coins" /><span className="grow">{t('{name} still owes you {amount}.', { name: c.name, amount: money(c.dueAmount) })}</span></div>}
      <div className="grid-2">
        <Panel title={t('Sales ({n})', { n: c.bills.length })} flush>
          {c.bills.length === 0 ? <Empty title={t('No sales yet')} /> : (
            <div className="list">{c.bills.map((b) => (
              <Link key={b.billId} to={`/bills/${b.billId}`} className="list-item">
                <div className="grow"><div className="cell-main">#{b.billId} · {fmtDate(b.date)}</div><div className="cell-sub num">{money(b.grandTotal)}</div></div>
                <div className="right">{b.status === 'draft' ? <Badge kind="draft" /> : <Badge kind={b.paymentStatus} />}{b.paymentStatus === 'due' && b.status === 'submitted' && <div className="cell-sub num">{money(b.remainingAmount)}</div>}</div>
              </Link>
            ))}</div>
          )}
        </Panel>
        <Panel title={t('Orders ({n})', { n: c.orders.length })} flush>
          {c.orders.length === 0 ? <Empty title={t('No orders yet')} /> : (
            <div className="list">{c.orders.map((o) => (
              <Link key={o.orderId} to={`/orders/${o.orderId}`} className="list-item">
                <div className="grow"><div className="cell-main">#{o.orderId} · {fmtDate(o.date)}</div><div className="cell-sub">{tn(o.itemCount, 'piece', 'pieces')}</div></div>
                <div className="right"><Badge kind={o.status} />{o.status !== 'submitted' && <div className={o.isOverdue ? 'late small' : 'cell-sub'}>{dueLabel(o.dueDate)}</div>}</div>
              </Link>
            ))}</div>
          )}
        </Panel>
      </div>
      {editing && <CustomerModal customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
