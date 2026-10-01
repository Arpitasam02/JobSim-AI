import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BrainCircuit, CheckCircle2, CircleDot, LoaderCircle, MessageSquareText, Plus, Sparkles, Target, Trophy } from 'lucide-react';

type InterviewKind = 'hr_behavioral' | 'technical' | 'project_deep_dive' | 'managerial' | 'case_situational' | 'full_simulation';
type Role = { id: string; name: string };
type InterviewSummary = { id: string; interview_type: InterviewKind; mode: string; difficulty: string; status: string; started_at: string; finished_at: string | null; role_name: string | null; question_count: number };
type EvaluatedQuestion = { questionId: string; question: string; score: number; rubric: Record<string, number>; evidence: string; strengths: string[]; improvement: string; modelAnswerOutline: string };
type InterviewSession = { session: { id: string; status: string }; currentQuestion: { id: string; question: string; position: number } | null; answers: Array<{ questionId: string; question: string; answer: string; answeredAt: string }> };
type InterviewReport = { report: { overall_score: number; rubric: { modelVersion: string; questions: EvaluatedQuestion[] }; strengths: string[]; improvements: string[]; shortlist_recommendation: 'Likely' | 'Borderline' | 'Unlikely' } };

type Props = { accessToken: string };

const interviewKinds: Array<{ value: InterviewKind; label: string; description: string }> = [
  { value: 'technical', label: 'Technical', description: 'Reason through role-specific concepts and tradeoffs.' },
  { value: 'project_deep_dive', label: 'Project deep-dive', description: 'Explain the work and decisions behind your resume.' },
  { value: 'hr_behavioral', label: 'HR & behavioral', description: 'Practice clear stories about collaboration and growth.' },
  { value: 'case_situational', label: 'Situational case', description: 'Make a plan when the brief is incomplete.' },
  { value: 'managerial', label: 'Managerial', description: 'Work through feedback, alignment, and ownership.' },
  { value: 'full_simulation', label: 'Full simulation', description: 'Move between behavioral, project, and technical prompts.' },
];

const rubricLabels: Record<string, string> = {
  technicalCorrectness: 'Technical accuracy',
  depthOfKnowledge: 'Depth',
  problemSolving: 'Problem solving',
  communicationClarity: 'Clarity',
  answerStructure: 'Structure',
  relevanceAndConciseness: 'Relevance',
  projectOwnership: 'Ownership',
};

async function request<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.message ?? 'Request failed.');
  return result as T;
}

function normalizeReport(result: InterviewReport): InterviewReport['report'] {
  return {
    ...result.report,
    overall_score: Number(result.report.overall_score),
    rubric: {
      ...result.report.rubric,
      questions: result.report.rubric.questions.map((question) => ({
        ...question,
        score: Number(question.score),
        rubric: Object.fromEntries(Object.entries(question.rubric).map(([key, value]) => [key, Number(value)])),
      })),
    },
  };
}

function SignalBars({ rubric }: { rubric: Record<string, number> }) {
  return <div className="interview-signal-bars">
    {Object.entries(rubricLabels).map(([key, label]) => {
      const value = rubric[key] ?? 1;
      return <div className="interview-signal-row" key={key}>
        <span>{label}</span><div className="interview-signal-track"><i style={{ width: `${value * 10}%` }} /></div><b>{value}</b>
      </div>;
    })}
  </div>;
}

