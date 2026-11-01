import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorText, get, post, put } from '../api';
import { useAuth } from '../auth.jsx';
import { billTotals, lineTotals } from '../calc';
import { CustomerPicker, EMPTY_CUSTOMER, GradeSelect, MakingSelect, asCustomer } from '../components/pickers.jsx';
import { isoDate, money, num, priceBasis, unit, weight } from '../format';
import { t } from '../i18n';
import { METHODS, useShop } from '../shop.jsx';
import { Chips, Empty, ErrorBox, Field, Icon, Loading, NumberInput, PageHeader, Panel, SearchBox, useDebounced, useFetch, useUi } from '../ui.jsx';

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function lineFromStock(item, rateFor) {
  return {
    key: newKey(), stockItem: item.itemId, code: item.code, photo: item.photo, name: item.name, grade: item.grade,
    rate: rateFor(item.grade), quantity: 1, netWeight: item.weight, lossWeight: '', makingMode: item.makingMode,
    makingCharge: item.makingCharge ?? '', gemsName: item.gemsName || '', gemsPrice: item.gemsPrice ?? '', size: item.size || '', more: false,
  };
}

function TicketLine({ line, onChange, onRemove }) {
  const { gradeById } = useShop();
  const tot = lineTotals(line);
  const set = (patch) => onChange({ ...line, ...patch });
  const free = !line.stockItem;
  return (
    <div className="tline">
      <div className="tline-head">
        <span className="thumb">{line.photo ? <img src={line.photo} alt="" /> : <Icon name="gem" />}</span>
        <div className="grow">
          {free ? <input value={line.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('Name of the piece')} maxLength={60} style={{ minHeight: 38 }} /> : <div className="cell-main">{line.name}</div>}
          <div className="cell-sub">{line.code ? `${line.code} · ` : ''}{gradeById(line.grade)?.name || ''}</div>
        </div>
        <span className="tline-amount">{money(tot.amount)}</span>
        <button type="button" className="icon-btn" onClick={onRemove} aria-label={t('Remove')}><Icon name="x" size={18} /></button>
      </div>
      <div className="tline-grid">
        <Field label={t('Weight ({u})', { u: unit() })}><NumberInput value={line.netWeight} onChange={(v) => set({ netWeight: v })} disabled={!free} /></Field>
        <Field label={t('Price {basis}', { basis: priceBasis() })}><NumberInput value={line.rate} onChange={(v) => set({ rate: v, rateTouched: true })} /></Field>
        <Field label={line.makingMode === 'percent' ? t('Making %') : t('Making')}><NumberInput value={line.makingCharge} onChange={(v) => set({ makingCharge: v })} /></Field>
      </div>
      {line.more ? (
        <div className="tline-grid">
          <Field label={t('Metal')}><GradeSelect value={line.grade} onChange={(g) => set({ grade: g, ...(line.rateTouched ? {} : { rate: gradeById(g)?.rate?.sellPrice ?? line.rate }) })} /></Field>
          <Field label={t('Making type')}><MakingSelect value={line.makingMode} onChange={(m) => set({ makingMode: m })} /></Field>
          <Field label={t('Loss ({u})', { u: unit() })}><NumberInput value={line.lossWeight} onChange={(v) => set({ lossWeight: v })} /></Field>
          <Field label={t('Stone')}><input value={line.gemsName} onChange={(e) => set({ gemsName: e.target.value })} maxLength={60} /></Field>
          <Field label={t('Stone price')}><NumberInput value={line.gemsPrice} onChange={(v) => set({ gemsPrice: v })} /></Field>
          {free && <Field label={t('Quantity')}><NumberInput value={line.quantity} onChange={(v) => set({ quantity: v })} min={1} /></Field>}
        </div>
      ) : (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="link-btn small" onClick={() => set({ more: true })}>{t('More details (metal, stone, loss…)')}</button>
          <span className="small muted">{t('Metal {a} + making {b}', { a: money(tot.metal), b: money(tot.making) })}</span>
        </div>
      )}
    </div>
  );
}

