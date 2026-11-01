import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorText, get } from '../api';
import { useListParams } from '../components/useListParams';
import { dueLabel, fmtDate } from '../format';
import { t } from '../i18n';
import { Badge, Chips, Empty, ErrorBox, Icon, Loading, PageHeader, Pager, Panel, SearchBox, useDebounced, useFetch } from '../ui.jsx';

const DEFAULTS = { status: 'active', due: '', q: '', page: '1' };

export default function Orders() {
  const navigate = useNavigate();
  const defaults = useMemo(() => DEFAULTS, []);
  const [f, setF] = useListParams(defaults);
  const [text, setText] = useState(f.q);
  const q = useDebounced(text);
  const { data, loading, error, reload } = useFetch(() => get('orders/', { status: f.status, due: f.due, q, page: f.page }), [f.status, f.due, q, f.page]);

  return (
    <>
      <PageHeader title={t('Orders')} subtitle={t('Pieces made to measure for your customers')} actions={<Link className="btn btn-primary" to="/orders/new"><Icon name="plus" size={18} />{t('New order')}</Link>} />
      <div className="toolbar">
        <Chips label={t('Status')} value={f.due ? 'late' : f.status} onChange={(v) => (v === 'late' ? setF({ due: 'overdue', status: 'active' }) : setF({ status: v, due: '' }))} options={[
          { value: 'active', label: t('Open') }, { value: 'late', label: t('Late') }, { value: 'pending', label: t('Not started') },
          { value: 'inprogress', label: t('At the workshop') }, { value: 'completed', label: t('Ready') }, { value: 'submitted', label: t('Delivered') }, { value: 'all', label: t('All') }]} />
        <SearchBox value={text} onChange={(v) => { setText(v); setF({ q: v }); }} placeholder={t('Customer, phone or number')} />
      </div>
      {error && <ErrorBox message={errorText(error)} onRetry={reload} />}
      <Panel flush>
        {loading && !data ? <Loading /> : data?.results.length === 0 ? (
          <Empty icon="orders" title={t('No orders here')} action={<Link className="btn btn-primary" to="/orders/new">{t('New order')}</Link>}>{t('Change the filters or take a new order.')}</Empty>
        ) : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="table">
              <thead><tr><th>{t('Customer')}</th><th className="hide-sm">{t('Pieces')}</th><th>{t('Promised for')}</th><th>{t('Status')}</th><th className="hide-sm">{t('Bill')}</th></tr></thead>
              <tbody>
                {data?.results.map((o) => (
                  <tr key={o.orderId} className="click" onClick={() => navigate(`/orders/${o.orderId}`)}>
                    <td><span className="cell-main">{o.customer?.name}</span><div className="cell-sub">#{o.orderId} · {fmtDate(o.date, false)}{o.customer?.phone ? ` · ${o.customer.phone}` : ''}</div></td>
                    <td className="hide-sm">{o.itemCount}{o.gradeName ? <div className="cell-sub">{o.gradeName}</div> : null}</td>
                    <td>{o.status === 'submitted' ? <span className="cell-sub">{t('Delivered')} {fmtDate(o.deliveredDate, false)}</span> : (
                      <><span className="cell-main">{fmtDate(o.dueDate)}</span><div className={o.isOverdue ? 'late small' : 'cell-sub'}>{dueLabel(o.dueDate)}</div></>
                    )}</td>
                    <td><Badge kind={o.status} /></td>
                    <td className="hide-sm" onClick={(e) => e.stopPropagation()}>{o.billId ? <Link to={`/bills/${o.billId}`}>#{o.billId}</Link> : <span className="cell-sub">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={data?.page} totalPages={data?.totalPages} onPage={(p) => setF({ page: String(p) })} />
      </Panel>
    </>
  );
}
