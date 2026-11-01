import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, errorText, get, patch, post, upload } from '../api';
import { useAuth } from '../auth.jsx';
import { GiveWorkModal, ReceiveWorkModal } from '../components/WorkModals.jsx';
import { useListParams } from '../components/useListParams';
import { fmtDate, money, weight } from '../format';
import { t } from '../i18n';
import { Avatar, Badge, Chips, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Pager, Panel, PhotoPicker, SearchBox, useDebounced, useFetch, useUi } from '../ui.jsx';

export function StaffModal({ staff, onClose, onSaved }) {
  const ui = useUi();
  const [form, setForm] = useState({ staffName: staff?.staffName || '', phone: staff?.phone || '', address: staff?.address || '', email: staff?.email || '', speciality: staff?.speciality || '', resignDate: staff?.resignDate || '' });
  const [photo, setPhoto] = useState(undefined);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    if (!form.staffName.trim()) { setErrors({ staffName: t('Enter the name.') }); return; }
    setBusy(true);
    const body = { ...form, phone: form.phone || null, email: form.email || null, resignDate: form.resignDate || null };
    try {
      let saved = staff ? await patch(`staff/${staff.staffId}/`, body) : await post('staff/', body);
      if (photo !== undefined) saved = await upload(`staff/${saved.staffId}/photo/`, 'photo', photo);
      ui.success(t('Craftsman saved.'));
      onSaved(saved);
    } catch (e) {
      const d = e.response?.data;
      if (d && typeof d === 'object' && (d.phone || d.staffName)) setErrors({ staffName: d.staffName?.[0], phone: d.phone?.[0] });
      else ui.error(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={staff ? t('Change craftsman') : t('New craftsman')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button></>}>
      <PhotoPicker value={staff?.photo} onPick={setPhoto} round size={88} />
      <Field label={t('Name')} error={errors.staffName}><input value={form.staffName} onChange={(e) => set({ staffName: e.target.value })} maxLength={60} /></Field>
      <div className="form-grid">
        <Field label={t('Phone')} error={errors.phone}><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" maxLength={20} /></Field>
        <Field label={t('Speciality')}><input value={form.speciality} onChange={(e) => set({ speciality: e.target.value })} maxLength={60} placeholder={t('Rings, setting, Kabyle jewellery…')} /></Field>
        <Field label={t('Address')}><input value={form.address} onChange={(e) => set({ address: e.target.value })} maxLength={120} /></Field>
        <Field label={t('Email')}><input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        {staff && <Field label={t('Left on')} hint={t('Leave empty while they still work with you')}><input type="date" value={form.resignDate} onChange={(e) => set({ resignDate: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}

export function WorkTable({ rows, onReceive, onRemove, onEdit, showStaff = true }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{showStaff && <th>{t('Craftsman')}</th>}<th>{t('Piece')}</th><th className="right">{t('Handed over')}</th><th>{t('Back by')}</th><th className="right">{t('Returned')}</th><th className="right">{t('Loss')}</th><th /></tr></thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.staffWorkId}>
              {showStaff && <td><Link to={`/craftsmen/${w.staff.staffId}`} className="cell-main">{w.staff.staffName}</Link></td>}
              <td><span className="cell-main">{w.item.name}</span><div className="cell-sub"><Link to={`/orders/${w.orderId}`}>{t('Order #{id}', { id: w.orderId })}</Link>{w.gradeName ? ` · ${w.gradeName}` : ''}</div></td>
              <td className="right num">{weight(w.totalWeight)}<div className="cell-sub">{fmtDate(w.date, false)}</div></td>
              <td>{w.status === 'completed' ? <Badge kind="completed">{t('Received {date}', { date: fmtDate(w.returnedDate, false) })}</Badge> : <span className={w.isOverdue ? 'late' : ''}>{w.dueDate ? fmtDate(w.dueDate, false) : '—'}{w.isOverdue ? ` · ${t('late')}` : ''}</span>}</td>
              <td className="right num">{w.returnedWeight != null ? weight(w.returnedWeight) : '—'}</td>
              <td className="right num">{w.lossWeight != null ? weight(w.lossWeight) : '—'}</td>
              <td className="right nowrap">
                {w.status === 'inprogress' && (<>
                  <button className="btn btn-small btn-primary" onClick={() => onReceive(w)}>{t('Receive')}</button>
                  <button className="icon-btn" onClick={() => onEdit(w)} aria-label={t('Change')}><Icon name="edit" size={16} /></button>
                  <button className="icon-btn" onClick={() => onRemove(w)} aria-label={t('Take back')}><Icon name="trash" size={16} /></button>
                </>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function useWorkActions(reload) {
  const ui = useUi();
  const [receiving, setReceiving] = useState(null);
  const [editing, setEditing] = useState(null);
  const onRemove = async (w) => {
    if (!(await ui.confirm({ title: t('Cancel this work?'), message: t('{piece} goes back to "not started".', { piece: w.item.name }), confirmLabel: t('Cancel the work'), danger: true }))) return;
    try { await del(`work/${w.staffWorkId}/`); reload(); } catch (e) { ui.error(errorText(e)); }
  };
  const modal = (<>
    {receiving && <ReceiveWorkModal work={receiving} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); reload(); }} />}
    {editing && <GiveWorkModal work={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
  </>);
  return { onReceive: setReceiving, onEdit: setEditing, onRemove, modal };
}

function WorkTab() {
  const defaults = useMemo(() => ({ show: 'inprogress', q: '', page: '1' }), []);
  const [f, setF] = useListParams(defaults);
  const [text, setText] = useState(f.q);
  const q = useDebounced(text);
  const [giving, setGiving] = useState(false);
  const params = { q, page: f.page, status: f.show === 'overdue' ? 'inprogress' : f.show, due: f.show === 'overdue' ? 'overdue' : '' };
  const { data, loading, error, reload } = useFetch(() => get('work/', params), [q, f.show, f.page]);
  const actions = useWorkActions(reload);
  return (
    <>
      <div className="toolbar">
        <Chips value={f.show} onChange={(v) => setF({ show: v })} options={[{ value: 'inprogress', label: t('At the workshop') }, { value: 'overdue', label: t('Late') }, { value: 'completed', label: t('Received') }, { value: 'all', label: t('All') }]} />
        <SearchBox value={text} onChange={(v) => { setText(v); setF({ q: v }); }} placeholder={t('Craftsman or piece')} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setGiving(true)}><Icon name="plus" size={18} />{t('Give work')}</button>
      </div>
      {error && <ErrorBox message={errorText(error)} onRetry={reload} />}
      <Panel flush>
        {loading && !data ? <Loading /> : data?.results.length === 0 ? <Empty icon="tool" title={t('Nothing here')}>{t('Give an order piece to a craftsman with "Give work".')}</Empty> : (
          <div style={{ opacity: loading ? 0.6 : 1 }}><WorkTable rows={data.results} {...actions} /></div>
        )}
        <Pager page={data?.page} totalPages={data?.totalPages} onPage={(p) => setF({ page: String(p) })} />
      </Panel>
      {actions.modal}
      {giving && <GiveWorkModal onClose={() => setGiving(false)} onDone={() => { setGiving(false); reload(); }} />}
    </>
  );
}

function PeopleTab() {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useFetch(() => get('staff/'), []);
  return (
    <>
      <div className="toolbar"><span className="spacer" /><button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('New craftsman')}</button></div>
      {error && <ErrorBox message={errorText(error)} onRetry={reload} />}
      {loading && !data ? <Loading /> : data?.length === 0 ? <Panel><Empty icon="tool" title={t('No craftsmen yet')}>{t('Add the people who make your pieces.')}</Empty></Panel> : (
        <div className="grid-3">
          {data?.map((s) => (
            <button key={s.staffId} type="button" className="panel" style={{ textAlign: 'start', cursor: 'pointer', font: 'inherit', padding: 18, opacity: s.resignDate ? 0.6 : 1 }} onClick={() => navigate(`/craftsmen/${s.staffId}`)}>
              <div className="cell-flex"><Avatar src={s.photo} name={s.staffName} size={56} /><div className="grow"><div className="cell-main">{s.staffName}</div><div className="cell-sub">{s.speciality || s.phone || '—'}</div></div>{s.resignDate && <Badge kind="submitted">{t('Left')}</Badge>}</div>
              <div className="money-row" style={{ marginTop: 14 }}>
                <div><b>{s.inprogress}</b><span>{t('With them')}</span></div>
                <div><b>{weight(s.weightOut)}</b><span>{t('Metal they hold')}</span></div>
                <div><b>{weight(s.totalLoss)}</b><span>{t('Total loss')}</span></div>
              </div>
            </button>
          ))}
        </div>
      )}
      {adding && <StaffModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

export default function Craftsmen() {
  const [tab, setTab] = useState('work');
  return (
    <>
      <PageHeader title={t('Craftsmen')} subtitle={t('Who has your metal, and when it comes back')} />
      <div className="tabs">
        <button className={tab === 'work' ? 'on' : ''} onClick={() => setTab('work')}><Icon name="tool" size={18} />{t('Work at the workshop')}</button>
        <button className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}><Icon name="users" size={18} />{t('Craftsmen')}</button>
      </div>
      {tab === 'work' ? <WorkTab /> : <PeopleTab />}
    </>
  );
}

export function StaffDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ui = useUi();
  const { isOwner } = useAuth();
  const { data: s, loading, error, reload } = useFetch(() => get(`staff/${id}/`), [id]);
  const [editing, setEditing] = useState(false);
  const actions = useWorkActions(reload);
  if (loading && !s) return <Loading />;
  if (error && !s) return <ErrorBox message={errorText(error)} onRetry={reload} />;
  const remove = async () => {
    if (!(await ui.confirm({ title: t('Delete {name}?', { name: s.staffName }), message: t('Only craftsmen who never had work can be deleted. Otherwise set a leaving date.'), confirmLabel: t('Delete'), danger: true }))) return;
    try { await del(`staff/${s.staffId}/`); navigate('/craftsmen'); } catch (e) { ui.error(errorText(e)); }
  };
  return (
    <>
      <PageHeader back={<Link className="back" to="/craftsmen"><Icon name="chevron" size={14} />{t('Craftsmen')}</Link>}
        title={<span className="cell-flex"><Avatar src={s.photo} name={s.staffName} size={52} />{s.staffName}</span>}
        subtitle={<span className="row">{[s.speciality, s.phone, s.address].filter(Boolean).join(' · ') || t('No contact details')}{s.resignDate && <Badge kind="submitted">{t('Left on {date}', { date: fmtDate(s.resignDate) })}</Badge>}</span>}
        actions={<><button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={18} />{t('Change')}</button>{isOwner && <button className="btn" onClick={remove}><Icon name="trash" size={18} /></button>}</>} />
      <div className="stats">
        <div className="stat"><div className="stat-label">{t('With them now')}</div><div className="stat-value">{s.inprogress}</div></div>
        <div className="stat"><div className="stat-label">{t('Metal they hold')}</div><div className="stat-value">{weight(s.weightOut)}</div></div>
        <div className="stat"><div className="stat-label">{t('Total loss')}</div><div className="stat-value">{weight(s.totalLoss)}</div></div>
        <div className="stat"><div className="stat-label">{t('Total fees')}</div><div className="stat-value" style={{ fontSize: '1.3rem' }}>{money(s.totalWages)}</div></div>
      </div>
      <Panel title={t('Work history')} flush>
        {s.works.length === 0 ? <Empty icon="tool" title={t('No work yet')} /> : <WorkTable rows={s.works} showStaff={false} {...actions} />}
      </Panel>
      {actions.modal}
      {editing && <StaffModal staff={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
