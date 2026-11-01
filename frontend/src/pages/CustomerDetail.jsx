import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, errorText, get } from '../api';
import { Badge, Empty, ErrorBox, Icon, Loading, Metal, PageHeader, Panel, useFetch, useUi } from '../ui.jsx';
import { dueLabel, fmtDate, money } from '../format';
import { CustomerModal } from './Customers.jsx';
import { t } from '../i18n';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ui = useUi();
  const { data: c, loading, error, reload } = useFetch(() => get(`customer/${id}`), [id]);
  const [editing, setEditing] = useState(false);

  if (loading && !c) return <Loading />;
  if (error) return <ErrorBox message={errorText(error)} onRetry={reload} />;

  const remove = async () => {
    if (!(await ui.confirm({ title: t("Delete {c.name}?", { "c.name": c.name }), message: t("Only customers without orders or bills can be deleted."), confirmLabel: t("Delete customer"), danger: true }))) return;
    try { await del(`customer/${c.customerId}`); ui.success(t("Customer deleted.")); navigate('/customers'); } catch (e) { ui.error(errorText(e)); }
  };

  return (
    <>
      <PageHeader
        back={<Link className="back" to="/customers"><Icon name="chevron" size={14} />{t("Customers")}</Link>}
        title={c.name}
        subtitle={[c.phone, c.address, c.email].filter(Boolean).join(' · ') || t("No contact details yet")}
        actions={
          <>
            <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />{t("Edit")}</button>
            {c.orders.length === 0 && c.bills.length === 0 && <button className="btn" onClick={remove}><Icon name="trash" size={16} />{t("Delete")}</button>}
            <Link className="btn" to={`/bills/new?customer=${c.customerId}`}>{t("New bill")}</Link>
            <Link className="btn btn-primary" to={`/orders/new?customer=${c.customerId}`}><Icon name="plus" size={16} />{t("New order")}</Link>
          </>
        }
      />
      {c.dueAmount > 0 && <div className="banner"><Icon name="alert" /><span><strong>{money(c.dueAmount)}</strong> {t("is still unpaid on")} {c.bills.filter((b) => b.paymentStatus === 'due' && b.status === 'submitted').length} {t("bill(s).")}</span></div>}

      <div className="grid-2">
        <Panel title={t("Orders ({c.orders.length})", { "c.orders.length": c.orders.length })} flush>
          {c.orders.length === 0 ? <Empty title={t("No orders yet")} /> : (
            <div className="list">
              {c.orders.map((o) => (
                <Link key={o.orderId} to={`/orders/${o.orderId}`} className="list-item">
                  <div className="grow"><div className="cell-main">#{o.orderId} · {fmtDate(o.date)}</div><div className="cell-sub"><Metal type={o.type} /> · {o.itemCount} {t("item")}{o.itemCount === 1 ? '' : 's'}</div></div>
                  <div className="right"><Badge kind={o.status} />{o.status !== 'submitted' && <div className={o.isOverdue ? 'late small' : 'cell-sub'}>{dueLabel(o.submittionDate)}</div>}</div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={t("Bills ({c.bills.length})", { "c.bills.length": c.bills.length })} flush>
          {c.bills.length === 0 ? <Empty title={t("No bills yet")} /> : (
            <div className="list">
              {c.bills.map((b) => (
                <Link key={b.billId} to={`/bills/${b.billId}`} className="list-item">
                  <div className="grow"><div className="cell-main">#{b.billId} · {fmtDate(b.date)}</div><div className="cell-sub num">{money(b.grandTotalAmount)}</div></div>
                  <div className="right">{b.status === 'draft' ? <Badge kind="draft" /> : <Badge kind={b.paymentStatus} />}{b.paymentStatus === 'due' && b.status === 'submitted' && <div className="cell-sub num">{t("owes")} {money(b.remainingAmount)}</div>}</div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
      {editing && <CustomerModal customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
