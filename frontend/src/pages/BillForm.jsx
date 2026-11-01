import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorText, get, post } from '../api';
import { billTotals, lineTotals } from '../calc';
import { CustomerPicker, EMPTY_CUSTOMER, MetalToggle, ProductNames, RatePicker, catalogMatch } from '../components/pickers.jsx';
import { useRates } from '../rates.jsx';
import { ErrorBox, Field, Icon, Loading, NumberInput, PageHeader, Panel, useUi } from '../ui.jsx';
import { isoDate, lal, money, num } from '../format';
import { t } from '../i18n';

const blankItem = () => ({ key: Math.random().toString(36).slice(2), productName: '', netWeight: '', lossWeight: '', makingCharge: '', gemsName: '', gemsPrice: '', size: '', more: false });
const asCustomer = (c) => ({ customerId: c.customerId, name: c.name, phone: c.phone || '', address: c.address || '', email: c.email || '' });

export default function BillForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const orderParam = params.get('order');
  const navigate = useNavigate();
  const ui = useUi();
  const { rate } = useRates();

  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [bill, setBill] = useState({ orderId: orderParam ? Number(orderParam) : null, billType: 'gold', rate: '', date: isoDate(), customerProductWeight: '', discount: '', advanceAmount: '', payedAmount: '', draft: false });
  const [items, setItems] = useState([blankItem()]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(editing || Boolean(orderParam) || Boolean(params.get('customer')));
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rateTouched, setRateTouched] = useState(false);
  const fromOrder = Boolean(bill.orderId);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (editing) {
          const b = await get(`bill/${id}`);
          if (!alive) return;
          setCustomer(asCustomer(b.customer));
          setBill({ orderId: b.orderId, billType: b.billType, rate: b.rate ?? '', date: b.date, customerProductWeight: b.customerProductWeight || '', discount: b.discount || '', advanceAmount: b.advanceAmount || '', payedAmount: b.payedAmount || '', draft: b.status === 'draft' });
          setItems(b.items.map((i) => ({ key: `b${i.billProductId}`, billProductId: i.billProductId, productName: i.productName, netWeight: i.netWeight ?? '', lossWeight: i.lossWeight || '', makingCharge: i.makingCharge || '', gemsName: i.gemsName || '', gemsPrice: i.gemsPrice ?? '', size: i.size || '', more: Boolean(i.gemsName || i.gemsPrice || i.size) })));
          setRateTouched(true);
        } else if (orderParam) {
          const o = await get(`order/${orderParam}`);
          if (!alive) return;
          const existing = o.bills.find((b) => b.status === 'submitted');
          if (existing) {
            ui.error(t("Order #{o.orderId} already has bill #{existing.billId}.", { "o.orderId": o.orderId, "existing.billId": existing.billId }));
            navigate(`/bills/${existing.billId}`, { replace: true });
            return;
          }
          setCustomer(asCustomer(o.customer));
          setBill((b) => ({ ...b, billType: o.type, rate: o.rate || '', advanceAmount: o.advanceAmount || '', customerProductWeight: o.customerProductWeight || '' }));
          setRateTouched(Boolean(o.rate));
          setItems(o.items.map((i) => ({ ...blankItem(), productName: i.productName, netWeight: i.netWeight ?? '', gemsName: i.gemsName || '', gemsPrice: i.gemsPrice ?? '', size: i.size || '', more: Boolean(i.gemsName || i.gemsPrice) })));
        } else if (params.get('customer')) {
          const c = await get(`customer/${params.get('customer')}`);
          if (alive) setCustomer(asCustomer(c));
        }
      } catch (e) {
        if (alive) setLoadError(e);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orderParam]);

  useEffect(() => {
    if (editing || rateTouched || !rate) return;
    setBill((b) => ({ ...b, rate: b.billType === 'silver' ? rate.silverRate : rate.hallmarkRate }));
  }, [rate, bill.billType, editing, rateTouched]);

  const setB = (patch) => setBill((b) => ({ ...b, ...patch }));
  const setItem = (key, patch) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const totals = useMemo(() => billTotals(items, bill), [items, bill]);

  const validate = () => {
    const e = {};
    if (!customer.customerId && !customer.name.trim()) e.customer = { name: t("Enter the customer name.") };
    if (!(num(bill.rate) > 0)) e.rate = t("Enter the rate per tola.");
    items.forEach((i) => {
      if (!i.productName.trim()) e[`${i.key}.name`] = t("Name this item.");
      if (i.netWeight === '' || Number.isNaN(Number(i.netWeight))) e[`${i.key}.weight`] = t("Enter its weight.");
    });
    if (totals.remaining < -0.005) e.pay = t("Paid and advance are more than the bill total.");
    setErrors(e);
    if (Object.keys(e).length) setTimeout(() => document.querySelector('.has-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    return Object.keys(e).length === 0;
  };

  const save = async (ev) => {
    ev.preventDefault();
    if (!validate()) {
      ui.error(t("Some details are missing. Check the highlighted fields."));
      return;
    }
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      customer: { customerId: customer.customerId, name: customer.name, phone: customer.phone, address: customer.address, email: customer.email },
      bill: { orderId: bill.orderId, date: bill.date, rate: num(bill.rate), billType: bill.billType, customerProductWeight: num(bill.customerProductWeight), discount: num(bill.discount), advanceAmount: num(bill.advanceAmount), payedAmount: num(bill.payedAmount), status: bill.draft ? 'draft' : 'submitted' },
      items: items.map((i) => ({ billProductId: i.billProductId, productName: i.productName, netWeight: num(i.netWeight), lossWeight: num(i.lossWeight), makingCharge: num(i.makingCharge), gemsName: i.gemsName, gemsPrice: n(i.gemsPrice), size: n(i.size) })),
    };
    if (editing) body.billId = Number(id);
    setSaving(true);
    try {
      const saved = await post(editing ? 'bill/update' : 'generate-bill/', body);
      ui.success(editing ? t("Bill updated.") : t("Bill #{saved.billId} saved.", { "saved.billId": saved.billId }));
      navigate(`/bills/${saved.billId}`);
    } catch (err) {
      ui.error(errorText(err));
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (loadError) return <ErrorBox message={errorText(loadError)} />;

  const balanceClass = totals.remaining < -0.005 ? 'bad' : totals.remaining <= 0.005 ? 'ok' : '';
  const backTo = editing ? `/bills/${id}` : fromOrder ? `/orders/${bill.orderId}` : '/bills';

  return (
    <form onSubmit={save} noValidate>
      <ProductNames />
      <PageHeader
        back={<Link className="back" to={backTo}><Icon name="chevron" size={14} />{editing ? t("Bill #{id}", { "id": id }) : fromOrder ? t("Order #{bill.orderId}", { "bill.orderId": bill.orderId }) : t("Bills")}</Link>}
        title={editing ? t("Edit bill #{id}", { "id": id }) : fromOrder ? t("Bill for order #{bill.orderId}", { "bill.orderId": bill.orderId }) : t("New bill")}
        subtitle={t("Totals are worked out as you type")}
      />
      <div className="cols-main">
        <div className="stack">
          <Panel title={t("Customer")}>
            <CustomerPicker value={customer} onChange={setCustomer} errors={errors.customer || {}} locked={fromOrder && !editing} />
          </Panel>

          <Panel title={t("Bill")}>
            <div className="form-grid">
              <Field label={t("Metal")}><div><MetalToggle value={bill.billType} onChange={(t) => { setB({ billType: t }); if (!editing) setRateTouched(false); }} disabled={fromOrder} /></div></Field>
              <RatePicker className="span-2" type={bill.billType} rate={rate} value={bill.rate} onChange={(v) => { setRateTouched(true); setB({ rate: v }); }} error={errors.rate} />
              <Field label={t("Date")}><input type="date" value={bill.date} onChange={(e) => setB({ date: e.target.value })} /></Field>
            </div>
          </Panel>

          <Panel title={t("Items")} action={<span className="muted-text small">{t("Weights in lal. Amount = (weight + loss) × rate ÷ 100 + making + stone")}</span>}>
            <div className="items">
              {items.map((item, idx) => {
                const line = lineTotals(item, bill.rate);
                const first = idx === 0;
                return (
                  <div className="item-row" key={item.key}>
                    <div className="item-main">
                      <Field label={first ? t("Item") : undefined} error={errors[`${item.key}.name`]}>
                        <input list="product-names" value={item.productName} onChange={(e) => { const productName = e.target.value; const c = catalogMatch(productName); setItem(item.key, { productName, ...(c && !item.netWeight && { netWeight: c.netWeight ?? '' }), ...(c && !item.makingCharge && { makingCharge: c.makingCharge ?? '' }), ...(c && !item.gemsName && { gemsName: c.gemsName || '', gemsPrice: c.gemsPrice ?? '', size: c.size ?? '', more: Boolean(c.gemsName || c.size) }) }); }} placeholder={t("Ring, chain…")} maxLength={50} />
                      </Field>
                      <Field label={first ? t("Weight") : undefined} error={errors[`${item.key}.weight`]}><NumberInput value={item.netWeight} onChange={(v) => setItem(item.key, { netWeight: v })} /></Field>
                      <Field label={first ? t("Loss") : undefined}><NumberInput value={item.lossWeight} onChange={(v) => setItem(item.key, { lossWeight: v })} /></Field>
                      <Field label={first ? t("Making (Rs.)") : undefined}><NumberInput value={item.makingCharge} onChange={(v) => setItem(item.key, { makingCharge: v })} /></Field>
                      <Field label={first ? t("Amount") : undefined}><div className="amount-box">{money(line.amount)}</div></Field>
                      <div className="item-tools">
                        <button type="button" className="icon-btn" onClick={() => setItems((l) => (l.length > 1 ? l.filter((x) => x.key !== item.key) : l))} disabled={items.length === 1} aria-label={t("Remove item")} title={t("Remove item")}><Icon name="trash" /></button>
                      </div>
                    </div>
                    {item.more ? (
                      <div className="item-more">
                        <Field label={t("Stone")}><input value={item.gemsName} onChange={(e) => setItem(item.key, { gemsName: e.target.value })} maxLength={50} /></Field>
                        <Field label={t("Stone price (Rs.)")}><NumberInput value={item.gemsPrice} onChange={(v) => setItem(item.key, { gemsPrice: v })} /></Field>
                        <Field label={t("Size")}><NumberInput value={item.size} onChange={(v) => setItem(item.key, { size: v })} /></Field>
                        <div className="small muted-text" style={{ alignSelf: 'end', paddingBottom: 10 }}>{t("Total weight")} {lal(line.totalWeight)}</div>
                      </div>
                    ) : (
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <button type="button" className="link-btn small" onClick={() => setItem(item.key, { more: true })}>{t("Add stone or size")}</button>
                        <span className="small muted-text">{t("Total weight")} {lal(line.totalWeight)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14 }}><button type="button" className="btn" onClick={() => setItems((l) => [...l, blankItem()])}><Icon name="plus" size={16} />{t("Add another item")}</button></div>
          </Panel>
        </div>

        <aside className="summary">
          <Panel title={t("Summary")}>
            <div className="sum-row"><span>{t("Items (")}{lal(totals.finalWeight)})</span><b className="num">{money(totals.totalAmount)}</b></div>
            <div className="sum-row input">
              <Field label={t("Customer's old metal (lal)")}><NumberInput value={bill.customerProductWeight} onChange={(v) => setB({ customerProductWeight: v })} /></Field>
              <span className="minus num">− {money(totals.customerAmount)}</span>
            </div>
            <div className="sum-row input"><Field label={t("Discount (Rs.)")}><NumberInput value={bill.discount} onChange={(v) => setB({ discount: v })} /></Field></div>
            <div className="sum-row sum-total"><span>{t("Grand total")}</span><b className="num">{money(totals.grandTotal)}</b></div>
            <div className="sum-row input"><Field label={t("Advance already paid (Rs.)")}><NumberInput value={bill.advanceAmount} onChange={(v) => setB({ advanceAmount: v })} /></Field></div>
            <div className="sum-row input"><Field label={t("Paid now (Rs.)")} error={errors.pay}><NumberInput value={bill.payedAmount} onChange={(v) => setB({ payedAmount: v })} /></Field></div>
            <div className={`balance ${balanceClass}`}>
              <span>{totals.remaining < -0.005 ? t("Overpaid by") : totals.remaining <= 0.005 ? t("Fully paid") : t("Balance due")}</span>
              <b className="num">{totals.remaining <= 0.005 && totals.remaining >= -0.005 ? money(0) : money(Math.abs(totals.remaining))}</b>
            </div>
            <label className="check" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={bill.draft} onChange={(e) => setB({ draft: e.target.checked })} />
              {t("Save as draft (do not mark the order delivered)")}
            </label>
            <button className="btn btn-primary btn-big" style={{ width: '100%', marginTop: 14 }} disabled={saving}>{saving ? t("Saving…") : editing ? t("Save changes") : bill.draft ? t("Save draft") : t("Save bill")}</button>
          </Panel>
        </aside>
      </div>
    </form>
  );
}