export default function InterviewWorkspace({ accessToken }: Props) {
  const [interviews, setInterviews] = useState<InterviewSummary[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [kind, setKind] = useState<InterviewKind>('technical');
  const [roleId, setRoleId] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [report, setReport] = useState<InterviewReport['report'] | null>(null);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadInterviews() {
    const result = await request<{ interviews: InterviewSummary[] }>('/api/v1/interviews', accessToken);
    setInterviews(result.interviews ?? []);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      request<{ interviews: InterviewSummary[] }>('/api/v1/interviews', accessToken),
      request<{ roles: Role[] }>('/api/v1/roles', accessToken).catch(() => ({ roles: [] })),
    ]).then(([interviewResult, roleResult]) => {
      if (!active) return;
      setInterviews(interviewResult.interviews ?? []);
      setRoles(roleResult.roles ?? []);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Interview workspace could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  async function openInterview(sessionId: string, count = 0) {
    setBusy(true);
    setError('');
    try {
      const snapshot = await request<InterviewSession>(`/api/v1/interviews/${sessionId}`, accessToken);
      setSession(snapshot);
      setQuestionCount(count || snapshot.answers.length + (snapshot.currentQuestion ? 1 : 0));
      setAnswer('');
      setReport(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Interview could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  async function startInterview() {
    setBusy(true);
    setError('');
    try {
      const created = await request<{ sessionId: string; questionCount: number }>('/api/v1/interviews', accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, mode: 'text', roleId: roleId || undefined, difficulty }),
      });
      setQuestionCount(created.questionCount);
      await openInterview(created.sessionId, created.questionCount);
      await loadInterviews();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Interview could not be started.');
    } finally {
      setBusy(false);
    }
  }

  async function saveAnswer() {
    const question = session?.currentQuestion;
    if (!session || !question || !answer.trim()) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/v1/interviews/${session.session.id}/answer`, accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, answer: answer.trim() }),
      });
      await openInterview(session.session.id, questionCount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your response could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function finishInterview() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/v1/interviews/${session.session.id}/finish`, accessToken, { method: 'POST' });
      const result = await request<InterviewReport>(`/api/v1/interviews/${session.session.id}/report`, accessToken);
      setReport(normalizeReport(result));
      setSession(null);
      await loadInterviews();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The interview could not be finished.');
    } finally {
      setBusy(false);
    }
  }

  async function openReport(sessionId: string) {
    setBusy(true);
    setError('');
    try {
      const result = await request<InterviewReport>(`/api/v1/interviews/${sessionId}/report`, accessToken);
      setReport(normalizeReport(result));
      setSession(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Report could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  const completedCount = interviews.filter((item) => item.status === 'completed').length;
  const answeredCount = session?.answers.length ?? 0;

  if (loading) return <div className="workspace-loading"><LoaderCircle className="spinner" size={18} />Loading interview workspace</div>;

  if (report) {
    const questions = report.rubric.questions ?? [];
    const averageRubric = Object.fromEntries(Object.keys(rubricLabels).map((key) => {
      const values = questions.map((item) => item.rubric[key]).filter((value): value is number => typeof value === 'number');
      return [key, values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 1];
    }));
    const score = Math.round(report.overall_score * 10);
    return <section className="interview-workspace">
      <button className="text-link" onClick={() => { setReport(null); void loadInterviews(); }} type="button"><ArrowLeft size={14} /> Back to practice</button>
      <div className="interview-report-hero">
        <div className="interview-report-copy"><div className="section-kicker">YOUR ANSWER SIGNALS</div><h1>A clearer read on your interview.</h1><p>Feedback is based on your recorded answers and their evidence. Treat it as practice guidance, not a hiring decision.</p></div>
        <div className="interview-score-dial" style={{ '--score-angle': `${score * 3.6}deg` } as React.CSSProperties}><div><strong>{report.overall_score.toFixed(1)}</strong><span>out of 10</span></div></div>
      </div>
      <div className="interview-report-grid">
        <section className="panel interview-signal-panel"><div className="section-heading"><div><div className="section-kicker">SIGNAL MAP</div><h2>How your answers landed</h2></div><BrainCircuit size={19} /></div><SignalBars rubric={averageRubric} /><div className={`interview-recommendation recommendation-${report.shortlist_recommendation.toLowerCase()}`}><Target size={17} /><span><small>PRACTICE INDICATOR</small><strong>{report.shortlist_recommendation}</strong></span><span>Rule-based estimate</span></div></section>
        <section className="panel interview-takeaways-panel"><div className="section-kicker">KEEP BUILDING</div><h2>Patterns worth carrying forward</h2><div className="interview-takeaway-group"><strong><CheckCircle2 size={15} /> Strengths</strong>{report.strengths.length ? report.strengths.map((item) => <p key={item}>{item}</p>) : <p>Your next answer can establish the first clear strength.</p>}</div><div className="interview-takeaway-group"><strong><Sparkles size={15} /> Next experiments</strong>{report.improvements.length ? report.improvements.map((item) => <p key={item}>{item}</p>) : <p>Keep practicing with new examples and technical details.</p>}</div></section>
      </div>
      <section className="interview-evidence-section"><div className="section-heading"><div><div className="section-kicker">ANSWER-BY-ANSWER</div><h2>Evidence, not just a score</h2></div><span>{questions.length} prompts</span></div><div className="interview-evidence-list">{questions.map((item, index) => <article className="panel interview-evidence-card" key={item.questionId}><div className="interview-evidence-head"><span>0{index + 1} <i /> RESPONSE SIGNAL</span><strong>{item.score}<small>/10</small></strong></div><h3>{item.question}</h3><blockquote>{item.evidence}</blockquote>{item.strengths.map((strength) => <div className="interview-evidence-strength" key={strength}><CheckCircle2 size={14} />{strength}</div>)}<div className="interview-improvement"><Sparkles size={14} /><span><strong>Try next:</strong> {item.improvement}</span></div><details><summary>Model answer outline</summary><p>{item.modelAnswerOutline}</p></details></article>)}</div></section>
      <p className="interview-model-note">Evaluation method: {report.rubric.modelVersion}. Scores are heuristic signals, not a measure of your worth or a promise of selection.</p>
      <button className="practice-button interview-new-button" onClick={() => setReport(null)} type="button"><Plus size={15} /> Start another practice</button>
    </section>;
  }

  if (session) {
    const question = session.currentQuestion;
    const progress = questionCount ? Math.round((answeredCount / questionCount) * 100) : 0;
    return <section className="interview-workspace">
      <button className="text-link" onClick={() => { setSession(null); setError(''); void loadInterviews(); }} type="button"><ArrowLeft size={14} /> All practice sessions</button>
      <div className="interview-live-head"><div><div className="section-kicker">TEXT INTERVIEW · {difficulty.toUpperCase()} PRACTICE</div><h1>{question ? 'Take a moment. Then make it yours.' : 'You’ve answered every prompt.'}</h1><p>{question ? 'Use your own experience. There is no timer, and your draft stays in the box until you send it.' : 'Your final answer is safely recorded. Generate the answer report when you are ready.'}</p></div><div className="interview-live-count"><strong>{Math.min(answeredCount + (question ? 1 : 0), questionCount || 1).toString().padStart(2, '0')}</strong><span>/ {questionCount.toString().padStart(2, '0')} prompts</span></div></div>
      <div className="interview-progress-track" aria-label={`${progress}% complete`}><i style={{ width: `${progress}%` }} /></div>
      {error && <div className="resume-error" role="alert">{error}</div>}
      {question ? <div className="interview-live-grid"><section className="panel interview-prompt-panel"><div className="interview-prompt-meta"><span><CircleDot size={13} /> QUESTION {String(question.position + 1).padStart(2, '0')}</span><span>Take your time</span></div><h2>{question.question}</h2><label className="interview-answer-label" htmlFor="interview-answer">Your response</label><textarea id="interview-answer" maxLength={20000} onChange={(event) => setAnswer(event.target.value)} placeholder="Start with the context. What did you do, why did you choose it, and what happened next?" value={answer} /><div className="interview-answer-foot"><span>{answer.length.toLocaleString()} / 20,000</span><button className="practice-button" disabled={!answer.trim() || busy} onClick={() => { void saveAnswer(); }} type="button">Save & continue <ArrowRight size={15} /></button></div></section><aside className="interview-coach-rail"><div className="interview-coach-icon"><MessageSquareText size={18} /></div><div className="section-kicker">A THOUGHTFUL ANSWER</div><h3>Show your fingerprints.</h3><p>Make your own decisions visible. A small, true detail beats a polished answer that could belong to anyone.</p><ol><li><span>01</span>Context</li><li><span>02</span>Your action</li><li><span>03</span>What changed</li></ol><div className="interview-coach-note"><Sparkles size={14} /> Metrics are useful only when they are real.</div></aside></div> : <section className="panel interview-finish-panel"><div className="interview-finish-mark"><Trophy size={21} /></div><div><h2>Ready to see the signal?</h2><p>Your report includes evidence quotes, strengths, and one practical next step for each answer.</p></div><button className="practice-button" disabled={busy} onClick={() => { void finishInterview(); }} type="button">Build my report <ArrowRight size={15} /></button></section>}
    </section>;
  }

  return <section className="interview-workspace">
    <div className="interview-page-heading"><div><div className="section-kicker">MOCK INTERVIEW STUDIO</div><h1>Practice the story behind your skills.</h1><p>Short, resume-aware text sessions. Your answers stay yours; the feedback points to evidence, not invented credentials.</p></div><div className="interview-studio-mark"><BrainCircuit size={25} /><span>PLACEPREP<br />PRACTICE LAB</span></div></div>
    {error && <div className="resume-error" role="alert">{error}</div>}
    <div className="interview-start-grid"><section className="panel interview-setup-panel"><div className="section-heading"><div><div className="section-kicker">BUILD A PRACTICE SESSION</div><h2>Choose your room</h2></div><span className="interview-private-label">PRIVATE</span></div><div className="interview-kind-grid">{interviewKinds.map((item) => <button aria-pressed={kind === item.value} className={`interview-kind-option ${kind === item.value ? 'kind-selected' : ''}`} key={item.value} onClick={() => setKind(item.value)} type="button"><span className="kind-dot" /><strong>{item.label}</strong><small>{item.description}</small></button>)}</div><div className="interview-setup-fields"><label>Target role<select onChange={(event) => setRoleId(event.target.value)} value={roleId}><option value="">General practice</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label>Difficulty<select onChange={(event) => setDifficulty(event.target.value as typeof difficulty)} value={difficulty}><option value="easy">Warm-up</option><option value="medium">Focused</option><option value="hard">Stretch</option></select></label></div><button className="practice-button interview-start-button" disabled={busy} onClick={() => { void startInterview(); }} type="button">{busy ? <LoaderCircle className="spinner" size={15} /> : <Plus size={15} />} Start a text interview <ArrowRight size={15} /></button><p className="interview-setup-note">Text mode is available now. Voice and video practice are not enabled yet.</p></section><aside className="interview-studio-aside"><div className="interview-aside-number">{completedCount.toString().padStart(2, '0')}</div><div className="section-kicker">SESSIONS COMPLETED</div><h2>Progress comes from specifics.</h2><p>Try one answer twice: first naturally, then with a clearer context, decision, and outcome.</p><div className="interview-aside-rule" /><div className="interview-aside-footer"><Sparkles size={15} /><span>Private practice.<br />Honest feedback.</span></div></aside></div>
    <div className="interview-history-heading"><div><div className="section-kicker">YOUR PRACTICE LOG</div><h2>Recent sessions</h2></div><span>{interviews.length} total</span></div>
    {interviews.length ? <div className="interview-history-list">{interviews.map((item) => <article className="panel interview-history-card" key={item.id}><div className={`interview-history-icon ${item.status === 'completed' ? 'history-complete' : ''}`}>{item.status === 'completed' ? <CheckCircle2 size={17} /> : <MessageSquareText size={17} />}</div><div className="interview-history-copy"><strong>{interviewKinds.find((choice) => choice.value === item.interview_type)?.label ?? 'Practice interview'}</strong><span>{item.role_name ?? 'General practice'} · {item.difficulty} · {new Date(item.started_at).toLocaleDateString()}</span></div><span className={`interview-status ${item.status === 'completed' ? 'status-complete' : ''}`}>{item.status === 'completed' ? 'Report ready' : 'In progress'}</span>{item.status === 'completed' ? <button aria-label="Open interview report" className="round-arrow" onClick={() => { void openReport(item.id); }} type="button"><ArrowRight size={16} /></button> : <button className="date-button" onClick={() => { void openInterview(item.id, item.question_count); }} type="button">Resume <ArrowRight size={14} /></button>}</article>)}</div> : <div className="interview-empty-state"><span><MessageSquareText size={19} /></span><div><strong>Your practice log starts here.</strong><p>Complete a session and your answer patterns will be ready to revisit.</p></div></div>}
    <div className="interview-privacy-note"><Target size={14} /> Practice recommendations are heuristic guidance, not hiring decisions. No protected traits are used.</div>
    {busy && <span className="interview-busy-indicator" role="status"><LoaderCircle className="spinner" size={14} />Working</span>}
  </section>;
}