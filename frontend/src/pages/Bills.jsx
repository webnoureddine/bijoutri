import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorText, get } from '../api';
import { useListParams } from '../components/useListParams';
import { fmtDate, money } from '../format';
import { t, tn } from '../i18n';
import { Badge, Chips, Empty, ErrorBox, Icon, Loading, PageHeader, Pager, Panel, SearchBox, useDebounced, useFetch } from '../ui.jsx';

const DEFAULTS = { show: 'all', q: '', from: '', to: '', page: '1' };

export default function Bills() {
  const navigate = useNavigate();
  const defaults = useMemo(() => DEFAULTS, []);
  const [f, setF] = useListParams(defaults);
  const [text, setText] = useState(f.q);
  const q = useDebounced(text);
  const params = {
    q, page: f.page, date_from: f.from, date_to: f.to,
    status: f.show === 'draft' ? 'draft' : f.show === 'all' ? 'all' : 'submitted',
    payment: f.show === 'due' || f.show === 'paid' ? f.show : 'all',
  };
  const { data, loading, error, reload } = useFetch(() => get('bills/', params), [q, f.show, f.page, f.from, f.to]);

  return (
    <>
      <PageHeader title={t('Sales')} subtitle={t('Every bill, who paid and who still owes')} actions={<Link className="btn btn-gold" to="/sell"><Icon name="cart" size={18} />{t('New sale')}</Link>} />
      <div className="toolbar">
        <Chips label={t('Show')} value={f.show} onChange={(v) => setF({ show: v })} options={[
          { value: 'all', label: t('All') }, { value: 'due', label: t('Unpaid') }, { value: 'paid', label: t('Paid') }, { value: 'draft', label: t('Drafts') }]} />
        <SearchBox value={text} onChange={(v) => { setText(v); setF({ q: v }); }} placeholder={t('Customer, phone, piece or number')} />
        <label className="row small" style={{ gap: 6 }}>{t('From')} <input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} style={{ width: 160 }} /></label>
        <label className="row small" style={{ gap: 6 }}>{t('To')} <input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} style={{ width: 160 }} /></label>
      </div>
      {error && <ErrorBox message={errorText(error)} onRetry={reload} />}
      <Panel flush>
        {loading && !data ? <Loading /> : data?.results.length === 0 ? (
          <Empty icon="bills" title={t('No sales found')} action={<Link className="btn btn-gold" to="/sell">{t('New sale')}</Link>}>{t('Change the filters or make a new sale.')}</Empty>
        ) : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="table">
              <thead><tr><th>{t('Sale')}</th><th>{t('Customer')}</th><th className="hide-sm">{t('Pieces')}</th><th className="right">{t('Total')}</th><th className="right">{t('Still to pay')}</th><th>{t('Status')}</th></tr></thead>
              <tbody>
                {data?.results.map((b) => (
                  <tr key={b.billId} className="click" onClick={() => navigate(`/bills/${b.billId}`)}>
                    <td><span className="cell-main">#{b.billId}</span><div className="cell-sub">{fmtDate(b.date)}</div></td>
                    <td><span className="cell-main">{b.customer?.name || t('Walk-in customer')}</span><div className="cell-sub">{b.customer?.phone}{b.createdBy ? ` · ${t('by {name}', { name: b.createdBy.name })}` : ''}</div></td>
                    <td className="hide-sm">{tn(b.itemCount, 'piece', 'pieces')}</td>
                    <td className="right num">{money(b.grandTotal)}</td>
                    <td className="right num">{b.status === 'submitted' && b.remainingAmount > 0.005 ? <b>{money(b.remainingAmount)}</b> : <span className="cell-sub">—</span>}</td>
                    <td>{b.status === 'draft' ? <Badge kind="draft" /> : <Badge kind={b.paymentStatus} />}</td>
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
