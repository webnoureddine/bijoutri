import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errorText, get, post } from '../api';
import { useAuth } from '../auth.jsx';
import { fmtDate, isoDate, money, num, plain, priceBasis } from '../format';
import { t } from '../i18n';
import { useShop } from '../shop.jsx';
import { Chips, Empty, ErrorBox, Icon, Loading, NumberInput, PageHeader, Panel, useFetch, useUi } from '../ui.jsx';

export default function Rates() {
  const ui = useUi();
  const { isOwner } = useAuth();
  const { grades, settings, reloadRates, allToday } = useShop();
  const canSet = isOwner || settings?.employeesCanSetRates;
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState('monthly');
  const chart = useFetch(() => get('rates/report/', { type: range }), [range]);
  const history = useFetch(() => get('rates/', { limit: 400 }), []);

  useEffect(() => {
    const f = {};
    grades.forEach((g) => { f[g.gradeId] = { sell: g.rate?.sellPrice ?? '', buy: g.rate?.buyPrice ?? '' }; });
    setForm(f);
  }, [grades]);

  const save = async (e) => {
    e.preventDefault();
    const rows = grades.filter((g) => num(form[g.gradeId]?.sell) > 0).map((g) => ({ grade: g.gradeId, sellPrice: num(form[g.gradeId].sell), buyPrice: form[g.gradeId].buy === '' ? null : num(form[g.gradeId].buy) }));
    if (!rows.length) { ui.error(t('Enter at least one price.')); return; }
    setBusy(true);
    try {
      await post('rates/set/', { rates: rows });
      ui.success(t("Today's prices saved."));
      reloadRates(); chart.reload(); history.reload();
    } catch (err) { ui.error(errorText(err)); }
    setBusy(false);
  };

  // history: one row per day, one column per grade
  const days = useMemo(() => {
    const map = new Map();
    (history.data || []).forEach((r) => {
      if (!map.has(r.date)) map.set(r.date, {});
      map.get(r.date)[r.grade] = r;
    });
    return [...map.entries()].slice(0, 30);
  }, [history.data]);

  return (
    <>
      <PageHeader title={t("Today's prices")} subtitle={t('Prices {basis}. Every sale and order starts from them.', { basis: priceBasis() })} />
      <div className="cols-main" style={{ gridTemplateColumns: 'minmax(0, 420px) 1fr' }}>
        <Panel title={allToday ? t("Today's prices are set") : t("Set today's prices")} action={<span className="muted small">{fmtDate(isoDate())}</span>}>
          {grades.length === 0 ? <Empty title={t('No metals set up')} action={isOwner && <Link className="btn" to="/settings?tab=units">{t('Set up metals')}</Link>} /> : (
            <form className="stack" onSubmit={save} noValidate>
              <table className="table">
                <thead><tr><th>{t('Metal')}</th><th>{t('Selling')}</th><th>{t('Buying old')}</th></tr></thead>
                <tbody>
                  {grades.map((g) => (
                    <tr key={g.gradeId}>
                      <td><span className="grade-tag"><i style={{ background: g.color }} />{g.name}</span>{!g.isToday && g.rate && <div className="cell-sub">{t('last: {date}', { date: fmtDate(g.rate.date, false) })}</div>}</td>
                      <td><NumberInput value={form[g.gradeId]?.sell ?? ''} disabled={!canSet} onChange={(v) => setForm((f) => ({ ...f, [g.gradeId]: { ...f[g.gradeId], sell: v } }))} /></td>
                      <td><NumberInput value={form[g.gradeId]?.buy ?? ''} disabled={!canSet} onChange={(v) => setForm((f) => ({ ...f, [g.gradeId]: { ...f[g.gradeId], buy: v } }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small" style={{ margin: 0 }}>{t('"Buying old" is what you pay for old gold (cassé) taken in exchange.')}</p>
              {canSet ? <button className="btn btn-primary btn-big" disabled={busy}><Icon name="check" />{busy ? t('Saving…') : t("Save today's prices")}</button>
                : <p className="muted">{t('Only the owner can change the prices.')}</p>}
              {isOwner && <Link to="/settings?tab=units" className="small">{t('Add or rename metals and karats')}</Link>}
            </form>
          )}
        </Panel>
        <div className="stack">
          <Panel title={t('How prices moved')} action={<Chips value={range} onChange={setRange} options={[{ value: 'weekly', label: t('7 days') }, { value: 'monthly', label: t('30 days') }, { value: 'yearly', label: t('This year') }]} />}>
            {chart.loading && !chart.data ? <Loading /> : chart.error ? <ErrorBox message={errorText(chart.error)} /> : chart.data.length === 0 ? <Empty title={t('Nothing to show yet')}>{t('Prices you save appear here.')}</Empty> : (
              <div style={{ height: 280 }} dir="ltr">
                <ResponsiveContainer>
                  <LineChart data={chart.data} margin={{ left: 6, right: 12, top: 6 }}>
                    <CartesianGrid vertical={false} stroke="#ece6db" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => (v.length === 10 ? v.slice(5).split('-').reverse().join('/') : v)} />
                    <YAxis domain={['auto', 'auto']} tickLine={false} axisLine={false} fontSize={11} width={64} tickFormatter={(v) => plain(v)} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    {grades.map((g) => <Line key={g.gradeId} type="monotone" dataKey={String(g.gradeId)} name={g.name} stroke={g.color} strokeWidth={2.4} dot={chart.data.length < 15} connectNulls />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
          <Panel title={t('Past prices')} flush>
            {history.loading && !history.data ? <Loading /> : days.length === 0 ? <Empty title={t('No prices saved yet')} /> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t('Date')}</th>{grades.map((g) => <th key={g.gradeId} className="right">{g.name}</th>)}</tr></thead>
                <tbody>{days.map(([date, row]) => (
                  <tr key={date}><td className="cell-main">{fmtDate(date)}</td>{grades.map((g) => <td key={g.gradeId} className="right num">{row[g.gradeId] ? plain(row[g.gradeId].sellPrice) : '—'}</td>)}</tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
