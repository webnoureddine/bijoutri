import { useEffect, useMemo, useState } from 'react';
import { errorText, get, patch, post } from '../api';
import { fmtDate, isoDate, num, unit, weight } from '../format';
import { t, tn } from '../i18n';
import { Field, Loading, Modal, NumberInput, useUi } from '../ui.jsx';

// Give one order item to a craftsman (or change work that is still with them: pass `work`).
export function GiveWorkModal({ orderId: presetOrder, orderItemId: presetItem, work, onClose, onDone }) {
  const ui = useUi();
  const [orders, setOrders] = useState([]);
  const [staff, setStaff] = useState([]);
  const [orderId, setOrderId] = useState(presetOrder ? String(presetOrder) : '');
  const [detail, setDetail] = useState(null);
  const [itemId, setItemId] = useState(presetItem ? String(presetItem) : '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(work ? { staff: String(work.staff.staffId), date: work.date, givenWeight: work.givenWeight, addedWeight: work.addedWeight || '', dueDate: work.dueDate || '', wage: work.wage ?? '' }
    : { staff: '', date: isoDate(), givenWeight: '', addedWeight: '', dueDate: '', wage: '' });
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    let alive = true;
    Promise.all([get('staff/', { active: 1 }), presetOrder || work ? Promise.resolve(null) : get('orders/', { status: 'active', page_size: 200 })])
      .then(([s, o]) => {
        if (!alive) return;
        setStaff(s);
        if (o) setOrders(o.results.filter((x) => x.status === 'pending' || x.status === 'inprogress'));
      })
      .catch((e) => ui.error(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (work || !orderId) { setDetail(null); return undefined; }
    let alive = true;
    get(`orders/${orderId}/pending-items/`).then((d) => {
      if (!alive) return;
      setDetail(d);
      const chosen = d.items.find((i) => i.orderItemId === Number(presetItem)) || d.items[0];
      setItemId(chosen ? String(chosen.orderItemId) : '');
      set({ givenWeight: chosen?.netWeight ?? '', dueDate: d.dueDate || '' });
    }).catch((e) => ui.error(errorText(e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const chooseItem = (v) => {
    setItemId(v);
    set({ givenWeight: detail?.items.find((i) => String(i.orderItemId) === v)?.netWeight ?? '' });
  };
  const ok = (work || itemId) && form.staff && num(form.givenWeight) > 0;
  const n = (v) => (v === '' || v == null ? null : Number(v));

  const submit = async () => {
    setBusy(true);
    const body = { staff: Number(form.staff), orderItem: work ? undefined : Number(itemId), date: form.date, givenWeight: num(form.givenWeight), addedWeight: num(form.addedWeight), dueDate: form.dueDate || null, wage: n(form.wage) };
    try {
      if (work) await patch(`work/${work.staffWorkId}/`, body);
      else await post('work/', body);
      ui.success(work ? t('Saved.') : t('Work given to the craftsman.'));
      onDone?.();
    } catch (e) {
      ui.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={work ? t('Change work') : t('Give work to a craftsman')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={submit} disabled={!ok || busy}>{busy ? t('Saving…') : work ? t('Save') : t('Give work')}</button></>}>
      {loading ? <Loading /> : (
        <>
          {!presetOrder && !work && (
            <Field label={t('Order')}>
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">{t('Choose an order…')}</option>
                {orders.map((o) => <option key={o.orderId} value={o.orderId}>#{o.orderId} · {o.customer?.name} · {tn(o.itemCount, 'item', 'items')} · {fmtDate(o.dueDate, false)}</option>)}
              </select>
            </Field>
          )}
          {work && <p className="muted" style={{ margin: 0 }}>{t('Order #{id}', { id: work.orderId })} · {work.item.name}</p>}
          {detail && detail.items.length === 0 && <p className="muted">{t('Every item of this order is already with a craftsman.')}</p>}
          {(work || (detail && detail.items.length > 0)) && (
            <>
              {!work && (
                <Field label={t('Item')}>
                  <select value={itemId} onChange={(e) => chooseItem(e.target.value)}>
                    {detail.items.map((i) => <option key={i.orderItemId} value={i.orderItemId}>{i.name}{i.netWeight ? ` · ${weight(i.netWeight)}` : ''}</option>)}
                  </select>
                </Field>
              )}
              <Field label={t('Craftsman')}>
                <select value={form.staff} onChange={(e) => set({ staff: e.target.value })}>
                  <option value="">{t('Choose…')}</option>
                  {staff.map((s) => <option key={s.staffId} value={s.staffId}>{s.staffName}{s.inprogress ? ` (${t('{n} in progress', { n: s.inprogress })})` : ''}</option>)}
                </select>
              </Field>
              <div className="form-grid">
                <Field label={t('Metal given ({u})', { u: unit() })}><NumberInput value={form.givenWeight} onChange={(v) => set({ givenWeight: v })} /></Field>
                <Field label={t('Added metal ({u})', { u: unit() })} hint={t('Solder, alloy… added on top')}><NumberInput value={form.addedWeight} onChange={(v) => set({ addedWeight: v })} /></Field>
                <Field label={t('Given on')}><input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>
                <Field label={t('Back by')}><input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
                <Field label={t('Craftsman fee')} hint={t('optional')}><NumberInput value={form.wage} onChange={(v) => set({ wage: v })} /></Field>
              </div>
              <div className="balance ok"><span>{t('Total handed over')}</span><b>{weight(num(form.givenWeight) + num(form.addedWeight))}</b></div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

// The craftsman brings the piece back: weigh it; the loss is worked out.
export function ReceiveWorkModal({ work, onClose, onDone }) {
  const ui = useUi();
  const [w, setW] = useState('');
  const [loss, setLoss] = useState('');
  const [lossTouched, setLossTouched] = useState(false);
  const [date, setDate] = useState(isoDate());
  const [wage, setWage] = useState(work.wage ?? '');
  const [busy, setBusy] = useState(false);
  const autoLoss = useMemo(() => Math.max(Math.round((work.totalWeight - num(w)) * 1000) / 1000, 0), [work.totalWeight, w]);
  const shownLoss = lossTouched ? loss : w === '' ? '' : autoLoss;

  const submit = async () => {
    setBusy(true);
    try {
      await post(`work/${work.staffWorkId}/receive/`, { returnedWeight: num(w), lossWeight: shownLoss === '' ? null : num(shownLoss), returnedDate: date, wage: wage === '' ? null : num(wage) });
      ui.success(t('Piece received.'));
      onDone?.();
    } catch (e) {
      ui.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={t('Receive the finished piece')} small onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={submit} disabled={w === '' || busy}>{busy ? t('Saving…') : t('Mark as received')}</button></>}>
      <div className="muted small">{work.staff.staffName} · {t('Order #{id}', { id: work.orderId })} · {work.item.name}<br />
        {t('Handed over {total} ({given} + {added} added)', { total: weight(work.totalWeight), given: weight(work.givenWeight), added: weight(work.addedWeight) })}</div>
      <Field label={t('Weight brought back ({u})', { u: unit() })}><NumberInput value={w} onChange={setW} autoFocus /></Field>
      <Field label={t('Loss ({u})', { u: unit() })} hint={t('Worked out from the weights. Change it if needed.')}><NumberInput value={shownLoss} onChange={(v) => { setLossTouched(true); setLoss(v); }} /></Field>
      <Field label={t('Received on')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t('Craftsman fee')}><NumberInput value={wage} onChange={setWage} /></Field>
    </Modal>
  );
}
