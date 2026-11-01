import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errorText, get } from '../api';
import { useAuth } from '../auth.jsx';
import { dueLabel, fmtDate, money, plain, weight } from '../format';
import { locale, t, tn } from '../i18n';
import { useShop } from '../shop.jsx';
import { Badge, ErrorBox, Icon, Loading, Panel, useFetch } from '../ui.jsx';

function Action({ to, icon, title, sub, hero }) {
  return (
    <Link to={to} className={`action ${hero ? 'hero' : ''}`}>
      <span className="action-icon"><Icon name={icon} size={24} /></span>
      <strong>{title}</strong>
      <span>{sub}</span>
    </Link>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { allToday, grades } = useShop();
  const summary = useFetch(() => get('dashboard/'), []);
  const d = summary.data;
  const sales = useFetch(() => (d?.showMoney ? get('reports/sales/') : Promise.resolve(null)), [d?.showMoney]);
  const items = useFetch(() => get('reports/items/'), []);

  const name = user?.first_name || user?.full_name?.split(' ')[0] || '';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');

  if (summary.loading && !d) return <Loading />;
  if (summary.error && !d) return <ErrorBox message={errorText(summary.error)} onRetry={summary.reload} />;
  const c = d.counts;
  const maxItem = Math.max(1, ...(items.data?.items || []).map((i) => i.count));

  return (
    <>
      <div className="hello">
        <div>
          <h1>{greeting}{name ? `, ${name}` : ''}</h1>
          <div className="subtitle">{new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
      </div>

      {(!allToday || grades.every((g) => !g.rate)) && (
        <div className="banner">
          <Icon name="alert" />
          <span className="grow"><b>{t("Today's prices are not set yet.")}</b> {t('Sales use the last saved prices until you update them.')}</span>
          <Link className="btn btn-small btn-gold" to="/rates">{t("Set today's prices")}</Link>
        </div>
      )}

      <div className="actions-grid">
        <Action hero to="/sell" icon="cart" title={t('Sell')} sub={t('Pick pieces from stock and print the bill')} />
        <Action to="/orders/new" icon="orders" title={t('New order')} sub={t('A piece to make for a customer')} />
        <Action to="/stock?new=1" icon="gem" title={t('Add to stock')} sub={t('New jewellery with its photo')} />
        <Action to="/bills?show=due" icon="coins" title={t('Collect a payment')} sub={t('A customer pays what they owe')} />
      </div>

      <div className="stats">
        <Link to="/orders?due=overdue" className={`stat ${c.overdue ? 'alert' : ''}`}>
          <div className="stat-label"><Icon name="clock" size={16} />{t('Late orders')}</div>
          <div className="stat-value">{c.overdue}</div>
          <div className="stat-sub">{c.overdue ? t('Past the promised date') : t('Nothing is late')}</div>
        </Link>
        <Link to="/orders?status=completed" className="stat">
          <div className="stat-label"><Icon name="check" size={16} />{t('Ready for pickup')}</div>
          <div className="stat-value">{c.ready}</div>
          <div className="stat-sub">{t('{n} at the workshop', { n: c.inprogress })}</div>
        </Link>
        <Link to="/bills?show=due" className="stat">
          <div className="stat-label"><Icon name="coins" size={16} />{t('Unpaid sales')}</div>
          <div className="stat-value">{c.dueBills}</div>
          <div className="stat-sub">{d.money ? t('{amount} to collect', { amount: money(d.money.due) }) : t('Customers who still owe')}</div>
        </Link>
        <Link to="/stock" className="stat">
          <div className="stat-label"><Icon name="gem" size={16} />{t('In stock')}</div>
          <div className="stat-value">{c.stockPieces}</div>
          <div className="stat-sub">{weight(c.stockWeight)}</div>
        </Link>
      </div>

      <div className="grid-2">
        <Panel title={t('Needs attention')} flush action={<Link to="/orders?status=active">{t('All open orders')}</Link>}>
          {d.attention.length === 0 ? (
            <div className="empty"><strong>{t('All clear')}</strong><p>{t('No open order is late or due in the next 7 days.')}</p></div>
          ) : (
            <div className="list">
              {d.attention.map((o) => (
                <Link key={o.orderId} to={`/orders/${o.orderId}`} className="list-item">
                  <div className="grow">
                    <div className="cell-main">{o.customer?.name} <span className="muted">#{o.orderId}</span></div>
                    <div className="cell-sub">{tn(o.itemCount, 'item', 'items')}{o.gradeName ? ` · ${o.gradeName}` : ''}</div>
                  </div>
                  <div className="right">
                    <div className={o.isOverdue ? 'late' : 'cell-main'}>{dueLabel(o.dueDate)}</div>
                    <Badge kind={o.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
          {c.lateWork > 0 && <div className="list-item"><Icon name="tool" /><span className="grow late">{tn(c.lateWork, 'piece late at the workshop', 'pieces late at the workshop')}</span><Link to="/craftsmen?show=overdue">{t('See')}</Link></div>}
        </Panel>

        <Panel title={t('Latest sales')} flush action={<Link to="/bills">{t('All sales')}</Link>}>
          {d.recentBills.length === 0 ? (
            <div className="empty"><strong>{t('No sales yet')}</strong><p>{t('Your sales will show here.')}</p></div>
          ) : (
            <div className="list">
              {d.recentBills.map((b) => (
                <Link key={b.billId} to={`/bills/${b.billId}`} className="list-item">
                  <div className="grow">
                    <div className="cell-main">{b.customer?.name || t('Walk-in customer')} <span className="muted">#{b.billId}</span></div>
                    <div className="cell-sub">{fmtDate(b.date)}{b.createdBy ? ` · ${b.createdBy.name}` : ''}</div>
                  </div>
                  <div className="right">
                    <div className="cell-main num">{money(b.grandTotal)}</div>
                    {b.status === 'draft' ? <Badge kind="draft" /> : <Badge kind={b.paymentStatus} />}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        {d.money ? (
          <Panel title={t('Money')}>
            <div className="money-row" style={{ marginBottom: 12 }}>
              <div><b>{money(d.money.today)}</b><span>{t('Sold today')}</span></div>
              <div><b>{money(d.money.cashToday)}</b><span>{t('Received today')}</span></div>
              <div><b>{money(d.money.month)}</b><span>{t('Sold this month')}</span></div>
            </div>
            <div className="money-row" style={{ marginBottom: 16 }}>
              <div><b>{money(d.money.due)}</b><span>{t('Customers owe you')}</span></div>
              <div><b>{weight(d.money.soldWeightMonth)}</b><span>{t('Weight sold this month')}</span></div>
              {d.money.owedToSuppliers != null && <div><b>{money(d.money.owedToSuppliers)}</b><span>{t('You owe suppliers')}</span></div>}
            </div>
            {sales.data?.weeks?.length ? (
              <div style={{ height: 210 }} dir="ltr">
                <ResponsiveContainer>
                  <BarChart data={sales.data.weeks} margin={{ left: 0, right: 4, top: 4 }}>
                    <CartesianGrid vertical={false} stroke="#ece6db" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tickFormatter={(v) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1000 ? `${v / 1000}k` : v)} />
                    <Tooltip formatter={(v) => money(v)} cursor={{ fill: '#f4efe6' }} />
                    <Bar dataKey="paid" name={t('Paid')} stackId="a" fill="#123c33" />
                    <Bar dataKey="due" name={t('Unpaid')} stackId="a" fill="#e2b553" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </Panel>
        ) : null}
        <Panel title={t('Best sellers this month')}>
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
          ) : <p className="muted">{t('Pieces you sell this month will be ranked here.')}</p>}
        </Panel>
      </div>
    </>
  );
}
