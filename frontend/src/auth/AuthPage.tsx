import { useState, type FormEvent } from 'react';
import { ArrowRight, GraduationCap, LoaderCircle, ShieldCheck } from 'lucide-react';

export type SessionUser = { id: string; email: string; name: string; roles?: string[] };
type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

type AuthPageProps = {
  onAuthenticated: (accessToken: string, user: SessionUser) => void;
};

type AuthResponse = {
  code?: string;
  message?: string;
  accessToken?: string;
  user?: SessionUser;
  developmentVerificationToken?: string;
  developmentResetToken?: string;
};

const passwordRequirement = 'Use at least 8 characters, including uppercase, lowercase, a number, and a symbol.';

function getErrorMessage(body: AuthResponse, fallback: string) {
  if (body.code === 'EMAIL_NOT_VERIFIED') return 'Verify your email before signing in.';
  if (body.code === 'ACCOUNT_LOCKED') return body.message ?? 'Too many failed attempts. Try again later.';
  return body.message ?? fallback;
}

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'candidate' | 'recruiter'>('candidate');
  const [rememberMe, setRememberMe] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(path: string, payload: object): Promise<AuthResponse> {
    const response = await fetch(`/api/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const body = await response.json() as AuthResponse;
    if (!response.ok) throw new Error(getErrorMessage(body, 'The request could not be completed.'));
    return body;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'login') {
        const body = await request('login', { email, password, rememberMe });
        if (!body.accessToken || !body.user) throw new Error('The server returned an incomplete session.');
        const profileResponse = await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${body.accessToken}` },
          credentials: 'include',
        });
        const profile = profileResponse.ok ? await profileResponse.json() as { roles?: string[] } : {};
        onAuthenticated(body.accessToken, { ...body.user, roles: profile.roles });
      } else if (mode === 'register') {
        const body = await request('register', { name, email, password, role });
        if (body.developmentVerificationToken) setVerificationToken(body.developmentVerificationToken);
        setNotice(body.message ?? 'Account created. Check your email to verify it.');
      } else if (mode === 'forgot') {
        const body = await request('forgot', { email });
        if (body.developmentResetToken) setResetToken(body.developmentResetToken);
        setNotice(body.message ?? 'If the account exists, reset instructions are on the way.');
      } else {
        const body = await request('reset', { token: resetToken, password });
        setNotice(body.message ?? 'Password updated. Sign in with your new password.');
        setMode('login');
        setPassword('');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyDevelopmentEmail() {
    setBusy(true);
    setError('');
    try {
      const body = await request('verify-email', { token: verificationToken });
      setVerificationToken('');
      setMode('login');
      setNotice(body.message ?? 'Email verified. You can now sign in.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Email verification failed.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Make room for what’s next' : mode === 'forgot' ? 'Reset your password' : 'Choose a new password';
  const description = mode === 'login'
    ? 'Pick up where you left off.'
    : mode === 'register'
      ? 'Build a more confident path to your next role.'
      : mode === 'forgot'
        ? 'We’ll send a time-limited reset link if there’s an account for that email.'
        : 'Choose a strong password you haven’t used here before.';

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="PlacePrep AI">
        <a className="auth-brand" href="#home">
          <span className="brand-mark"><GraduationCap size={19} strokeWidth={2.2} /></span>
          <span>placeprep<span className="brand-ai">.ai</span></span>
        </a>
        <div className="story-body">
          <span className="story-eyebrow"><span /> YOUR NEXT CHAPTER, IN FOCUS</span>
          <h1>Progress you<br />can actually <i>see.</i></h1>
          <p>Make your preparation count, one clear next step at a time.</p>
          <div className="story-orbit" aria-hidden="true">
            <span className="orbit-circle orbit-outer" />
            <span className="orbit-circle orbit-middle" />
            <span className="orbit-circle orbit-inner" />
            <span className="orbit-core"><GraduationCap size={25} /></span>
            <span className="orbit-node orbit-node-one" />
            <span className="orbit-node orbit-node-two" />
            <span className="orbit-node orbit-node-three" />
          </div>
        </div>
        <div className="story-footer"><ShieldCheck size={15} /> Your resume and practice data stay yours.</div>
      </section>

      <section className="auth-form-side">
        <div className="auth-mobile-brand auth-brand">
          <span className="brand-mark"><GraduationCap size={19} strokeWidth={2.2} /></span>
          <span>placeprep<span className="brand-ai">.ai</span></span>
        </div>
        <div className="auth-card">
          <div className="auth-kicker">CANDIDATE & RECRUITER WORKSPACE</div>
          <h2>{title}</h2>
          <p className="auth-description">{description}</p>

          {notice && <div className="auth-notice" role="status">{notice}</div>}
          {error && <div className="auth-error" role="alert">{error}</div>}

          {verificationToken ? (
            <div className="verification-panel">
              <span className="verification-icon"><ShieldCheck size={19} /></span>
              <strong>Verify your email</strong>
              <p>Local development verification is ready. In production, this step is delivered by email.</p>
              <button className="auth-submit" disabled={busy} onClick={verifyDevelopmentEmail} type="button">
                {busy ? <LoaderCircle className="spinner" size={17} /> : null} Verify email <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              {mode === 'register' && <label>Name<input autoComplete="name" maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} /></label>}
              {(mode === 'login' || mode === 'register' || mode === 'forgot') && <label>Email address<input autoComplete="email" maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>}
              {mode === 'register' && (
                <label>Join as
                  <select onChange={(event) => setRole(event.target.value as 'candidate' | 'recruiter')} value={role}>
                    <option value="candidate">Candidate</option>
                    <option value="recruiter">Recruiter</option>
                  </select>
                </label>
              )}
              {mode === 'reset' && <label>Reset token<input autoComplete="one-time-code" onChange={(event) => setResetToken(event.target.value)} required value={resetToken} /></label>}
              {(mode === 'login' || mode === 'register' || mode === 'reset') && <label>Password<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={128} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />{mode !== 'login' && <small>{passwordRequirement}</small>}</label>}
              {mode === 'login' && <label className="remember-control"><input checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" /><span>Keep me signed in</span></label>}
              {mode === 'forgot' && resetToken && <div className="auth-notice" role="status">A development reset token is ready. Paste it into the reset form to continue.</div>}
              <button className="auth-submit" disabled={busy} type="submit">
                {busy ? <LoaderCircle className="spinner" size={17} /> : null}
                {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Update password'}
                {!busy && <ArrowRight size={16} />}
              </button>
            </form>
          )}

          <div className="auth-links">
            {mode === 'login' && <><button onClick={() => { setMode('forgot'); setError(''); setNotice(''); }} type="button">Forgot password?</button><span>New here? <button className="auth-link-strong" onClick={() => { setMode('register'); setError(''); setNotice(''); }} type="button">Create account</button></span></>}
            {mode === 'register' && <span>Already have an account? <button className="auth-link-strong" onClick={() => { setMode('login'); setError(''); setNotice(''); }} type="button">Sign in</button></span>}
            {(mode === 'forgot' || mode === 'reset') && <button onClick={() => { setMode(mode === 'forgot' && resetToken ? 'reset' : 'login'); setError(''); setNotice(''); }} type="button">{mode === 'forgot' && resetToken ? 'Continue to reset' : 'Back to sign in'}</button>}
          </div>
          <div className="auth-bottom-note">By continuing, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</div>
        </div>
        <div className="auth-page-footer">PlacePrep AI <span>·</span> Make your next move a good one.</div>
      </section>
    </main>
  );
}