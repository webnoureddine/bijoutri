import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorText, get, post, put } from '../api';
import { CustomerPicker, EMPTY_CUSTOMER, Seg, asCustomer } from '../components/pickers.jsx';
import { addDays, isoDate, num, priceBasis, unit } from '../format';
import { t } from '../i18n';
import { useShop } from '../shop.jsx';
import { ErrorBox, Field, Icon, Loading, NumberInput, PageHeader, Panel, useUi } from '../ui.jsx';

let seq = 0;
const blank = () => ({ key: `n${++seq}`, name: '', netWeight: '', size: '', gemsName: '', quantity: 1 });

export default function OrderForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ui = useUi();
  const { grades, gradeById } = useShop();
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [order, setOrder] = useState({ grade: null, rate: '', advanceAmount: '', dueDate: addDays(isoDate(), 10), customerMetalWeight: '', remark: '' });
  const [items, setItems] = useState([blank()]);
  const [version, setVersion] = useState(undefined);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(editing || Boolean(params.get('customer')));
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rateTouched, setRateTouched] = useState(false);
  const setO = (p) => setOrder((o) => ({ ...o, ...p }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (editing) {
          const o = await get(`orders/${id}/`);
          if (!alive) return;
          if (o.status === 'submitted') { navigate(`/orders/${id}`, { replace: true }); return; }
          setCustomer(asCustomer(o.customer));
          setVersion(o.version);
          setOrder({ grade: o.grade, rate: o.rate ?? '', advanceAmount: o.advanceAmount ?? '', dueDate: o.dueDate || '', customerMetalWeight: o.customerMetalWeight ?? '', remark: o.remark || '' });
          setItems(o.items.map((i) => ({ key: `o${i.orderItemId}`, orderItemId: i.orderItemId, status: i.status, name: i.name, netWeight: i.netWeight ?? '', size: i.size || '', gemsName: i.gemsName || '', quantity: i.quantity ?? 1 })));
          setRateTouched(true);
        } else if (params.get('customer')) {
          const c = await get(`customers/${params.get('customer')}/`);
          if (alive) setCustomer(asCustomer(c));
        }
      } catch (e) {
        if (alive) setLoadError(e);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const grade = order.grade || grades[0]?.gradeId;
  useEffect(() => {
    if (!rateTouched && grade) setO({ rate: gradeById(grade)?.rate?.sellPrice ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, grades, rateTouched]);

  const setItem = (key, p) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const save = async (ev) => {
    ev.preventDefault();
    const e = {};
    if (!customer.customerId && !customer.name.trim()) e.customer = { name: t('Enter the customer name.') };
    if (!order.dueDate) e.dueDate = t('Pick the date you promised.');
    items.forEach((i) => { if (!i.name.trim()) e[i.key] = t('Name this piece.'); });
    setErrors(e);
    if (Object.keys(e).length) { ui.error(t('Some details are missing. Check the fields in red.')); return; }
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      customer, version,
      order: { grade, rate: n(order.rate), advanceAmount: n(order.advanceAmount), dueDate: order.dueDate, customerMetalWeight: n(order.customerMetalWeight), remark: order.remark },
      items: items.map((i) => ({ orderItemId: i.orderItemId, name: i.name.trim(), netWeight: n(i.netWeight), size: i.size, gemsName: i.gemsName, quantity: n(i.quantity) || 1 })),
    };
    setSaving(true);
    try {
      const saved = editing ? await put(`orders/${id}/`, body) : await post('orders/', body);
      ui.success(editing ? t('Order saved.') : t('Order #{id} taken.', { id: saved.orderId }));
      navigate(`/orders/${saved.orderId}`);
    } catch (err) {
      ui.error(errorText(err));
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (loadError) return <ErrorBox message={errorText(loadError)} />;

  return (
    <form onSubmit={save} noValidate>
      <PageHeader back={<Link className="back" to={editing ? `/orders/${id}` : '/orders'}><Icon name="chevron" size={14} />{editing ? t('Order #{id}', { id }) : t('Orders')}</Link>}
        title={editing ? t('Change order #{id}', { id }) : t('New order')} subtitle={t('Who it is for, what to make, and when')} />
      <div className="stack">
        <Panel title={t('1. Customer')}><CustomerPicker value={customer} onChange={setCustomer} errors={errors.customer || {}} /></Panel>
        <Panel title={t('2. Pieces to make')}>
          <div className="items">
            {items.map((item, idx) => {
              const locked = item.status && item.status !== 'pending';
              return (
                <div className="item-row" key={item.key}>
                  <Field label={idx === 0 ? t('Piece') : undefined} error={errors[item.key]}><input value={item.name} onChange={(e) => setItem(item.key, { name: e.target.value })} placeholder={t('Ring, bracelet, chain…')} maxLength={60} /></Field>
                  <Field label={idx === 0 ? t('Weight ({u})', { u: unit() }) : undefined}><NumberInput value={item.netWeight} onChange={(v) => setItem(item.key, { netWeight: v })} placeholder={t('about')} /></Field>
                  <Field label={idx === 0 ? t('Size / stone') : undefined}><input value={item.gemsName} onChange={(e) => setItem(item.key, { gemsName: e.target.value })} placeholder={t('optional')} maxLength={60} /></Field>
                  <Field label={idx === 0 ? t('Qty') : undefined}><NumberInput value={item.quantity} onChange={(v) => setItem(item.key, { quantity: v })} min={1} /></Field>
                  {locked ? <span className="icon-btn" title={t('At the workshop. It cannot be removed.')}><Icon name="lock" /></span> : (
                    <button type="button" className="icon-btn" onClick={() => setItems((l) => (l.length > 1 ? l.filter((x) => x.key !== item.key) : l))} disabled={items.length === 1} aria-label={t('Remove')}><Icon name="trash" /></button>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-small" style={{ marginTop: 12 }} onClick={() => setItems((l) => [...l, blank()])}><Icon name="plus" size={16} />{t('Another piece')}</button>
        </Panel>
        <Panel title={t('3. Price, advance and date')}>
          <div className="form-grid">
            <Field label={t('Metal')} className="span-2"><div><Seg value={grade} onChange={(g) => { setO({ grade: g }); setRateTouched(false); }} options={grades.map((g) => ({ value: g.gradeId, label: g.name, dot: g.color }))} /></div></Field>
            <Field label={t('Agreed price {basis}', { basis: priceBasis() })} hint={t("Today's price is filled in. Change it if you agreed another one.")}><NumberInput value={order.rate} onChange={(v) => { setRateTouched(true); setO({ rate: v }); }} /></Field>
            <Field label={t('Promised date')} error={errors.dueDate}><input type="date" value={order.dueDate} onChange={(e) => setO({ dueDate: e.target.value })} /></Field>
            <Field label={t('Advance paid')}><NumberInput value={order.advanceAmount} onChange={(v) => setO({ advanceAmount: v })} /></Field>
            <Field label={t("Customer's old gold ({u})", { u: unit() })} hint={t('Weight they handed over, if any')}><NumberInput value={order.customerMetalWeight} onChange={(v) => setO({ customerMetalWeight: v })} /></Field>
            <Field label={t('Notes')} className="span-2"><textarea value={order.remark} onChange={(e) => setO({ remark: e.target.value })} placeholder={t('Design, engraving, anything to remember')} /></Field>
          </div>
          {num(order.advanceAmount) > 0 && <p className="muted small" style={{ marginBottom: 0 }}>{t('The advance is deducted automatically when you make the bill.')}</p>}
        </Panel>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link className="btn" to={editing ? `/orders/${id}` : '/orders'}>{t('Cancel')}</Link>
          <button className="btn btn-primary btn-big" disabled={saving}>{saving ? t('Saving…') : editing ? t('Save') : t('Take the order')}</button>
        </div>
      </div>
    </form>
  );
}
