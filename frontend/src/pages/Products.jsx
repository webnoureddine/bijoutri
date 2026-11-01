import { useMemo, useRef, useState } from 'react';
import { del, errorText, get, patch, post } from '../api';
import { MetalToggle } from '../components/pickers.jsx';
import { useListParams } from '../components/useListParams';
import { Chips, Empty, ErrorBox, Field, Icon, Loading, Metal, Modal, NumberInput, PageHeader, Pager, SearchBox, useDebounced, useFetch, useUi } from '../ui.jsx';
import { lal, money } from '../format';
import { t } from '../i18n';

const BLANK = { name: '', metal: 'gold', netWeight: '', makingCharge: '', gemsName: '', gemsPrice: '', size: '', note: '', isActive: true };
const num = (v) => (v === '' || v == null ? null : Number(v));

export function ProductModal({ product, onClose, onSaved }) {
  const ui = useUi();
  const [form, setForm] = useState(product ? { ...BLANK, ...Object.fromEntries(Object.entries(product).map(([k, v]) => [k, v ?? ''])) } : BLANK);
  const [file, setFile] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : removePhoto ? null : product?.image), [file, removePhoto, product]);

  const save = async () => {
    if (!form.name.trim()) { setErrors({ name: t("Enter the product name.") }); return; }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(), metal: form.metal, netWeight: num(form.netWeight), makingCharge: num(form.makingCharge),
        gemsName: form.gemsName, gemsPrice: num(form.gemsPrice), size: num(form.size), note: form.note, isActive: form.isActive,
      };
      let saved = product ? await patch(`catalog/${product.catalogId}`, body) : await post('catalog/', body);
      if (file || removePhoto) {
        const fd = new FormData();
        if (file) fd.append('image', file); else fd.append('remove', '1');
        saved = await post(`catalog/${saved.catalogId}/image/`, fd);
      }
      ui.success(product ? t("Product updated.") : t("Product added."));
      onSaved(saved);
    } catch (e) {
      const d = e.response?.data;
      if (d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).some((k) => k in BLANK || k === 'image')) {
        setErrors(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])));
      } else ui.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal wide title={product ? t("Edit product") : t("Add product")} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t("Cancel")}</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t("Saving…") : t("Save product")}</button></>}>
      <div className="form-grid">
        <Field label={t("Name")} error={errors.name} className="span-2"><input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={50} placeholder={t("Ring, chain, bangle…")} /></Field>
        <Field label={t("Metal")}><div><MetalToggle value={form.metal} onChange={(metal) => set({ metal })} /></div></Field>
        <Field label={t("Usual weight (lal)")} error={errors.netWeight}><NumberInput value={form.netWeight} onChange={(v) => set({ netWeight: v })} /></Field>
        <Field label={t("Usual making charge (Rs.)")} error={errors.makingCharge}><NumberInput value={form.makingCharge} onChange={(v) => set({ makingCharge: v })} /></Field>
        <Field label={t("Size")} error={errors.size}><NumberInput value={form.size} onChange={(v) => set({ size: v })} /></Field>
        <Field label={t("Stone")}><input value={form.gemsName} onChange={(e) => set({ gemsName: e.target.value })} maxLength={50} placeholder={t("optional")} /></Field>
        <Field label={t("Stone price (Rs.)")} error={errors.gemsPrice}><NumberInput value={form.gemsPrice} onChange={(v) => set({ gemsPrice: v })} /></Field>
        <Field label={t("Note")} className="span-2"><input value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={200} /></Field>
        <Field label={t("Photo")} error={errors.image} className="span-2">
          <div className="row" style={{ gap: 12 }}>
            <div className="prod-thumb">{preview ? <img src={preview} alt="" /> : <Icon name="camera" size={26} />}</div>
            <div className="stack" style={{ gap: 8 }}>
              <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { setFile(e.target.files[0] || null); setRemovePhoto(false); }} />
              <button type="button" className="btn" onClick={() => input.current.click()}><Icon name="camera" size={16} />{preview ? t("Change photo") : t("Add photo")}</button>
              {preview && <button type="button" className="link-btn" onClick={() => { setFile(null); setRemovePhoto(true); }}>{t("Remove photo")}</button>}
            </div>
          </div>
        </Field>
        <label className="span-2 row" style={{ gap: 8 }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} style={{ width: 'auto' }} />
          {t("Show in order and bill suggestions")}
        </label>
      </div>
    </Modal>
  );
}

