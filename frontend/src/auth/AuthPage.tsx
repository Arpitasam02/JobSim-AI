import { useEffect, useId, useState, type FormEvent } from 'react';
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
  requestId?: string;
};

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  helperText?: string;
  resetSignal?: number;
};

async function readJsonResponse<T>(response: Response, fallback: T): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('The server returned an invalid response. Please try again.');
  }
}

const passwordRequirement = 'Use at least 8 characters, including uppercase, lowercase, a number, and a symbol.';

function appendRequestId(message: string, requestId?: string) {
  return requestId ? `${message} (Request ID: ${requestId})` : message;
}

function getErrorMessage(body: AuthResponse, fallback: string) {
  if (body.code === 'EMAIL_NOT_VERIFIED') return appendRequestId('Verify your email before signing in.', body.requestId);
  if (body.code === 'ACCOUNT_LOCKED') return appendRequestId(body.message ?? 'Too many failed attempts. Try again later.', body.requestId);
  if (body.code === 'UNAUTHENTICATED' || body.code === 'INVALID_SESSION' || body.code === 'SESSION_REPLAYED') {
    return appendRequestId('Your session expired or is no longer valid. Please sign in again.', body.requestId);
  }
  if (body.code === 'VALIDATION_ERROR' || body.code === 'WEAK_PASSWORD' || body.code === 'EMAIL_IN_USE' || body.code === 'INVALID_CREDENTIALS') {
    return appendRequestId(body.message ?? fallback, body.requestId);
  }
  if (body.code === 'INTERNAL_ERROR' || body.message?.toLowerCase().includes('server')) {
    return appendRequestId('The server is having trouble. Please try again in a moment.', body.requestId);
  }
  if (body.requestId || body.message) return appendRequestId(body.message ?? fallback, body.requestId);
  return fallback;
}

function formatFetchFailure(cause: unknown, fallback: string) {
  if (cause instanceof TypeError || (cause instanceof Error && /fetch|network|Failed to fetch|Unexpected end of JSON input|invalid response/i.test(cause.message))) {
    return 'We could not reach the PlacePrep API. Start the API on port 4000 and try again.';
  }
  if (cause instanceof Error) {
    const message = cause.message || fallback;
    if (/expired|session|sign in again/i.test(message)) {
      return message;
    }
    if (/server|try again later|unexpected error|internal error/i.test(message)) {
      return 'The server is having trouble. Please try again in a moment.';
    }
    if (/password|email|required|valid|incorrect|verify/i.test(message)) {
      return message;
    }
    return message;
  }
  return fallback;
}

function PasswordField({ label, value, onChange, autoComplete, required = true, minLength = 8, maxLength = 128, helperText, resetSignal = 0 }: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const inputId = useId();
  const helperTextId = `${inputId}-help`;

  useEffect(() => {
    setShowPassword(false);
  }, [resetSignal]);

  return (
    <div className="password-control">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-field" data-testid={`password-field-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        <input
          autoComplete={autoComplete}
          aria-describedby={helperText ? helperTextId : undefined}
          id={inputId}
          maxLength={maxLength}
          minLength={minLength}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          type={showPassword ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
          className="password-toggle"
          onClick={() => setShowPassword((current) => !current)}
          title={showPassword ? 'Hide password' : 'Show password'}
          type="button"
        >
          {showPassword ? 'Hide' : 'Show'}
        </button>
      </div>
      {helperText && <small id={helperTextId}>{helperText}</small>}
    </div>
  );
}

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(() => localStorage.getItem('placeprep_last_email') ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'candidate' | 'recruiter'>('candidate');
  const [rememberMe, setRememberMe] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordResetSignal, setPasswordResetSignal] = useState(0);

  async function request(path: string, payload: object): Promise<AuthResponse> {
    const response = await fetch(`/api/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const body = await readJsonResponse<AuthResponse>(response, {});
    if (!response.ok) {
      const message = getErrorMessage(body, 'The request could not be completed.');
      throw new Error(message);
    }
    return body;
  }

  async function doSubmit() {
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
        const profile = profileResponse.ok ? await readJsonResponse<{ roles?: string[] }>(profileResponse, {}) : {};
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
      setPasswordResetSignal((value) => value + 1);
    } catch (cause) {
      const message = formatFetchFailure(cause, 'The request could not be completed.');
      setError(message);
      setPasswordResetSignal((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await doSubmit();
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
          {error && (
            <div className="auth-error" role="alert">
              <span>{error}</span>
              {(error.includes('could not reach the PlacePrep API') || error.includes('The server is having trouble')) && (
                <button className="retry-button" onClick={() => { void doSubmit(); }} type="button">Retry</button>
              )}
            </div>
          )}

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
              {(mode === 'login' || mode === 'register' || mode === 'forgot') && <label>Email address<input autoComplete="email" maxLength={254} onChange={(event) => { setEmail(event.target.value); localStorage.setItem('placeprep_last_email', event.target.value); }} required type="email" value={email} /></label>}
              {mode === 'register' && (
                <label>Join as
                  <select onChange={(event) => setRole(event.target.value as 'candidate' | 'recruiter')} value={role}>
                    <option value="candidate">Candidate</option>
                    <option value="recruiter">Recruiter</option>
                  </select>
                </label>
              )}
              {mode === 'reset' && <label>Reset token<input autoComplete="one-time-code" onChange={(event) => setResetToken(event.target.value)} required value={resetToken} /></label>}
              {(mode === 'login' || mode === 'register' || mode === 'reset') && (
                <PasswordField
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  helperText={mode !== 'login' ? passwordRequirement : undefined}
                  key={`${mode}-${passwordResetSignal}`}
                  label="Password"
                  maxLength={128}
                  minLength={8}
                  onChange={setPassword}
                  resetSignal={passwordResetSignal}
                  required
                  value={password}
                />
              )}
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