import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errorText, get } from '../api';
import { useAuth } from '../auth.jsx';
import { useRates } from '../rates.jsx';
import { Badge, ErrorBox, Icon, Loading, Metal, PageHeader, Panel, useFetch } from '../ui.jsx';
import { dueLabel, fmtDate, money, plain } from '../format';
import { numberLocale, t } from '../i18n';

export default function Today() {
  const { user } = useAuth();
  const { isToday, loading: rateLoading } = useRates();
  const summary = useFetch(() => get('dashboard/summary/'), []);
  const sales = useFetch(() => get('sales/report/'), []);
  const items = useFetch(() => get('bill-product/monthly/report/'), []);

  const name = user?.first_name || user?.full_name?.split(' ')[0] || '';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');

  if (summary.loading) return <Loading />;
  if (summary.error) return <ErrorBox message={errorText(summary.error)} onRetry={summary.reload} />;
  const d = summary.data;
  const maxItem = Math.max(1, ...(items.data?.items || []).map((i) => i.count));

  return (
    <>
      <PageHeader title={`${greeting}${name ? `, ${name}` : ''}`} subtitle={new Date().toLocaleDateString(numberLocale, { weekday: 'long', day: 'numeric', month: 'long' })} actions={
        <>
          <Link className="btn" to="/bills/new"><Icon name="bills" size={16} />{t("New bill")}</Link>
          <Link className="btn btn-primary" to="/orders/new"><Icon name="plus" size={16} />{t("New order")}</Link>
        </>
      } />

      {!rateLoading && !isToday && (
        <div className="banner">
          <Icon name="alert" />
          <span><strong>{t("Today's rates are not set.")} set.</strong> {t("Bills and orders use the last saved rate until you update them.")}</span>
          <Link className="btn btn-small" to="/rates">{t("Set rates")}</Link>
        </div>
      )}

      <div className="stats">
        <Link to="/orders?due=overdue" className={`stat ${d.counts.overdue ? 'alert' : ''}`}>
          <div className="stat-label">{t("Late orders")}</div>
          <div className="stat-value">{d.counts.overdue}</div>
          <div className="stat-sub">{d.counts.overdue ? t("Past the promised date") : t("Nothing is late")}</div>
        </Link>
        <Link to="/orders?status=completed" className="stat">
          <div className="stat-label">{t("Ready for pickup")}</div>
          <div className="stat-value">{d.counts.ready}</div>
          <div className="stat-sub">{t("Finished, not yet delivered")}</div>
        </Link>
        <Link to="/orders?status=inprogress" className="stat">
          <div className="stat-label">{t("With craftsmen")}</div>
          <div className="stat-value">{d.counts.inprogress}</div>
          <div className="stat-sub">{d.counts.pending} {t("not started")}</div>
        </Link>
        <Link to="/bills?show=due" className="stat">
          <div className="stat-label">{t("Unpaid bills")}</div>
          <div className="stat-value">{d.counts.dueBills}</div>
          <div className="stat-sub">{money(d.money.due)} {t("to collect")}</div>
        </Link>
      </div>

      <div className="grid-2">
        <Panel title={t("Needs attention")} flush action={<Link to="/orders?status=active">{t("All open orders")}</Link>}>
          {d.attention.length === 0 ? (
            <div className="empty"><strong>{t("All clear")}</strong><p>{t("No open order is late or due in the next 7 days.")}</p></div>
          ) : (
            <div className="list">
              {d.attention.map((o) => (
                <Link key={o.orderId} to={`/orders/${o.orderId}`} className="list-item">
                  <div className="grow">
                    <div className="cell-main">#{o.orderId} · {o.customer?.name}</div>
                    <div className="cell-sub"><Metal type={o.type} /> · {o.itemCount} {t(o.itemCount === 1 ? 'item' : 'items')}</div>
                  </div>
                  <div className="right">
                    <div className={o.isOverdue ? 'late' : 'cell-main'}>{dueLabel(o.submittionDate)}</div>
                    <Badge kind={o.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={t("Recent bills")} flush action={<Link to="/bills">{t("All bills")}</Link>}>
          {d.recentBills.length === 0 ? (
            <div className="empty"><strong>{t("No bills yet")}</strong><p>{t("Bills you make will show here.")}</p></div>
          ) : (
            <div className="list">
              {d.recentBills.map((b) => (
                <Link key={b.billId} to={`/bills/${b.billId}`} className="list-item">
                  <div className="grow">
                    <div className="cell-main">#{b.billId} · {b.customer?.name}</div>
                    <div className="cell-sub">{fmtDate(b.date)}</div>
                  </div>
                  <div className="right">
                    <div className="cell-main num">{money(b.grandTotalAmount)}</div>
                    {b.status === 'draft' ? <Badge kind="draft" /> : <Badge kind={b.paymentStatus} />}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <Panel title={`${t('Sales')} · ${new Date().toLocaleDateString(numberLocale, { month: 'long', year: 'numeric' })}`}>
          <div className="money-row" style={{ marginBottom: 18 }}>
            <div><b>{money(d.money.today)}</b><span>{t("Billed today")}</span></div>
            <div><b>{money(d.money.month)}</b><span>{t("Billed this month")}</span></div>
            <div><b>{money(d.money.due)}</b><span>{t("Still unpaid")}</span></div>
          </div>
          {sales.data?.weeks?.length ? (
            <div style={{ height: 230 }}>
              <ResponsiveContainer>
                <BarChart data={sales.data.weeks} margin={{ left: -10, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="#e0e4ea" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => (v >= 100000 ? `${v / 100000}L` : v >= 1000 ? `${v / 1000}k` : v)} />
                  <Tooltip formatter={(v) => money(v)} cursor={{ fill: '#f2f4f6' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="paid" name="Collected" stackId="a" fill="#0f5c4d" />
                  <Bar dataKey="due" name="Unpaid" stackId="a" fill="#e0a43a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="muted-text">{t("No bills this month yet.")}</p>
          )}
        </Panel>

        <Panel title={t("Most sold items this month")}>
          {items.data?.items?.length ? (
            <div className="bars">
              {items.data.items.map((i) => (
                <div className="bar-row" key={i.name}>
                  <span title={i.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(i.count / maxItem) * 100}%` }} /></div>
                  <b className="num">{plain(i.count)}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">{t("Items from submitted bills will be ranked here.")}</p>
          )}
          <div style={{ marginTop: 18 }} className="small muted-text">
            {t("This month vs last:")} <b>{d.increment.bill.total}</b> {t("bills (")}{d.increment.bill.change == null ? t("no earlier month to compare") : `${d.increment.bill.change > 0 ? '+' : ''}${d.increment.bill.change}%`}), <b>{d.increment.order.total}</b> {t("orders.")}
          </div>
        </Panel>
      </div>
    </>
  );
}
