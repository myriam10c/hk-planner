import React from 'react';
import { Icon } from '../components/Icon';
import { signIn, signUp, joinOrgBySlug } from '../lib/auth';
import { hasSupabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export const LoginPage: React.FC<{ onAuthed: () => void }> = ({ onAuthed }) => {
  const [mode, setMode] = React.useState<Mode>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [orgSlug, setOrgSlug] = React.useState('paris-hk');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'signup') {
        const res = await signUp(email, password, fullName);
        if (res.session) {
          // Email confirmation disabled — try to attach to org and proceed.
          try { await joinOrgBySlug(orgSlug, 'manager'); } catch {/* swallow */}
          onAuthed();
        } else {
          setInfo('Check your inbox to confirm your email, then sign in.');
          setMode('signin');
        }
      } else {
        await signIn(email, password);
        onAuthed();
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Auth failed');
    } finally {
      setBusy(false);
    }
  };

  if (!hasSupabase) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)' }}>
        <div className="card" style={{ width: 460, padding: 32 }}>
          <div className="row gap-8" style={{ marginBottom: 14 }}>
            <div className="brand-mark" style={{ width: 30, height: 30, fontSize: 14 }}>H</div>
            <h1 style={{ fontSize: 20 }}>HK Planner</h1>
          </div>
          <div className="card" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)', padding: 14 }}>
            <b style={{ fontSize: 13 }}>Demo mode (no backend)</b>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Set <code className="mono">VITE_SUPABASE_URL</code> and <code className="mono">VITE_SUPABASE_ANON_KEY</code> in your environment to enable real accounts.
              See <code className="mono">SETUP.md</code>.
            </div>
          </div>
          <button className="btn full primary" style={{ marginTop: 14 }} onClick={onAuthed}>
            Continue with demo data <Icon name="arrR" size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(140deg, var(--bg) 0%, var(--surface-2) 60%, var(--brand-soft) 100%)' }}>
      <form onSubmit={submit} className="card" style={{ width: 420, padding: 28 }}>
        <div className="row gap-8" style={{ marginBottom: 18 }}>
          <div className="brand-mark" style={{ width: 32, height: 32, fontSize: 15 }}>H</div>
          <div>
            <h1 style={{ fontSize: 18, lineHeight: 1.1 }}>HK Planner</h1>
            <div className="muted" style={{ fontSize: 11 }}>{mode === 'signin' ? 'Sign in to your account' : 'Create your account'}</div>
          </div>
        </div>

        {info && <div className="card" style={{ background: 'var(--good-soft)', borderColor: 'var(--good)', padding: 10, fontSize: 12, marginBottom: 10 }}>{info}</div>}
        {err  && <div className="card" style={{ background: 'var(--bad-soft)',  borderColor: 'var(--bad)',  padding: 10, fontSize: 12, marginBottom: 10, color: 'var(--bad)' }}>{err}</div>}

        {mode === 'signup' && (
          <>
            <label className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Full name</label>
            <input className="input" value={fullName} onChange={e => setFullName(e.target.value)} required style={{ width: '100%', marginTop: 4, marginBottom: 12 }} />
            <label className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Org slug to join</label>
            <input className="input" value={orgSlug} onChange={e => setOrgSlug(e.target.value)} placeholder="paris-hk" style={{ width: '100%', marginTop: 4, marginBottom: 12, fontFamily: 'var(--mono)' }} />
          </>
        )}

        <label className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Email</label>
        <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%', marginTop: 4, marginBottom: 12 }} />

        <label className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Password</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} style={{ width: '100%', marginTop: 4, marginBottom: 16 }} />

        <button className="btn full primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : (mode === 'signin' ? 'Sign in' : 'Create account')}
        </button>

        <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}>
          <button type="button" className="btn ghost sm"
                  onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setErr(null); setInfo(null); }}>
            {mode === 'signin' ? 'No account? Sign up' : 'Already have an account? Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
};
