import JsBarcode from 'jsbarcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { del, errorText, get, patch, post, upload } from '../api';
import { useAuth } from '../auth.jsx';
import { lineTotals } from '../calc';
import { GradeSelect, MakingSelect } from '../components/pickers.jsx';
import { useListParams } from '../components/useListParams';
import { fmtDate, money, num, unit, weight } from '../format';
import { t, tn } from '../i18n';
import { useShop } from '../shop.jsx';
import { Badge, Chips, Empty, ErrorBox, Field, GradeTag, Icon, Loading, Modal, NumberInput, PageHeader, Pager, Panel, PhotoPicker, SearchBox, useDebounced, useFetch, useUi } from '../ui.jsx';

export function StockModal({ item, onClose, onSaved }) {
  const ui = useUi();
  const { isOwner } = useAuth();
  const { settings, grades } = useShop();
  const showCost = isOwner || settings?.employeesSeeCost;
  const [form, setForm] = useState(() => item ? { ...item, gemsPrice: item.gemsPrice ?? '', makingCharge: item.makingCharge ?? '', costPrice: item.costPrice ?? '' } : {
    code: '', name: '', category: '', grade: grades[0]?.gradeId, weight: '', size: '', gemsName: '', gemsPrice: '',
    makingMode: settings?.defaultMakingMode || 'perWeight', makingCharge: '', costPrice: '', supplier: null, note: '', quantity: 1,
  });
  const [photo, setPhoto] = useState(undefined); // undefined = unchanged, null = remove
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const cats = useFetch(() => get('stock/categories/'), [], { live: false });
  const sups = useFetch(() => (isOwner ? get('suppliers/') : Promise.resolve([])), [isOwner], { live: false });
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const g = grades.find((x) => x.gradeId === Number(form.grade));
  const est = lineTotals({ ...form, netWeight: form.weight, rate: g?.rate?.sellPrice, quantity: 1 }).amount;

  const save = async () => {
    const e = {};
    if (!form.name.trim()) e.name = t('Enter the name of the piece.');
    if (!(num(form.weight) > 0)) e.weight = t('Enter its weight.');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      code: form.code || '', name: form.name.trim(), category: form.category.trim(), grade: form.grade, weight: num(form.weight), size: form.size,
      gemsName: form.gemsName, gemsPrice: n(form.gemsPrice), makingMode: form.makingMode, makingCharge: n(form.makingCharge), note: form.note,
      ...(showCost ? { costPrice: n(form.costPrice) } : {}), ...(isOwner ? { supplier: form.supplier || null } : {}),
    };
    try {
      let saved;
      if (item) saved = [await patch(`stock/${item.itemId}/`, { ...body, version: item.version })];
      else saved = await post('stock/', { ...body, quantity: Math.max(1, Math.round(num(form.quantity) || 1)) });
      if (photo !== undefined) {
        for (const s of saved) await upload(`stock/${s.itemId}/photo/`, 'photo', photo);
      }
      ui.success(item ? t('Piece updated.') : saved.length > 1 ? t('{n} pieces added.', { n: saved.length }) : t('Piece {code} added.', { code: saved[0].code }));
      onSaved(saved[0]);
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object' && (d.code || d.name || d.weight)) setErrors({ code: d.code?.[0], name: d.name?.[0], weight: d.weight?.[0] });
      ui.error(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal wide title={item ? t('Change piece {code}', { code: item.code }) : t('Add jewellery to stock')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button></>}>
      <PhotoPicker value={item?.photo} onPick={setPhoto} size={120} label={t('Photo of the piece')} />
      <div className="form-grid">
        <Field label={t('Name')} error={errors.name}><input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} placeholder={t('Ring, bracelet, chain…')} autoFocus /></Field>
        <Field label={t('Category')} hint={t('To group your stock: Rings, Chains…')}>
          <input value={form.category} onChange={(e) => set({ category: e.target.value })} list="stock-cats" maxLength={40} />
          <datalist id="stock-cats">{(cats.data || []).map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label={t('Metal')}><GradeSelect value={form.grade} onChange={(v) => set({ grade: v })} /></Field>
        <Field label={t('Weight ({u})', { u: unit() })} error={errors.weight}><NumberInput value={form.weight} onChange={(v) => set({ weight: v })} /></Field>
        <Field label={t('Making type')}><MakingSelect value={form.makingMode} onChange={(v) => set({ makingMode: v })} /></Field>
        <Field label={form.makingMode === 'percent' ? t('Making %') : t('Making charge')}><NumberInput value={form.makingCharge} onChange={(v) => set({ makingCharge: v })} /></Field>
        <Field label={t('Stone')}><input value={form.gemsName} onChange={(e) => set({ gemsName: e.target.value })} maxLength={60} placeholder={t('optional')} /></Field>
        <Field label={t('Stone price')}><NumberInput value={form.gemsPrice} onChange={(v) => set({ gemsPrice: v })} /></Field>
        <Field label={t('Size')}><input value={form.size} onChange={(e) => set({ size: e.target.value })} maxLength={20} /></Field>
        <Field label={t('Code / barcode')} error={errors.code} hint={t('Leave empty to create one')}><input value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} maxLength={30} /></Field>
        {showCost && <Field label={t('Cost price')} hint={t('Only you see it')}><NumberInput value={form.costPrice} onChange={(v) => set({ costPrice: v })} /></Field>}
        {isOwner && (
          <Field label={t('Supplier')}>
            <select value={form.supplier || ''} onChange={(e) => set({ supplier: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>
              {(sups.data || []).map((s) => <option key={s.supplierId} value={s.supplierId}>{s.name}</option>)}
            </select>
          </Field>
        )}
        {!item && <Field label={t('How many identical pieces?')}><NumberInput value={form.quantity} onChange={(v) => set({ quantity: v })} min={1} step={1} /></Field>}
        <Field label={t('Note')} className="span-2"><input value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={200} /></Field>
      </div>
      {g?.rate && num(form.weight) > 0 && <div className="balance ok"><span>{t("Selling price at today's rate")}</span><b className="num">{money(est)}</b></div>}
    </Modal>
  );
}

export default function Stock() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { grades } = useShop();
  const defaults = useMemo(() => ({ status: 'instock', grade: 'all', q: '', page: '1', new: '' }), []);
  const [f, setF] = useListParams(defaults);
  const [text, setText] = useState(f.q);
  const q = useDebounced(text);
  const [adding, setAdding] = useState(search.get('new') === '1');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const { data, loading, error, reload } = useFetch(() => get('stock/', { q, status: f.status, grade: f.grade === 'all' ? '' : f.grade, page: f.page, page_size: 36 }), [q, f.status, f.grade, f.page]);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <PageHeader title={t('Jewellery stock')} subtitle={data ? `${tn(data.count, 'piece', 'pieces')} · ${weight(data.totalWeight)}` : t('Every piece in your shop, with its photo')}
        actions={<>
          {selecting ? (
            <>
              <button className="btn" onClick={() => { setSelecting(false); setSelected([]); }}>{t('Cancel')}</button>
              <Link className={`btn btn-primary ${selected.length ? '' : 'disabled'}`} to={`/stock/labels?ids=${selected.join(',')}`} target="_blank" onClick={(e) => !selected.length && e.preventDefault()}><Icon name="print" size={18} />{t('Print {n} labels', { n: selected.length })}</Link>
            </>
          ) : <button className="btn" onClick={() => setSelecting(true)}><Icon name="tag" size={18} />{t('Labels')}</button>}
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('Add to stock')}</button>
        </>} />
      <div className="toolbar">
        <SearchBox value={text} onChange={(v) => { setText(v); setF({ q: v }); }} placeholder={t('Name, code, stone…')} />
        <Chips label={t('Status')} value={f.status} onChange={(v) => setF({ status: v })} options={[{ value: 'instock', label: t('In stock') }, { value: 'reserved', label: t('Reserved') }, { value: 'sold', label: t('Sold') }, { value: 'all', label: t('All') }]} />
        <select value={f.grade} onChange={(e) => setF({ grade: e.target.value })} style={{ width: 'auto' }} aria-label={t('Metal')}>
          <option value="all">{t('All metals')}</option>
          {grades.map((g) => <option key={g.gradeId} value={g.gradeId}>{g.name}</option>)}
        </select>
      </div>
      {error && <ErrorBox message={errorText(error)} onRetry={reload} />}
      {loading && !data ? <Loading /> : data?.results.length === 0 ? (
        <Panel><Empty title={t('No pieces here')} action={<button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('Add to stock')}</button>}>{t('Add your jewellery once with a photo; then selling is a tap.')}</Empty></Panel>
      ) : (
        <div className="prod-grid" style={{ opacity: loading ? 0.6 : 1 }}>
          {data?.results.map((item) => (
            <button type="button" key={item.itemId} className={`prod-card ${item.status !== 'instock' ? 'sold' : ''} ${selected.includes(item.itemId) ? 'picked' : ''}`}
              onClick={() => (selecting ? toggle(item.itemId) : navigate(`/stock/${item.itemId}`))}>
              <span className="prod-code">{item.code}</span>
              {selected.includes(item.itemId) && <span className="prod-check"><Icon name="check" size={16} /></span>}
              <span className="prod-img">{item.photo ? <img src={item.photo} alt="" loading="lazy" /> : <Icon name="gem" size={40} />}</span>
              <span className="prod-body">
                <span className="prod-name">{item.name}</span>
                <span className="prod-meta">{item.gradeName} · {weight(item.weight)}</span>
                {item.status !== 'instock' && <span><Badge kind={item.status} /></span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <Pager page={data?.page} totalPages={data?.totalPages} onPage={(p) => setF({ page: String(p) })} />
      {adding && <StockModal onClose={() => { setAdding(false); setF({ new: '' }); }} onSaved={() => { setAdding(false); setF({ new: '' }); reload(); }} />}
    </>
  );
}

export function StockDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ui = useUi();
  const { isOwner } = useAuth();
  const { gradeById } = useShop();
  const { data: item, loading, error, reload } = useFetch(() => get(`stock/${id}/`), [id]);
  const [editing, setEditing] = useState(false);
  if (loading && !item) return <Loading />;
  if (error && !item) return <ErrorBox message={errorText(error)} onRetry={reload} />;
  const g = gradeById(item.grade);
  const price = lineTotals({ ...item, netWeight: item.weight, rate: g?.rate?.sellPrice, quantity: 1 });
  const remove = async () => {
    if (!(await ui.confirm({ title: t('Delete {name}?', { name: `${item.code} ${item.name}` }), message: t('The piece is removed from stock for good.'), confirmLabel: t('Delete'), danger: true }))) return;
    try { await del(`stock/${item.itemId}/`); ui.success(t('Piece deleted.')); navigate('/stock'); } catch (e) { ui.error(errorText(e)); }
  };
  return (
    <>
      <PageHeader back={<Link className="back" to="/stock"><Icon name="chevron" size={14} />{t('Jewellery stock')}</Link>} title={item.name}
        subtitle={<span className="row"><b>{item.code}</b><Badge kind={item.status} />{item.billId && <Link to={`/bills/${item.billId}`}>{t('Sale #{id}', { id: item.billId })}</Link>}</span>}
        actions={<>
          {item.status === 'instock' && <Link className="btn btn-gold" to={`/sell?item=${item.itemId}`}><Icon name="cart" size={18} />{t('Sell this piece')}</Link>}
          <Link className="btn" to={`/stock/labels?ids=${item.itemId}`} target="_blank"><Icon name="tag" size={18} />{t('Label')}</Link>
          <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={18} />{t('Change')}</button>
          {isOwner && item.status === 'instock' && <button className="btn" onClick={remove}><Icon name="trash" size={18} />{t('Delete')}</button>}
        </>} />
      <div className="cols-main" style={{ gridTemplateColumns: 'minmax(0, 380px) 1fr' }}>
        <div>{item.photo ? <img className="detail-photo" src={item.photo} alt={item.name} /> : <div className="detail-photo" style={{ display: 'grid', placeItems: 'center' }}><Icon name="camera" size={48} /></div>}</div>
        <Panel title={t('Details')}>
          <dl className="kv">
            <dt>{t('Metal')}</dt><dd><GradeTag name={item.gradeName} color={g?.color} /></dd>
            <dt>{t('Weight')}</dt><dd>{weight(item.weight)}</dd>
            {item.category && <><dt>{t('Category')}</dt><dd>{item.category}</dd></>}
            {item.size && <><dt>{t('Size')}</dt><dd>{item.size}</dd></>}
            {item.gemsName && <><dt>{t('Stone')}</dt><dd>{item.gemsName} {item.gemsPrice ? `· ${money(item.gemsPrice)}` : ''}</dd></>}
            <dt>{t('Making')}</dt><dd>{item.makingCharge != null ? `${item.makingMode === 'percent' ? `${item.makingCharge}%` : money(item.makingCharge)} (${t({ perWeight: 'Per weight unit', fixed: 'Per piece', percent: '% of metal' }[item.makingMode])})` : '—'}</dd>
            {item.costPrice != null && <><dt>{t('Cost price')}</dt><dd>{money(item.costPrice)}</dd></>}
            {item.supplierName && <><dt>{t('Supplier')}</dt><dd>{isOwner ? <Link to={`/suppliers/${item.supplier}`}>{item.supplierName}</Link> : item.supplierName}</dd></>}
            <dt>{t('Added on')}</dt><dd>{fmtDate(item.createdAt)}</dd>
            {item.soldAt && <><dt>{t('Sold on')}</dt><dd>{fmtDate(item.soldAt)}</dd></>}
            {item.note && <><dt>{t('Note')}</dt><dd>{item.note}</dd></>}
          </dl>
          {g?.rate && item.status === 'instock' && (
            <div className="balance ok" style={{ marginTop: 18 }}><span>{t("Selling price at today's rate")}</span><b className="num">{money(price.amount)}</b></div>
          )}
          {item.costPrice != null && g?.rate && item.status === 'instock' && <p className="muted small">{t('Margin: {m}', { m: money(price.amount - item.costPrice) })}</p>}
        </Panel>
      </div>
      {editing && <StockModal item={item} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}

function Barcode({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    try { JsBarcode(ref.current, value, { format: 'CODE128', displayValue: false, margin: 0, height: 40, width: 1.6 }); } catch { /* bad code */ }
  }, [value]);
  return <svg ref={ref} />;
}

// Printable labels (62 x 29 mm) with a barcode a USB scanner can read on the Sell screen.
export function Labels() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') || '').split(',').filter(Boolean);
  const { settings } = useShop();
  const { data, loading } = useFetch(() => Promise.all(ids.map((id) => get(`stock/${id}/`))), [params.get('ids')], { live: false });
  if (loading) return <Loading />;
  return (
    <div style={{ padding: 16 }}>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="print" size={18} />{t('Print')}</button>
        <span className="muted">{t('Label size 62 × 29 mm. Choose "Actual size" when printing.')}</span>
      </div>
      <div className="labels">
        {(data || []).map((i) => (
          <div className="label" key={i.itemId}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><b>{settings?.shopName}</b><b>{i.code}</b></div>
            <Barcode value={i.code} />
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span>{i.name}</span><b>{i.gradeName} · {weight(i.weight)}</b></div>
          </div>
        ))}
      </div>
    </div>
  );
}
