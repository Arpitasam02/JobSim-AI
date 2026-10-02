import { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Menu,
  Mic2,
  Search,
  Settings2,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import AuthPage, { type SessionUser } from './auth/AuthPage';
import ResumeWorkspace from './resumes/ResumeWorkspace';
import RoleWorkspace from './roles/RoleWorkspace';
import AssessmentWorkspace from './assessments/AssessmentWorkspace';
import InterviewWorkspace from './interviews/InterviewWorkspace';
import { CandidateJobsWorkspace, RecruiterJobsWorkspace } from './jobs/JobWorkspaces';

const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'My resume', icon: FileText },
  { label: 'Role matches', icon: Target },
  { label: 'Skill roadmap', icon: BookOpen },
  { label: 'Mock tests', icon: ClipboardCheck },
  { label: 'Mock interviews', icon: Mic2 },
  { label: 'Placement probability', icon: TrendingUp },
  { label: 'Explore jobs', icon: BriefcaseBusiness },
];

const actions = [
  { label: 'Add a project with measurable impact', type: 'Resume', icon: FileText },
  { label: 'Practice SQL joins and window functions', type: 'Skill gap', icon: BookOpen },
  { label: 'Try a 20-minute technical mock interview', type: 'Practice', icon: Mic2 },
];

const roles = [
  { name: 'Data Analyst', match: 82, skills: 'SQL, Python, data storytelling', color: 'mint' },
  { name: 'Software Engineer', match: 74, skills: 'Java, problem solving, Git', color: 'blue' },
  { name: 'Product Analyst', match: 68, skills: 'Analytics, communication, SQL', color: 'peach' },
];

const momentumCards = [
  { label: 'AI story edge', value: '7.4h', note: 'focus-time this week' },
  { label: 'Practice streak', value: '3 days', note: 'steady momentum' },
  { label: 'Shortlist signal', value: 'High', note: 'for analytics roles' },
];

type ProbabilityScenarioKey = 'stretch' | 'launch';

type ProbabilityComponentKey = 'resume' | 'roleFit' | 'assessments' | 'interviews' | 'profile';

type ProbabilityResult = {
  probability: number | null;
  confidence: 'Low' | 'Medium' | 'High';
  dataPoints: number;
  weightedScore: number | null;
  factors: Array<{ key: ProbabilityComponentKey; label: string; score: number; impact: number; reason: string }>;
};

type ProbabilitySnapshot = ProbabilityResult & {
  role: { id: string; name: string } | null;
  components: Record<ProbabilityComponentKey, number | null>;
};

type ProbabilitySimulation = {
  before: ProbabilityResult;
  after: ProbabilityResult;
  delta: number;
};

const probabilityScenarioOverrides: Record<ProbabilityScenarioKey, Partial<Record<ProbabilityComponentKey, number>>> = {
  stretch: { assessments: 85, interviews: 80 },
  launch: { resume: 90, roleFit: 90, assessments: 90, interviews: 90, profile: 90 },
};

const probabilityNextMoves: Record<ProbabilityComponentKey, { title: string; destination: string; buttonLabel: string }> = {
  resume: { title: 'Sharpen one project story', destination: 'My resume', buttonLabel: 'Open resume workspace' },
  roleFit: { title: 'Close a must-have skill gap', destination: 'Skill roadmap', buttonLabel: 'Open skill roadmap' },
  assessments: { title: 'Try a timed assessment', destination: 'Mock tests', buttonLabel: 'Open mock tests' },
  interviews: { title: 'Rehearse one role-specific answer', destination: 'Mock interviews', buttonLabel: 'Open mock interviews' },
  profile: { title: 'Complete your candidate profile', destination: 'My resume', buttonLabel: 'Open profile workspace' },
};

async function probabilityRequest<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.message ?? 'Placement probability could not be loaded.');
  return result as T;
}

function nullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeProbabilityResult(result: ProbabilityResult): ProbabilityResult {
  return {
    ...result,
    probability: nullableNumber(result.probability),
    dataPoints: Number(result.dataPoints),
    weightedScore: nullableNumber(result.weightedScore),
    factors: result.factors.map((factor) => ({
      ...factor,
      score: Number(factor.score),
      impact: Number(factor.impact),
    })),
  };
}

