import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, errorText, get, post, upload } from '../api';
import { useAuth } from '../auth.jsx';
import { GiveWorkModal } from '../components/WorkModals.jsx';
import { dueLabel, fmtDate, money, plain, priceBasis, weight, whatsapp } from '../format';
import { t } from '../i18n';
import { useShop } from '../shop.jsx';
import { Badge, Empty, ErrorBox, Icon, Loading, Modal, PageHeader, Panel, useFetch, useUi } from '../ui.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ui = useUi();
  const { isOwner } = useAuth();
  const { settings } = useShop();
  const { data: o, loading, error, reload } = useFetch(() => get(`orders/${id}/`), [id]);
  const [give, setGive] = useState(null);
  const [photo, setPhoto] = useState(null);

  if (loading && !o) return <Loading />;
  if (error && !o) return <ErrorBox message={errorText(error)} onRetry={reload} />;
  const STEPS = [['pending', t('Taken')], ['inprogress', t('At the workshop')], ['completed', t('Ready')], ['submitted', t('Delivered')]];
  const idx = STEPS.findIndex(([k]) => k === o.status);
  const bill = o.bills.find((b) => b.status === 'submitted');
  const hasPending = o.items.some((i) => i.status === 'pending');

  const remove = async () => {
    if (!(await ui.confirm({ title: t('Delete order #{id}?', { id: o.orderId }), message: t('The order is removed for good.'), confirmLabel: t('Delete'), danger: true }))) return;
    try { await del(`orders/${o.orderId}/`); ui.success(t('Order deleted.')); navigate('/orders'); } catch (e) { ui.error(errorText(e)); }
  };
  const delivered = async () => {
    if (!(await ui.confirm({ title: t('Mark as delivered without a bill?'), message: t('Use this only if the customer took the piece and you will not make a bill.'), confirmLabel: t('Mark delivered') }))) return;
    try { await post(`orders/${o.orderId}/status/`, { status: 'submitted' }); reload(); } catch (e) { ui.error(errorText(e)); }
  };
  const sendPhoto = async (itemId, file) => {
    if (!file) return;
    try { await upload(`order-items/${itemId}/design/`, 'design', file); ui.success(t('Photo saved.')); reload(); } catch (e) { ui.error(errorText(e)); }
  };
  const readyText = t('Hello {name}, your order #{id} is ready at {shop}. You can come and collect it. Thank you!', { name: o.customer.name, id: o.orderId, shop: settings?.shopName });

  return (
    <>
      <PageHeader back={<Link className="back" to="/orders"><Icon name="chevron" size={14} />{t('Orders')}</Link>}
        title={`${o.customer.name} · #${o.orderId}`}
        subtitle={<span className="row"><Badge kind={o.status} />{o.gradeName && <span>{o.gradeName}</span>}{o.isOverdue && <span className="late">{dueLabel(o.dueDate)}</span>}</span>}
        actions={<>
          {bill ? <Link className="btn btn-primary" to={`/bills/${bill.billId}`}>{t('See bill #{id}', { id: bill.billId })}</Link>
            : o.status !== 'submitted' && <Link className="btn btn-gold" to={`/sell?order=${o.orderId}`}><Icon name="bills" size={18} />{t('Make the bill')}</Link>}
          {o.status === 'completed' && o.customer.phone && <a className="btn" href={whatsapp(o.customer.phone, readyText)} target="_blank" rel="noreferrer"><Icon name="chat" size={18} />{t('Tell the customer')}</a>}
          {o.status !== 'submitted' && <Link className="btn" to={`/orders/${o.orderId}/edit`}><Icon name="edit" size={18} />{t('Change')}</Link>}
          {o.status !== 'submitted' && !bill && <button className="btn" onClick={delivered}>{t('Mark delivered')}</button>}
          {isOwner && o.status === 'pending' && <button className="btn" onClick={remove}><Icon name="trash" size={18} />{t('Delete')}</button>}
        </>} />

      <div className="steps" style={{ marginBottom: 18 }}>
        {STEPS.map(([k, label], i) => <div key={k} className={`step ${i < idx ? 'done' : i === idx ? 'now' : ''}`}>{i < idx ? '✓ ' : ''}{label}</div>)}
      </div>

      <Panel title={t('Pieces')} flush action={hasPending && <button className="btn btn-small btn-primary" onClick={() => setGive({})}><Icon name="tool" size={16} />{t('Give to a craftsman')}</button>}>
        {o.items.length === 0 ? <Empty title={t('No pieces')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Piece')}</th><th>{t('Weight')}</th><th>{t('Design photo')}</th><th>{t('Craftsman')}</th><th /></tr></thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.orderItemId}>
                    <td><span className="cell-main">{i.name}{i.quantity > 1 ? ` ×${plain(i.quantity)}` : ''}</span>{i.gemsName && <div className="cell-sub">{i.gemsName}</div>}</td>
                    <td className="num">{weight(i.netWeight)}</td>
                    <td>{i.design ? (
                      <button className="thumb" style={{ padding: 0, cursor: 'pointer' }} onClick={() => setPhoto(i.design)}><img src={i.design} alt="" /></button>
                    ) : (
                      <label className="btn btn-small" style={{ cursor: 'pointer' }}><Icon name="camera" size={16} />{t('Add')}<input type="file" accept="image/*" hidden onChange={(e) => sendPhoto(i.orderItemId, e.target.files[0])} /></label>
                    )}</td>
                    <td>{i.work ? (<><Link to={`/craftsmen/${i.work.staffId}`}>{i.work.staffName}</Link><div className="cell-sub">{i.work.status === 'completed' ? t('Received') : t('Back by {date}', { date: fmtDate(i.work.dueDate, false) })}</div></>) : <Badge kind="pending" />}</td>
                    <td className="right">{i.status === 'pending' && <button className="btn btn-small" onClick={() => setGive({ orderItemId: i.orderItemId })}>{t('Give')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <Panel title={t('Customer')} action={<Link to={`/customers/${o.customer.customerId}`}>{t('Open')}</Link>}>
          <dl className="kv">
            <dt>{t('Name')}</dt><dd>{o.customer.name}</dd>
            <dt>{t('Phone')}</dt><dd>{o.customer.phone || '—'}</dd>
            <dt>{t('Address')}</dt><dd>{o.customer.address || '—'}</dd>
          </dl>
        </Panel>
        <Panel title={t('Agreement')}>
          <dl className="kv">
            <dt>{t('Taken on')}</dt><dd>{fmtDate(o.date)}{o.createdBy ? ` · ${o.createdBy.name}` : ''}</dd>
            <dt>{t('Promised for')}</dt><dd>{fmtDate(o.dueDate)} {o.status !== 'submitted' && <span className={o.isOverdue ? 'late' : 'muted'}>· {dueLabel(o.dueDate)}</span>}</dd>
            {o.deliveredDate && <><dt>{t('Delivered')}</dt><dd>{fmtDate(o.deliveredDate)}</dd></>}
            <dt>{t('Price')}</dt><dd>{o.rate ? `${money(o.rate)} ${priceBasis()}` : '—'}</dd>
            <dt>{t('Advance paid')}</dt><dd>{money(o.advanceAmount ?? 0)}</dd>
            <dt>{t('Old gold given')}</dt><dd>{o.customerMetalWeight ? weight(o.customerMetalWeight) : '—'}</dd>
            <dt>{t('Notes')}</dt><dd>{o.remark || '—'}</dd>
          </dl>
        </Panel>
      </div>

      {give && <GiveWorkModal orderId={o.orderId} orderItemId={give.orderItemId} onClose={() => setGive(null)} onDone={() => { setGive(null); reload(); }} />}
      {photo && <Modal title={t('Design photo')} onClose={() => setPhoto(null)} wide><div className="lightbox"><img src={photo} alt="" /></div></Modal>}
    </>
  );
}
