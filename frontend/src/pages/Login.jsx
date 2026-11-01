import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errorText, post } from '../api';
import { useAuth } from '../auth.jsx';
import { t } from '../i18n';
import { Field, Icon, LangSwitch } from '../ui.jsx';

function AuthShell({ title, children }) {
  return (
    <div className="auth">
      <div className="auth-art">
        <div className="brand">
          <span className="brand-mark"><svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5l9 7-9 15-9-15z" fill="#e2b553" /></svg></span>
          <span><div className="brand-name">Siagha</div><div className="brand-sub">{t('Jewellery management')}</div></span>
        </div>
        <div>
          <h2>{t('Your shop, your stock and your workshop in one place.')}</h2>
          <div className="auth-points">
            <div><Icon name="cart" />{t('Sell from stock with photos in a few taps')}</div>
            <div><Icon name="tool" />{t('Know which craftsman has your gold')}</div>
            <div><Icon name="shield" />{t('Protected sign-in for every worker')}</div>
          </div>
        </div>
        <svg className="gem" viewBox="0 0 200 200" aria-hidden="true">
          <path d="M100 20l70 55-70 105L30 75z" fill="#164a3e" />
          <path d="M30 75h140M70 75l30 105 30-105M100 20L70 75M100 20l30 55" stroke="#2a6b5a" strokeWidth="2" fill="none" />
        </svg>
      </div>
      <div className="auth-form">
        <LangSwitch />
        <div className="auth-card">
          <h1>{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '', otp: '', remember: true });
  const [step, setStep] = useState('password');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.username.trim() || !form.password) { setError(t('Enter your username and password.')); return; }
    if (step === 'otp' && form.otp.replace(/\s/g, '').length < 6) { setError(t('Enter the 6-digit code.')); return; }
    setBusy(true);
    try {
      const res = await login({ ...form, username: form.username.trim(), otp: step === 'otp' ? form.otp : undefined });
      if (res.otpRequired) { setStep('otp'); setBusy(false); }
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell title={step === 'otp' ? t('Security code') : t('Sign in')}>
      <form className="stack" onSubmit={submit} noValidate>
        {error && <div className="error-box" role="alert"><Icon name="alert" />{error}</div>}
        {step === 'password' ? (
          <>
            <Field label={t('Username or email')}><input value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="username" autoFocus autoCapitalize="none" /></Field>
            <Field label={t('Password')}><input type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="current-password" /></Field>
            <label className="check"><input type="checkbox" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} />{t('Keep me signed in on this device')}</label>
          </>
        ) : (
          <Field label={t('Open your authenticator app and type the 6-digit code')}>
            <input className="otp-input" value={form.otp} onChange={(e) => set({ otp: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })} inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </Field>
        )}
        <button className="btn btn-primary btn-big" disabled={busy}>{busy ? t('Signing in…') : step === 'otp' ? t('Confirm') : t('Sign in')}</button>
        {step === 'otp' ? (
          <button type="button" className="link-btn" onClick={() => { setStep('password'); set({ otp: '' }); }}>{t('Back')}</button>
        ) : (
          <Link to="/forgot-password">{t('Forgot your password?')}</Link>
        )}
        <p className="muted small" style={{ margin: 0 }}><Icon name="lock" size={14} /> {t('After 5 wrong passwords the account is locked for 15 minutes.')}</p>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await post('password_reset/', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  };
  return (
    <AuthShell title={t('Reset password')}>
      {sent ? (
        <div className="stack">
          <p>{t('If {email} has an account, a link to choose a new password is on its way.', { email })}</p>
          <Link className="btn" to="/login">{t('Back to sign in')}</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          {error && <div className="error-box">{error}</div>}
          <p className="muted" style={{ margin: 0 }}>{t('Employees: ask the owner to set a new password for you. Owner: enter your email.')}</p>
          <Field label={t('Email')}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
          <button className="btn btn-primary btn-big" disabled={busy}>{busy ? t('Sending…') : t('Send reset link')}</button>
          <Link to="/login">{t('Back to sign in')}</Link>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== again) { setError(t('The two passwords do not match.')); return; }
    setBusy(true);
    try {
      await post('password_reset/confirm/', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setError(err.response?.status === 404 ? t('This link has expired. Ask for a new one.') : errorText(err));
    }
    setBusy(false);
  };
  return (
    <AuthShell title={t('Choose a new password')}>
      {!token ? (
        <div className="stack"><div className="error-box">{t('This link is incomplete. Ask for a new one.')}</div><Link className="btn" to="/forgot-password">{t('Send a new link')}</Link></div>
      ) : done ? <p>{t('Password changed. Taking you to sign in…')}</p> : (
        <form className="stack" onSubmit={submit}>
          {error && <div className="error-box">{error}</div>}
          <Field label={t('New password')} hint={t('At least 8 characters, not only numbers')}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required /></Field>
          <Field label={t('Repeat new password')}><input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required /></Field>
          <button className="btn btn-primary btn-big" disabled={busy}>{busy ? t('Saving…') : t('Save new password')}</button>
        </form>
      )}
    </AuthShell>
  );
}