function ProbabilityForecastPanel({ accessToken, onNavigate }: { accessToken: string; onNavigate: (section: string) => void }) {
  const [snapshot, setSnapshot] = useState<ProbabilitySnapshot | null>(null);
  const [summary, setSummary] = useState<ProbabilityResult | null>(null);
  const [scenario, setScenario] = useState<ProbabilityScenarioKey | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    probabilityRequest<ProbabilitySnapshot>('/api/v1/me/placement-probability', accessToken)
      .then((result) => {
        if (!active) return;
        const normalized = {
          ...result,
          components: Object.fromEntries(Object.entries(result.components).map(([key, value]) => [key, nullableNumber(value)])) as Record<ProbabilityComponentKey, number | null>,
          ...normalizeProbabilityResult(result),
        };
        setSnapshot(normalized);
        setSummary(normalizeProbabilityResult(normalized));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Placement probability could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  async function simulate(key: ProbabilityScenarioKey) {
    setBusy(true);
    setError('');
    setScenario(key);
    try {
      const result = await probabilityRequest<ProbabilitySimulation>('/api/v1/me/placement-probability/simulate', accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(probabilityScenarioOverrides[key]),
      });
      const normalized = {
        ...result,
        before: normalizeProbabilityResult(result.before),
        after: normalizeProbabilityResult(result.after),
        delta: Number(result.delta),
      };
      setSummary(normalized.after);
      setScenario(key);
      setDelta(Number.isFinite(normalized.delta) ? normalized.delta : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The scenario could not be simulated.');
    } finally {
      setBusy(false);
    }
  }

  const ringStyle = {
    background: `conic-gradient(#2d7251 ${(summary?.probability ?? 0) * 3.6}deg, #edf1eb 0deg)`,
  };
  const weakestFactor = summary?.factors.reduce((weakest, factor) => factor.score < weakest.score ? factor : weakest);

  return (
    <article className="panel probability-panel">
      <div className="section-heading">
        <div>
          <div className="section-kicker">RULE-BASED PLACEMENT ESTIMATE</div>
          <h2>{snapshot?.role?.name ?? 'Shortlist outlook'}</h2>
        </div>
        <span className="pulse-badge">Practice signal</span>
      </div>

      {loading && <div className="workspace-loading" role="status">Loading placement estimate</div>}
      {error && <div className="resume-error" role="alert">{error}</div>}

      <div className="probability-body">
        <div className="probability-ring" style={ringStyle}>
          <div className="probability-ring-inner">
            <strong>{summary?.probability ?? '—'}</strong>
            {summary?.probability !== null && summary?.probability !== undefined && <small>%</small>}
          </div>
        </div>

        <div className="probability-copy">
          <div className="probability-meta">
            <span className="probability-tag">{summary ? `${summary.confidence} confidence` : 'Confidence unavailable'}</span>
            {delta !== null && <span className="probability-trend">{delta >= 0 ? '+' : ''}{delta.toFixed(1)} pts vs current</span>}
          </div>
          <p>{summary ? `${summary.dataPoints} of 5 signals available. This is a practice estimate, not a placement guarantee.` : 'Loading candidate signals.'}</p>

          <div className="projection-buttons" aria-label="Scenario selector">
            {(['stretch', 'launch'] as ProbabilityScenarioKey[]).map((key) => (
              <button
                key={key}
                className={scenario === key ? 'is-active' : ''}
                disabled={loading || busy || !snapshot?.dataPoints}
                onClick={() => { void simulate(key); }}
                type="button"
              >
                {busy && scenario === key ? 'Calculating' : key === 'stretch' ? 'Stretch' : 'Launch'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {snapshot?.dataPoints === 0 && !loading && <p role="status">No scores yet. Run a resume analysis, mock assessment, or interview to start building an estimate.</p>}

      <div className="probability-factors" aria-label="Probability factor breakdown">
        {(summary?.factors ?? []).map((factor) => (
          <div key={factor.key} className="probability-factor-row">
            <div className="probability-factor-meta">
              <span>{factor.label}</span>
              <strong>{factor.score}%</strong>
            </div>
            <div className="probability-factor-track">
              <span style={{ width: `${factor.score}%` }} />
            </div>
          </div>
        ))}
      </div>

      {weakestFactor && (
        <div className="probability-next-move">
          <span className="next-move-icon"><Sparkles size={15} /></span>
          <div className="next-move-copy">
            <span className="section-kicker">SIGNAL TO LIFT · {weakestFactor.label}</span>
            <strong>{probabilityNextMoves[weakestFactor.key].title}</strong>
            <p>{weakestFactor.reason}</p>
          </div>
          <button
            aria-label={probabilityNextMoves[weakestFactor.key].buttonLabel}
            onClick={() => onNavigate(probabilityNextMoves[weakestFactor.key].destination)}
            title={probabilityNextMoves[weakestFactor.key].buttonLabel}
            type="button"
          >
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </article>
  );
}

type DashboardProps = {
  accessToken: string;
  user: SessionUser;
  onSignOut: () => void;
};

function CandidateDashboard({ accessToken, user, onSignOut }: DashboardProps) {
  const [active, setActive] = useState('Overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [completedActions, setCompletedActions] = useState<string[]>([]);

  function toggleAction(label: string) {
    setCompletedActions((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={() => setActive('Overview')}>
          <span className="brand-mark"><GraduationCap size={19} strokeWidth={2.2} /></span>
          <span>placeprep<span className="brand-ai">.ai</span></span>
        </a>
        <div className="workspace-label">CANDIDATE SPACE</div>
        <div className="profile-switcher">
          <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
          <span className="profile-copy"><strong>{user.name}</strong><small>{user.email}</small></span>
          <ChevronDown size={15} />
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <button
              className={`nav-item ${active === label ? 'nav-item-active' : ''}`}
              key={label}
              onClick={() => { setActive(label); setMenuOpen(false); }}
              type="button"
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {label === 'Mock tests' && <span className="nav-count">2</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="week-card">
            <div className="week-top"><span className="week-icon"><TrendingUp size={15} /></span><span>THIS WEEK</span></div>
            <strong>3 day streak</strong>
            <p>A little practice goes a long way.</p>
            <div className="streak-dots" aria-label="Three practice days this week">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
                <span className={index < 3 ? 'streak-done' : ''} key={`${day}-${index}`}>{day}</span>
              ))}
            </div>
          </div>
          <button className="nav-item muted-nav" type="button" onClick={() => setActive('Settings')}><Settings2 size={17} /><span>Settings</span></button>
          <button className="nav-item muted-nav" type="button" onClick={() => setActive('Help center')}><CircleHelp size={17} /><span>Help center</span></button>
          <div className="sidebar-footnote">A clearer path to your next role.</div>
        </div>
      </aside>

      {menuOpen && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMenuOpen(false)} type="button" />}

      <main className="main-content">
        <header className="topbar">
          <button aria-label={menuOpen ? 'Close menu' : 'Open menu'} className="icon-button menu-toggle" onClick={() => setMenuOpen(!menuOpen)} type="button">
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="breadcrumb"><span>My workspace</span><span className="crumb-divider">/</span><strong>{active}</strong></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={15} /><input aria-label="Search" placeholder="Search anything" /></label>
            <button aria-label="Notifications" className="icon-button notification-button" type="button"><Bell size={18} /><i /></button>
            <button className="top-avatar" aria-label="Sign out" onClick={onSignOut} type="button">{user.name.slice(0, 2).toUpperCase()}</button>
          </div>
        </header>

        <div className="page-content">
          {active === 'Explore jobs' ? <CandidateJobsWorkspace accessToken={accessToken} onNavigate={setActive} /> : active === 'My resume' ? <ResumeWorkspace accessToken={accessToken} /> : active === 'Role matches' ? <RoleWorkspace accessToken={accessToken} view="roles" /> : active === 'Skill roadmap' ? <RoleWorkspace accessToken={accessToken} view="roadmap" /> : active === 'Mock tests' ? <AssessmentWorkspace accessToken={accessToken} /> : active === 'Mock interviews' ? <InterviewWorkspace accessToken={accessToken} /> : active === 'Placement probability' ? <ProbabilityForecastPanel accessToken={accessToken} onNavigate={setActive} /> : <>
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> WEDNESDAY, SEPTEMBER 30</div>
              <h1>Good morning, {user.name.split(' ')[0]}<span className="wave">.</span></h1>
              <p className="welcome-subtitle">You’re building momentum. Here’s where things stand.</p>
            </div>
            <button className="date-button" type="button"><CalendarDays size={16} /> This week <ChevronDown size={14} /></button>
          </section>

          <div className="demo-data-notice"><strong>DEMO DASHBOARD</strong><span>Metrics below are sample data until your profile is connected.</span></div>
          <section aria-label="Placement preparation overview" className="metrics-grid">
            <article className="metric-card resume-metric">
              <div className="metric-head"><span>RESUME HEALTH</span><span className="metric-icon resume-icon"><FileText size={16} /></span></div>
              <div className="score-line"><strong>76</strong><span>/ 100</span><span className="trend-pill"><ArrowDownRight size={13} /> 4 pts</span></div>
              <div className="progress-track"><span style={{ width: '76%' }} /></div>
              <div className="metric-foot"><span>Almost ready</span><button onClick={() => setActive('My resume')} type="button">View report <ArrowRight size={13} /></button></div>
            </article>
            <article className="metric-card readiness-metric">
              <div className="metric-head"><span>INTERVIEW READINESS</span><span className="metric-icon readiness-icon"><Mic2 size={16} /></span></div>
              <div className="score-line"><strong>Getting</strong></div>
              <div className="readiness-label"><span className="status-dot" /> There’s room to grow</div>
              <div className="metric-foot"><span>2 areas to work on</span><button onClick={() => setActive('Practice')} type="button">See next steps <ArrowRight size={13} /></button></div>
            </article>
            <article className="metric-card probability-metric">
              <div className="metric-head"><span>ROLE FIT · DATA ANALYST</span><span className="metric-icon probability-icon"><Target size={16} /></span></div>
              <div className="score-line"><strong>82<span className="score-percent">%</span></strong><span className="trend-pill positive-pill"><TrendingUp size={13} /> +6%</span></div>
              <div className="metric-foot probability-foot"><span>Good alignment so far</span><button onClick={() => setActive('Placement probability')} type="button">Explore forecast <ArrowRight size={13} /></button></div>
              <div className="metric-disclaimer">Illustrative fit estimate, not a placement guarantee.</div>
            </article>
          </section>

          <section className="pulse-layout">
            <ProbabilityForecastPanel accessToken={accessToken} onNavigate={setActive} />

            <aside className="panel coach-panel">
              <div className="section-kicker">NEXT AI NUDGE</div>
              <h2>Publish an interview-ready project</h2>
              <ul className="coach-list">
                <li>Showcase measurable impact in one backend feature.</li>
                <li>Document your architecture and trade-offs clearly.</li>
                <li>Prepare a 90-second story for the strongest project.</li>
              </ul>
              <button className="practice-button coach-button" onClick={() => setActive('My resume')} type="button">Upgrade my project story <ArrowRight size={15} /></button>
            </aside>
          </section>

          <div className="content-grid">
            <section className="panel actions-panel">
              <div className="section-heading"><div><div className="section-kicker">YOUR NEXT MOVES</div><h2>Small steps, real progress</h2></div><span className="action-counter">{completedActions.length}/{actions.length} done</span></div>
              <div className="action-list">
                {actions.map(({ label, type, icon: Icon }) => {
                  const done = completedActions.includes(label);
                  return (
                    <button className={`action-row ${done ? 'action-complete' : ''}`} key={label} onClick={() => toggleAction(label)} type="button">
                      <span className="action-check">{done && <span />}</span>
                      <span className="action-icon"><Icon size={17} /></span>
                      <span className="action-copy"><strong>{label}</strong><small>{type}</small></span>
                      <ArrowRight className="action-arrow" size={16} />
                    </button>
                  );
                })}
              </div>
              <button className="text-link" onClick={() => setActive('Skill roadmap')} type="button">View your full roadmap <ArrowRight size={14} /></button>
            </section>

            <section className="panel roles-panel">
              <div className="section-heading"><div><div className="section-kicker">BASED ON YOUR PROFILE</div><h2>Roles taking shape</h2></div><button className="round-arrow" aria-label="Explore all roles" onClick={() => setActive('Role matches')} type="button"><ArrowRight size={16} /></button></div>
              <div className="role-list">
                {roles.map((role, index) => (
                  <button className="role-row" key={role.name} onClick={() => setActive('Role matches')} type="button">
                    <span className={`role-rank rank-${index + 1}`}>0{index + 1}</span>
                    <span className="role-details"><strong>{role.name}</strong><small>{role.skills}</small></span>
                    <span className={`match-pill ${role.color}`}>{role.match}%</span>
                  </button>
                ))}
              </div>
              <div className="roles-note"><Sparkles size={14} /><span>Build one deployed project to strengthen your top match.</span></div>
            </section>
          </div>

          <section className="spotlight-grid" aria-label="Career momentum overview">
            <article className="panel spotlight-card spotlight-card-emerald">
              <div className="spotlight-header">
                <div>
                  <div className="section-kicker">PLACEMENT SIGNAL</div>
                  <h2>Momentum engine</h2>
                </div>
                <span className="spotlight-badge">Live</span>
              </div>
              <div className="spotlight-body">
                <div className="mini-ring" aria-label="Placement growth index">
                  <span className="mini-ring-core"><strong>24</strong><small>pts</small></span>
                </div>
                <div className="spotlight-copy">
                  <p>Your profile is moving faster than last week. One more polished project could convert this into a strong shortlist signal.</p>
                  <div className="chip-stack">
                    <span>SQL</span>
                    <span>Storytelling</span>
                    <span>Projects</span>
                  </div>
                </div>
              </div>
            </article>

            <article className="panel spotlight-card spotlight-card-sand">
              <div className="spotlight-header">
                <div>
                  <div className="section-kicker">AI COACH</div>
                  <h2>Today’s spark</h2>
                </div>
              </div>
              <div className="momentum-grid">
                {momentumCards.map(({ label, value, note }) => (
                  <div className="momentum-tile" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{note}</small>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="practice-strip">
            <div className="practice-art"><span className="art-ring ring-one" /><span className="art-ring ring-two" /><span className="art-star"><Sparkles size={18} /></span><span className="art-dot dot-one" /><span className="art-dot dot-two" /></div>
            <div className="practice-copy"><span className="section-kicker">YOUR PRACTICE, YOUR PACE</span><h2>Ready for a quick win?</h2><p>Pick up where you left off with a short SQL practice set.</p></div>
            <button className="practice-button" onClick={() => setActive('Mock tests')} type="button">Continue practicing <ArrowRight size={15} /></button>
          </section>

          <footer className="page-footer"><span>PlacePrep AI <span className="footer-separator">·</span> Your progress belongs to you.</span><button onClick={() => setActive('Privacy & consent')} type="button">Privacy & consent</button></footer>
          </>}
        </div>
      </main>
    </div>
  );
}

function RecruiterDashboard({ accessToken, user, onSignOut }: DashboardProps) {
  return <div className="app-shell recruiter-shell">
    <header className="recruiter-topbar"><a className="brand" href="#jobs"><span className="brand-mark"><GraduationCap size={19} strokeWidth={2.2} /></span><span>placeprep<span className="brand-ai">.ai</span></span></a><span className="recruiter-account">{user.name} · Recruiter</span><button className="top-avatar" aria-label="Sign out" onClick={onSignOut} type="button">{user.name.slice(0, 2).toUpperCase()}</button></header>
    <main className="recruiter-main"><RecruiterJobsWorkspace accessToken={accessToken} /></main>
  </div>;
}

function App() {
  const [session, setSession] = useState<{ accessToken: string; user: SessionUser } | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      if (localStorage.getItem('placeprep_has_session') !== 'true') {
        setCheckingSession(false);
        return;
      }
      try {
        const response = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!response.ok) {
          localStorage.removeItem('placeprep_has_session');
          return;
        }
        const result = await response.json() as { accessToken?: string; user?: SessionUser };
        if (!result.accessToken || !result.user) return;
        const profileResponse = await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${result.accessToken}` },
          credentials: 'include',
        });
        if (!profileResponse.ok) return;
        const profile = await profileResponse.json() as { roles?: string[] };
        if (active) setSession({ accessToken: result.accessToken, user: { ...result.user, roles: profile.roles } });
      } catch {
        if (active) setSession(null);
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    void restoreSession();
    return () => { active = false; };
  }, []);

  async function signOut() {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      localStorage.removeItem('placeprep_has_session');
      setSession(null);
    }
  }

  if (checkingSession) {
    return <main className="session-loading" aria-label="Checking your session"><span /></main>;
  }
  if (!session) {
    return <AuthPage onAuthenticated={(accessToken, user) => {
      localStorage.setItem('placeprep_has_session', 'true');
      setSession({ accessToken, user });
    }} />;
  }
  if (session.user.roles?.includes('recruiter')) {
    return <RecruiterDashboard accessToken={session.accessToken} user={session.user} onSignOut={() => { void signOut(); }} />;
  }
  return <CandidateDashboard accessToken={session.accessToken} user={session.user} onSignOut={() => { void signOut(); }} />;
}

export default App;