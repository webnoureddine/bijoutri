import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { plain } from '../format';
import { t } from '../i18n';
import { useShop } from '../shop.jsx';
import { Avatar, Icon, LangSwitch } from '../ui.jsx';

export function nav(isOwner) {
  return [
    { group: t('Every day') },
    { to: '/', label: t('Home'), icon: 'home', end: true },
    { to: '/stock', label: t('Jewellery stock'), icon: 'gem' },
    { to: '/bills', label: t('Sales'), icon: 'bills' },
    { to: '/orders', label: t('Orders'), icon: 'orders' },
    { to: '/customers', label: t('Customers'), icon: 'users' },
    { group: t('Workshop & purchases') },
    { to: '/craftsmen', label: t('Craftsmen'), icon: 'tool' },
    ...(isOwner ? [{ to: '/suppliers', label: t('Suppliers'), icon: 'truck' }] : []),
    { to: '/rates', label: t("Today's prices"), icon: 'trend' },
    { group: t('Shop') },
    { to: '/settings', label: t('Settings'), icon: 'settings' },
  ];
}

function RateChips() {
  const { grades, allToday, loading } = useShop();
  const shown = grades.filter((g) => g.rate);
  return (
    <div className="rates">
      {shown.map((g) => (
        <NavLink key={g.gradeId} to="/rates" className={`rate-chip ${g.isToday ? '' : 'stale'}`} title={t('Change prices')}>
          <i className="dot" style={{ background: g.color }} />{g.name} <b>{plain(g.rate.sellPrice)}</b>
        </NavLink>
      ))}
      {!loading && (!allToday || shown.length === 0) && (
        <NavLink to="/rates" className="rate-warn"><Icon name="alert" size={16} />{t("Set today's prices")}</NavLink>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout, isOwner } = useAuth();
  const { settings } = useShop();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);
  const name = user?.full_name || user?.first_name || user?.username;

  return (
    <div className="app">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar no-print ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            {settings?.logo ? <img src={settings.logo} alt="" /> : (
              <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5l9 7-9 15-9-15z" fill="#e2b553" /><path d="M7 12h18M16 5l-3 7 3 15 3-15z" stroke="#0c2c25" strokeWidth="1.3" fill="none" /></svg>
            )}
          </span>
          <span><div className="brand-name">{settings?.shopName || 'Siagha'}</div><div className="brand-sub">Siagha · {t('Jewellery management')}</div></span>
        </div>
        <nav className="nav" aria-label={t('Main menu')}>
          <NavLink to="/sell" className="nav-sell"><Icon name="cart" />{t('Sell')}</NavLink>
          {nav(isOwner).map((item, i) => item.group ? <div key={i} className="nav-group">{item.group}</div> : (
            <NavLink key={item.to} to={item.to} end={item.end}><Icon name={item.icon} />{item.label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <LangSwitch />
          <NavLink to="/settings?tab=account" className="who">
            <Avatar src={user?.profileImage} name={name} size={38} />
            <span><div className="who-name">{name}</div><div className="who-role">{isOwner ? t('Owner') : t('Employee')}</div></span>
          </NavLink>
          <button className="logout" onClick={logout}><Icon name="logout" className="flip" />{t('Log out')}</button>
        </div>
      </aside>
      <div className="content">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label={t('Open menu')}><Icon name="menu" size={24} /></button>
          <RateChips />
        </header>
        <main className="page"><Outlet /></main>
      </div>
      <nav className="bottom-nav no-print" aria-label={t('Quick menu')}>
        <NavLink to="/" end><Icon name="home" />{t('Home')}</NavLink>
        <NavLink to="/stock"><Icon name="gem" />{t('Stock')}</NavLink>
        <NavLink to="/sell" className="sell"><Icon name="cart" size={26} />{t('Sell')}</NavLink>
        <NavLink to="/orders"><Icon name="orders" />{t('Orders')}</NavLink>
        <NavLink to="/bills"><Icon name="bills" />{t('Sales')}</NavLink>
      </nav>
    </div>
  );
}
