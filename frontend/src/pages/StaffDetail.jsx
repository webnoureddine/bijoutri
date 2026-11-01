import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, errorText, get } from '../api';
import { Badge, Empty, ErrorBox, Icon, Loading, PageHeader, Panel, useFetch, useUi } from '../ui.jsx';
import { fmtDate, lal } from '../format';
import { StaffModal, WorkTable, useWorkActions } from './Craftsmen.jsx';
import { t } from '../i18n';

export default function StaffDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ui = useUi();
  const { data: s, loading, error, reload } = useFetch(() => get(`staff/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const actions = useWorkActions(reload);

  if (loading && !s) return <Loading />;
  if (error) return <ErrorBox message={errorText(error)} onRetry={reload} />;

  const remove = async () => {
    if (!(await ui.confirm({ title: t("Delete {s.staffName}?", { "s.staffName": s.staffName }), message: t("Only craftsmen who never had any work can be deleted. Otherwise set a resign date."), confirmLabel: t("Delete"), danger: true }))) return;
    try { await del(`staff/delete/${s.staffId}`); ui.success(t("Craftsman deleted.")); navigate('/craftsmen'); } catch (e) { ui.error(errorText(e)); }
  };

  return (
    <>
      <PageHeader
        back={<Link className="back" to="/craftsmen"><Icon name="chevron" size={14} />{t("Craftsmen")}</Link>}
        title={s.staffName}
        subtitle={<span className="row" style={{ gap: 10 }}>{[s.phone, s.address].filter(Boolean).join(' · ') || t("No contact details")}{s.resignDate && <Badge kind="submitted">{t("Resigned")} {fmtDate(s.resignDate)}</Badge>}</span>}
        actions={<><button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />{t("Edit")}</button><button className="btn" onClick={remove}><Icon name="trash" size={16} />{t("Delete")}</button></>}
      />
      <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat"><div className="stat-label">{t("With them now")}</div><div className="stat-value">{s.inprogress}</div></div>
        <div className="stat"><div className="stat-label">{t("Finished")}</div><div className="stat-value">{s.completed}</div></div>
        <div className="stat"><div className="stat-label">{t("Total loss")}</div><div className="stat-value">{lal(s.totalLoss)}</div></div>
      </div>
      <Panel title={t("Work history")} flush>
        {s.works.length === 0 ? <Empty title={t("No work yet")}>{t("Give this craftsman an order item from an order page or the Craftsmen screen.")}</Empty> : <WorkTable rows={s.works} showStaff={false} onReceive={actions.onReceive} onRemove={actions.onRemove} />}
      </Panel>
      {actions.modal}
      {editing && <StaffModal staff={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
