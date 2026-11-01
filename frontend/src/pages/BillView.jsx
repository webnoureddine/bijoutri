import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { del, errorText, get, post } from '../api';
import { useAuth } from '../auth.jsx';
import { fmtDate, money, num, plain, priceBasis, weight, whatsapp } from '../format';
import { t } from '../i18n';
import { METHODS, methodLabel, useShop } from '../shop.jsx';
import { Badge, ErrorBox, Field, Icon, Loading, Modal, NumberInput, PageHeader, useFetch, useUi } from '../ui.jsx';

const MAKING_SHORT = { perWeight: '/u', fixed: '', percent: '%' };

export default function BillView() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const ui = useUi();
  const { isOwner } = useAuth();
  const { settings } = useShop();
  const { data: b, loading, error, reload } = useFetch(() => get(`bills/${id}/`), [id]);
  const [paying, setPaying] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'cash' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (b && params.get('print') === '1') {
      setParams({}, { replace: true });
      setTimeout(() => window.print(), 400);
    }
  }, [b, params, setParams]);

  if (loading && !b) return <Loading />;
  if (error && !b) return <ErrorBox message={errorText(error)} onRetry={reload} />;

  const due = b.remainingAmount > 0.005;
  const remove = async () => {
    if (!(await ui.confirm({ title: t('Delete sale #{id}?', { id: b.billId }), message: t('The pieces go back into stock.'), confirmLabel: t('Delete'), danger: true }))) return;
    try { await del(`bills/${b.billId}/`); ui.success(t('Sale deleted.')); navigate('/bills'); } catch (e) { ui.error(errorText(e)); }
  };
  const savePayment = async () => {
    setBusy(true);
    try { await post(`bills/${b.billId}/payments/`, { amount: num(pay.amount), method: pay.method }); ui.success(t('Payment recorded.')); setPaying(false); reload(); } catch (e) { ui.error(errorText(e)); }
    setBusy(false);
  };
  const removePayment = async (p) => {
    if (!(await ui.confirm({ title: t('Delete this payment?'), message: money(p.amount), confirmLabel: t('Delete'), danger: true }))) return;
    try { await del(`bill-payments/${p.paymentId}/`); reload(); } catch (e) { ui.error(errorText(e)); }
  };
  const message = due
    ? t('Hello {name}, here is your bill #{id} from {shop}: total {total}, still to pay {due}. Thank you!', { name: b.customer?.name || '', id: b.billId, shop: settings?.shopName, total: money(b.grandTotal), due: money(b.remainingAmount) })
    : t('Hello {name}, thank you for your purchase at {shop}. Bill #{id}: {total}, fully paid.', { name: b.customer?.name || '', id: b.billId, shop: settings?.shopName, total: money(b.grandTotal) });
  const canEdit = isOwner || b.status === 'draft';

  return (
    <>
      <PageHeader
        back={<Link className="back" to="/bills"><Icon name="chevron" size={14} />{t('Sales')}</Link>}
        title={t('Sale #{id}', { id: b.billId })}
        subtitle={<span className="row">{b.status === 'draft' ? <Badge kind="draft" /> : <Badge kind={b.paymentStatus} />}{b.orderId && <Link to={`/orders/${b.orderId}`}>{t('Order #{id}', { id: b.orderId })}</Link>}{b.createdBy && <span className="muted small">{t('by {name}', { name: b.createdBy.name })}</span>}</span>}
        actions={<>
          {due && b.status === 'submitted' && <button className="btn btn-gold" onClick={() => { setPay({ amount: b.remainingAmount, method: 'cash' }); setPaying(true); }}><Icon name="coins" size={18} />{t('Collect a payment')}</button>}
          <button className="btn btn-primary" onClick={() => window.print()}><Icon name="print" size={18} />{t('Print')}</button>
          {b.customer?.phone && <a className="btn" href={whatsapp(b.customer.phone, message)} target="_blank" rel="noreferrer"><Icon name="chat" size={18} />WhatsApp</a>}
          {canEdit && <Link className="btn" to={`/bills/${b.billId}/edit`}><Icon name="edit" size={18} />{t('Change')}</Link>}
          {isOwner && <button className="btn" onClick={remove}><Icon name="trash" size={18} />{t('Delete')}</button>}
        </>}
      />

      <article className="invoice">
        <div className="inv-head">
          <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
            {settings?.logo && <img className="inv-logo" src={settings.logo} alt="" />}
            <div>
              <div className="inv-shop">{settings?.shopName}</div>
              {settings?.address && <div>{settings.address}</div>}
              {settings?.phone && <div>{t('Tel.')} {settings.phone}</div>}
              <div className="inv-ids">
                {settings?.rc && <span>RC {settings.rc}</span>}{settings?.nif && <span>NIF {settings.nif}</span>}
                {settings?.nis && <span>NIS {settings.nis}</span>}{settings?.ai && <span>AI {settings.ai}</span>}
              </div>
            </div>
          </div>
          <div className="inv-meta">
            <div className="muted">{b.status === 'draft' ? t('Draft') : t('Invoice')}</div>
            <b>N° {b.billId}</b>
            <div>{fmtDate(b.date)}</div>
            {b.status === 'submitted' && <span className={`stamp ${due ? 'due' : 'paid'}`}>{due ? t('STILL TO PAY') : t('PAID')}</span>}
          </div>
        </div>
        <div className="inv-cols">
          <div>
            <div className="muted small">{t('Customer')}</div>
            <div className="cell-main">{b.customer?.name || t('Walk-in customer')}</div>
            {b.customer?.address && <div>{b.customer.address}</div>}
            {b.customer?.phone && <div>{b.customer.phone}</div>}
          </div>
          <div>
            <div className="muted small">{t('Total weight')}</div>
            <div className="cell-main">{weight(b.finalWeight)}</div>
            <div className="muted small">{t('Prices {basis}', { basis: priceBasis() })}</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Piece')}</th><th className="right">{t('Weight')}</th><th className="right">{t('Price')}</th><th className="right">{t('Making')}</th><th className="right">{t('Amount')}</th></tr></thead>
            <tbody>
              {b.lines.map((l) => (
                <tr key={l.lineId}>
                  <td>
                    <div className="cell-flex">
                      {l.photo && <span className="thumb no-print-hide"><img src={l.photo} alt="" /></span>}
                      <div><span className="cell-main">{l.name}{l.quantity > 1 ? ` ×${plain(l.quantity)}` : ''}</span>
                        <div className="cell-sub">{[l.code, l.gradeName, l.gemsName && `${l.gemsName}${l.gemsPrice ? ` ${money(l.gemsPrice)}` : ''}`, l.size && `${t('Size')} ${l.size}`].filter(Boolean).join(' · ')}</div></div>
                    </div>
                  </td>
                  <td className="right num">{weight(l.totalWeight)}{l.lossWeight > 0 && <div className="cell-sub">{t('incl. loss {w}', { w: weight(l.lossWeight) })}</div>}</td>
                  <td className="right num">{plain(l.rate)}</td>
                  <td className="right num">{money(l.makingAmount)}{l.makingMode === 'percent' && <div className="cell-sub">{plain(l.makingCharge)}{MAKING_SHORT.percent}</div>}</td>
                  <td className="right num"><b>{money(l.amount)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="inv-bottom">
          {b.qr_code ? <img className="inv-qr" src={b.qr_code} alt="" /> : <span />}
          <div className="inv-totals">
            <div className="sum-row"><span>{t('Total of pieces')}</span><span className="num">{money(b.subtotal)}</span></div>
            {b.discount > 0 && <div className="sum-row"><span>{t('Discount')}</span><span className="num">− {money(b.discount)}</span></div>}
            {b.taxAmount > 0 && <div className="sum-row"><span>{settings?.taxLabel} {b.taxRate}%</span><span className="num">{money(b.taxAmount)}</span></div>}
            {b.customerMetalAmount > 0 && <div className="sum-row"><span>{t('Old gold taken back ({w} × {p})', { w: weight(b.customerMetalWeight), p: plain(b.buyRate) })}</span><span className="num">− {money(b.customerMetalAmount)}</span></div>}
            <div className="sum-row sum-total"><span>{t('To pay')}</span><b className="num">{money(b.grandTotal)}</b></div>
            {b.advanceAmount > 0 && <div className="sum-row"><span>{t('Advance')}</span><span className="num">{money(b.advanceAmount)}</span></div>}
            <div className="sum-row"><span>{t('Paid at sale')} ({methodLabel(b.payMethod)})</span><span className="num">{money(b.paidAmount)}</span></div>
            {b.payments.map((p) => (
              <div className="sum-row" key={p.paymentId}><span>{t('Paid on {date}', { date: fmtDate(p.date) })} ({methodLabel(p.method)})
                {isOwner && <button className="icon-btn no-print" onClick={() => removePayment(p)} aria-label={t('Delete')}><Icon name="trash" size={14} /></button>}</span><span className="num">{money(p.amount)}</span></div>
            ))}
            <div className="sum-row" style={{ fontWeight: 800 }}><span>{t('Still to pay')}</span><span className="num">{money(Math.max(b.remainingAmount, 0))}</span></div>
          </div>
        </div>
        {b.note && <p className="muted">{b.note}</p>}
        <div className="inv-sign"><span>{t('Customer signature')}</span><span>{t('Shop stamp')}</span></div>
        {settings?.invoiceFooter && <div className="inv-foot">{settings.invoiceFooter}</div>}
      </article>

      {paying && (
        <Modal title={t('Collect a payment')} small onClose={() => setPaying(false)} footer={<>
          <button className="btn" onClick={() => setPaying(false)}>{t('Cancel')}</button>
          <button className="btn btn-primary" disabled={!(num(pay.amount) > 0) || busy} onClick={savePayment}>{busy ? t('Saving…') : t('Save payment')}</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>{t('Still to pay on this sale:')} <b>{money(b.remainingAmount)}</b></p>
          <Field label={t('Amount received')}><NumberInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></Field>
          <Field label={t('Paid by')}><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
        </Modal>
      )}
    </>
  );
}