export default function Products() {
  const ui = useUi();
  const defaults = useMemo(() => ({ q: '', metal: 'all', active: 'all', page: '1' }), []);
  const [f, setF] = useListParams(defaults);
  const [text, setText] = useState(f.q);
  const q = useDebounced(text);
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const { data, loading, error, reload } = useFetch(
    () => get('catalog/', { q, metal: f.metal, page: f.page, ...(f.active === 'all' ? {} : { active: f.active === 'active' ? 1 : 0 }) }),
    [q, f.metal, f.active, f.page],
  );

  const remove = async (p) => {
    if (!(await ui.confirm({ title: t("Delete {p.name}?", { "p.name": p.name }), message: t("Old orders and bills keep their own copy. Only the catalog entry goes."), confirmLabel: t("Delete"), danger: true }))) return;
    try { await del(`catalog/${p.catalogId}`); ui.success(t("Product deleted.")); reload(); } catch (e) { ui.error(errorText(e)); }
  };

  return (
    <>
      <PageHeader title={t("Products")} subtitle={t("What you make and sell. Orders and bills start from these.")} actions={<button className="btn btn-primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t("Add product")}</button>} />
      <div className="toolbar">
        <SearchBox value={text} onChange={(v) => { setText(v); setF({ q: v }); }} placeholder={t("Name, stone or note")} />
        <Chips label={t("Metal")} value={f.metal} onChange={(v) => setF({ metal: v })} options={[{ value: 'all', label: t("All") }, { value: 'gold', label: t("Gold") }, { value: 'silver', label: t("Silver") }]} />
        <Chips label={t("Visibility")} value={f.active} onChange={(v) => setF({ active: v })} options={[{ value: 'all', label: t("All") }, { value: 'active', label: t("Shown") }, { value: 'hidden', label: t("Hidden") }]} />
      </div>
      {error && <ErrorBox message={errorText(error)} onRetry={reload} />}
      {loading && !data ? <Loading /> : data?.results.length === 0 ? (
        <Empty title={t("No products yet")}>{t("Add your rings, chains and bangles once. Then order and bill forms fill in the weight and making charge for you.")}</Empty>
      ) : (
        <div className="prod-grid" style={{ opacity: loading ? 0.6 : 1 }}>
          {data?.results.map((p) => (
            <article key={p.catalogId} className={`prod-card ${p.isActive ? '' : 'off'}`}>
              <button className="prod-img" onClick={() => setEditing(p)} aria-label={t("Edit {p.name}", { "p.name": p.name })}>
                {p.image ? <img src={p.image} alt={p.name} loading="lazy" /> : <Icon name="camera" size={30} />}
              </button>
              <div className="prod-body">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3>{p.name}</h3><Metal type={p.metal} />
                </div>
                <div className="cell-sub">
                  {[p.netWeight != null && lal(p.netWeight), p.makingCharge != null && t('making {amount}', { amount: money(p.makingCharge) }), p.gemsName].filter(Boolean).join(' · ') || t("No defaults set")}
                </div>
                <div className="cell-sub">{t("Ordered")} {p.orderedCount}{t("× · Sold")} {p.soldCount}×{p.isActive ? '' : t(" · Hidden")}</div>
                <div className="row" style={{ gap: 4, marginTop: 6 }}>
                  <button className="icon-btn" onClick={() => setEditing(p)} aria-label={t("Edit")} title={t("Edit")}><Icon name="edit" /></button>
                  <button className="icon-btn" onClick={() => remove(p)} aria-label={t("Delete")} title={t("Delete")}><Icon name="trash" /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <Pager page={data?.page} totalPages={data?.totalPages} onPage={(p) => setF({ page: String(p) })} />
      {editing && <ProductModal product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}