function StockPicker({ picked, onPick }) {
  const { grades } = useShop();
  const ui = useUi();
  const [text, setText] = useState('');
  const [grade, setGrade] = useState('all');
  const q = useDebounced(text, 250);
  const list = useFetch(() => get('stock/', { q, status: 'instock', grade: grade === 'all' ? '' : grade, page_size: 60 }), [q, grade]);
  const pickedIds = new Set(picked);

  // A barcode scanner types the code and presses Enter: add that piece straight away.
  const scan = async (code) => {
    if (!code.trim()) return;
    try {
      const item = await get(`stock/code/${encodeURIComponent(code.trim())}/`);
      if (item.status !== 'instock') ui.error(t('{name} is already sold or reserved.', { name: `${item.code} ${item.name}` }));
      else { onPick(item); setText(''); }
    } catch {
      const rows = list.data?.results || [];
      if (rows.length === 1) { onPick(rows[0]); setText(''); }
    }
  };

  return (
    <div className="pos-picker">
      <div className="toolbar">
        <SearchBox value={text} onChange={setText} onEnter={scan} placeholder={t('Search or scan a code')} autoFocus />
        <Chips label={t('Metal')} value={grade} onChange={setGrade} options={[{ value: 'all', label: t('All') }, ...grades.map((g) => ({ value: String(g.gradeId), label: g.name }))]} />
      </div>
      {list.error && <ErrorBox message={errorText(list.error)} onRetry={list.reload} />}
      {list.loading && !list.data ? <Loading /> : list.data?.results.length === 0 ? (
        <Panel><Empty title={q ? t('Nothing matches') : t('No jewellery in stock')} action={<Link className="btn" to="/stock?new=1">{t('Add to stock')}</Link>}>{t('You can still sell a piece that is not in stock with the button below.')}</Empty></Panel>
      ) : (
        <div className="prod-grid" style={{ opacity: list.loading ? 0.6 : 1 }}>
          {list.data?.results.map((item) => {
            const on = pickedIds.has(item.itemId);
            const g = grades.find((x) => x.gradeId === item.grade);
            const est = lineTotals({ ...item, netWeight: item.weight, rate: g?.rate?.sellPrice, quantity: 1 }).amount;
            return (
              <button type="button" key={item.itemId} className={`prod-card ${on ? 'picked' : ''}`} onClick={() => onPick(item)} aria-pressed={on}>
                <span className="prod-code">{item.code}</span>
                {on && <span className="prod-check"><Icon name="check" size={16} /></span>}
                <span className="prod-img">{item.photo ? <img src={item.photo} alt="" loading="lazy" /> : <Icon name="gem" size={40} />}</span>
                <span className="prod-body">
                  <span className="prod-name">{item.name}</span>
                  <span className="prod-meta">{item.gradeName} · {weight(item.weight)}</span>
                  <span className="prod-price">{money(est)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sell() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const orderParam = params.get('order');
  const navigate = useNavigate();
  const ui = useUi();
  const { isOwner } = useAuth();
  const { settings, grades, gradeById } = useShop();
  const rateFor = (gid) => gradeById(gid)?.rate?.sellPrice ?? '';
  const defaultGrade = grades[0]?.gradeId;

  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [lines, setLines] = useState([]);
  const [bill, setBill] = useState({ orderId: orderParam ? Number(orderParam) : null, grade: null, date: isoDate(), customerMetalWeight: '', customerMetalGrade: null, buyRate: '', discount: '', advanceAmount: '', paidAmount: '', laterPaid: 0, payMethod: 'cash', note: '' });
  const [oldGold, setOldGold] = useState(false);
  const [version, setVersion] = useState(undefined);
  const [loading, setLoading] = useState(editing || Boolean(orderParam) || Boolean(params.get('customer')) || Boolean(params.get('item')));
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState('pick'); // phones: pick pieces, then the receipt
  const setB = (p) => setBill((b) => ({ ...b, ...p }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (editing) {
          const b = await get(`bills/${id}/`);
          if (!alive) return;
          setCustomer(asCustomer(b.customer));
          setVersion(b.version);
          setBill({ orderId: b.orderId, grade: b.grade, date: b.date, customerMetalWeight: b.customerMetalWeight || '', customerMetalGrade: b.customerMetalGrade, buyRate: b.buyRate || '', discount: b.discount || '', advanceAmount: b.advanceAmount || '', paidAmount: b.paidAmount || '', laterPaid: b.laterPaid || 0, payMethod: b.payMethod, note: b.note || '', taxRate: b.taxRate || 0 });
          setOldGold(b.customerMetalWeight > 0);
          setLines(b.lines.map((l) => ({ ...l, key: newKey(), lossWeight: l.lossWeight || '', makingCharge: l.makingCharge ?? '', gemsPrice: l.gemsPrice || '', rateTouched: true, more: false })));
        } else if (orderParam) {
          const o = await get(`orders/${orderParam}/`);
          if (!alive) return;
          const existing = o.bills.find((b) => b.status === 'submitted');
          if (existing) { navigate(`/bills/${existing.billId}`, { replace: true }); return; }
          setCustomer(asCustomer(o.customer));
          setBill((b) => ({ ...b, grade: o.grade, advanceAmount: o.advanceAmount || '', customerMetalWeight: o.customerMetalWeight || '' }));
          setOldGold(Boolean(o.customerMetalWeight));
          setLines(o.items.map((i) => ({ key: newKey(), name: i.name, grade: o.grade, rate: o.rate || rateFor(o.grade), rateTouched: Boolean(o.rate), quantity: i.quantity || 1, netWeight: i.netWeight ?? '', lossWeight: '', makingMode: settings?.defaultMakingMode || 'perWeight', makingCharge: '', gemsName: i.gemsName || '', gemsPrice: i.gemsPrice ?? '', size: i.size || '', more: false })));
        } else if (params.get('customer')) {
          const c = await get(`customers/${params.get('customer')}/`);
          if (alive) setCustomer(asCustomer(c));
        } else if (params.get('item')) {
          const item = await get(`stock/${params.get('item')}/`);
          if (alive && item.status === 'instock') setLines([lineFromStock(item, rateFor)]);
        }
      } catch (e) {
        if (alive) setLoadError(e);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orderParam]);

  // Prices arrive a moment after the page: fill lines that are still waiting for one.
  useEffect(() => {
    setLines((l) => l.map((x) => ((x.rate === '' || x.rate == null) && !x.rateTouched ? { ...x, rate: rateFor(x.grade) } : x)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grades]);

  // Old metal: default buy price from today's price of the chosen grade.
  const metalGrade = bill.customerMetalGrade || bill.grade || defaultGrade;
  useEffect(() => {
    if (oldGold && bill.buyRate === '' && metalGrade) {
      const r = gradeById(metalGrade)?.rate;
      if (r) setB({ buyRate: r.buyPrice ?? r.sellPrice });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldGold, metalGrade, grades]);

  const totals = useMemo(() => billTotals(lines, oldGold ? bill : { ...bill, customerMetalWeight: 0 }, editing ? bill.taxRate : settings?.taxRate), [lines, bill, oldGold, settings, editing]);
  const canDiscount = isOwner || settings?.employeesCanDiscount;
  const fromOrder = Boolean(bill.orderId);

  const pick = (item) => {
    setLines((l) => (l.some((x) => x.stockItem === item.itemId) ? l.filter((x) => x.stockItem !== item.itemId) : [...l, lineFromStock(item, rateFor)]));
  };
  const addFree = () => setLines((l) => [...l, { key: newKey(), name: '', grade: bill.grade || defaultGrade, rate: rateFor(bill.grade || defaultGrade), quantity: 1, netWeight: '', lossWeight: '', makingMode: settings?.defaultMakingMode || 'perWeight', makingCharge: '', gemsName: '', gemsPrice: '', size: '', more: false }]);

  const save = async (draft = false) => {
    const e = {};
    if (lines.length === 0) e.lines = t('Add at least one piece.');
    lines.forEach((l) => { if (!l.name.trim() || !(num(l.netWeight) > 0)) e.lines = t('Every piece needs a name and a weight.'); if (!(num(l.rate) > 0)) e.lines = t('Every piece needs a price.'); });
    if (totals.remaining > 0.005 && !draft && !customer.customerId && !customer.name.trim()) e.customer = { name: t('The customer still owes money: enter their name.') };
    if (totals.remaining < -0.005) e.pay = t('Paid is more than the total.');
    setErrors(e);
    if (Object.keys(e).length) { ui.error(e.lines || e.pay || e.customer.name); setStep('ticket'); return; }
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      customer: customer.customerId || customer.name.trim() ? customer : {},
      bill: { orderId: bill.orderId, date: bill.date, grade: bill.grade || lines[0]?.grade || defaultGrade, discount: num(bill.discount), advanceAmount: num(bill.advanceAmount), paidAmount: num(bill.paidAmount), payMethod: bill.payMethod, note: bill.note, status: draft ? 'draft' : 'submitted',
        customerMetalWeight: oldGold ? num(bill.customerMetalWeight) : 0, customerMetalGrade: oldGold ? metalGrade : null, buyRate: oldGold ? n(bill.buyRate) : null },
      items: lines.map((l) => ({ lineId: l.lineId, stockItem: l.stockItem || null, name: l.name.trim(), grade: l.grade, rate: n(l.rate), quantity: n(l.quantity) || 1, netWeight: num(l.netWeight), lossWeight: num(l.lossWeight), makingMode: l.makingMode, makingCharge: num(l.makingCharge), gemsName: l.gemsName, gemsPrice: n(l.gemsPrice), size: l.size })),
      version,
    };
    setSaving(true);
    try {
      const saved = editing ? await put(`bills/${id}/`, body) : await post('bills/', body);
      ui.success(draft ? t('Draft saved.') : t('Sale #{id} saved.', { id: saved.billId }));
      navigate(`/bills/${saved.billId}${draft ? '' : '?print=1'}`);
    } catch (err) {
      ui.error(errorText(err));
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (loadError) return <ErrorBox message={errorText(loadError)} />;

  const balanceClass = totals.remaining < -0.005 ? 'bad' : totals.remaining <= 0.005 ? 'ok' : '';
  const ticket = (
    <Panel className="ticket" title={t('Receipt')} action={lines.length > 0 && <span className="muted small">{weight(totals.finalWeight)}</span>}>
      <div className="stack" style={{ gap: 14 }}>
        <CustomerPicker value={customer} onChange={setCustomer} errors={errors.customer || {}} locked={fromOrder} optional compact />
        <div className="ticket-lines">
          {lines.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('Tap the pieces to sell on the left.')}</p> : lines.map((l) => (
            <TicketLine key={l.key} line={l} onChange={(nl) => setLines((all) => all.map((x) => (x.key === l.key ? nl : x)))} onRemove={() => setLines((all) => all.filter((x) => x.key !== l.key))} />
          ))}
          <button type="button" className="btn btn-small" onClick={addFree}><Icon name="plus" size={16} />{t('Piece not in stock')}</button>
        </div>

        <div>
          <div className="sum-row"><span>{t('Total of pieces')}</span><b className="num">{money(totals.subtotal)}</b></div>
          <label className="check small" style={{ margin: '6px 0' }}><input type="checkbox" checked={oldGold} onChange={(e) => setOldGold(e.target.checked)} />{t('Customer gives old gold (exchange)')}</label>
          {oldGold && (
            <div className="tline-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 6 }}>
              <Field label={t('Metal')}><GradeSelect value={metalGrade} onChange={(g) => setB({ customerMetalGrade: g, buyRate: '' })} /></Field>
              <Field label={t('Weight ({u})', { u: unit() })}><NumberInput value={bill.customerMetalWeight} onChange={(v) => setB({ customerMetalWeight: v })} /></Field>
              <Field label={t('Buy price')}><NumberInput value={bill.buyRate} onChange={(v) => setB({ buyRate: v })} /></Field>
            </div>
          )}
          {oldGold && totals.oldMetal > 0 && <div className="sum-row"><span>{t('Old gold taken back')}</span><span className="minus num">− {money(totals.oldMetal)}</span></div>}
          {canDiscount && <div className="sum-row input"><Field label={t('Discount')}><NumberInput value={bill.discount} onChange={(v) => setB({ discount: v })} /></Field></div>}
          {totals.tax > 0 && <div className="sum-row"><span>{settings?.taxLabel} {settings?.taxRate}%</span><span className="num">{money(totals.tax)}</span></div>}
          <div className="sum-row sum-total"><span>{t('To pay')}</span><b className="num">{money(totals.grand)}</b></div>
          {num(bill.advanceAmount) > 0 && <div className="sum-row"><span>{t('Advance already paid')}</span><span className="num">− {money(bill.advanceAmount)}</span></div>}
          {num(bill.laterPaid) > 0 && <div className="sum-row"><span>{t('Payments after the sale')}</span><span className="num">− {money(bill.laterPaid)}</span></div>}
          <div className="tline-grid" style={{ gridTemplateColumns: '1.4fr 1fr', marginTop: 6 }}>
            <Field label={t('Paid now')} error={errors.pay}>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <NumberInput value={bill.paidAmount} onChange={(v) => setB({ paidAmount: v })} />
                <button type="button" className="btn btn-small" onClick={() => setB({ paidAmount: Math.max(totals.grand - num(bill.advanceAmount) - num(bill.laterPaid), 0).toFixed(2) })}>{t('All')}</button>
              </div>
            </Field>
            <Field label={t('Paid by')}><select value={bill.payMethod} onChange={(e) => setB({ payMethod: e.target.value })}>{METHODS().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
          </div>
          <div className={`balance ${balanceClass}`}>
            <span>{totals.remaining < -0.005 ? t('Too much paid') : totals.remaining <= 0.005 ? t('Fully paid') : t('Still to pay')}</span>
            <b className="num">{money(Math.abs(totals.remaining) < 0.005 ? 0 : Math.abs(totals.remaining))}</b>
          </div>
        </div>
        <button type="button" className="btn btn-gold btn-big btn-block" disabled={saving || lines.length === 0} onClick={() => save(false)}>
          <Icon name="print" />{saving ? t('Saving…') : editing ? t('Save changes') : t('Save and print')}
        </button>
        {!editing && <button type="button" className="link-btn small" onClick={() => save(true)} disabled={saving}>{t('Save as draft (piece stays reserved)')}</button>}
      </div>
    </Panel>
  );

  return (
    <>
      <PageHeader
        back={editing ? <Link className="back" to={`/bills/${id}`}><Icon name="chevron" size={14} />{t('Sale #{id}', { id })}</Link> : fromOrder ? <Link className="back" to={`/orders/${bill.orderId}`}><Icon name="chevron" size={14} />{t('Order #{id}', { id: bill.orderId })}</Link> : null}
        title={editing ? t('Change sale #{id}', { id }) : fromOrder ? t('Bill for order #{id}', { id: bill.orderId }) : t('New sale')}
        actions={<div className="row hide-lg">
          <button type="button" className={`btn btn-small ${step === 'pick' ? 'btn-primary' : ''}`} onClick={() => setStep('pick')}>{t('1. Pieces')}</button>
          <button type="button" className={`btn btn-small ${step === 'ticket' ? 'btn-primary' : ''}`} onClick={() => setStep('ticket')}>{t('2. Receipt')} ({lines.length})</button>
        </div>}
      />
      <div className={`pos step-${step}`}>
        <div className="pos-left">{fromOrder || editing ? (
          <Panel title={t('Pieces')}><p className="muted" style={{ margin: 0 }}>{fromOrder ? t('The pieces come from the order. Set their final weight and making on the receipt.') : t('Change the pieces on the receipt.')}</p>
            {!fromOrder && <div style={{ marginTop: 14 }}><StockPicker picked={lines.map((l) => l.stockItem).filter(Boolean)} onPick={pick} /></div>}</Panel>
        ) : <StockPicker picked={lines.map((l) => l.stockItem).filter(Boolean)} onPick={pick} />}</div>
        <div className="pos-right">{ticket}</div>
      </div>
      {step === 'pick' && lines.length > 0 && (
        <div className="pos-next no-print">
          <button className="btn btn-primary btn-big btn-block" onClick={() => setStep('ticket')}>{t('Next: receipt')} · {money(totals.grand)}</button>
        </div>
      )}
    </>
  );
}
