import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, LoaderCircle, ShieldCheck } from 'lucide-react';

type Assessment = { id: string; title: string; description: string; duration_seconds: number; question_count: number; passing_score: number | null; latest_attempt?: { id: string; status: string; score: number | null } | null };
type Question = { id: string; prompt: string; options: string[]; topic: string; difficulty: string; marks: number };
type SavedAnswer = { question_id: string; answer: { index: number } | null; marked_for_review: boolean; time_spent_seconds: number };
type Attempt = { attemptId: string; title: string; status: string; deadlineAt: string; serverTime: string; questions: Question[]; answers: SavedAnswer[] };
type Report = { attempt: { title: string; total_score: number; submitted_at: string }; score: number; topicBreakdown: Array<{ topic: string; correct: number; total: number; accuracy: number }>; answerReview: Array<{ id: string; prompt: string; options: string[]; topic: string; answer: { index: number } | null; correctAnswer: { index: number } | null; isCorrect: boolean | null; explanation: string; timeSpentSeconds: number }> };

type Props = { accessToken: string };

async function request(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) } });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.message ?? 'Request failed.');
  return result;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}

export default function AssessmentWorkspace({ accessToken }: Props) {
  const [tests, setTests] = useState<Assessment[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [answers, setAnswers] = useState<Record<string, SavedAnswer>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    request('/api/v1/tests', accessToken).then((result) => {
      if (active) setTests(result.tests ?? []);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Tests could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress') return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(attempt.deadlineAt).getTime() - (Date.now() + serverOffset)) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) void finishAttempt();
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [attempt?.attemptId, attempt?.deadlineAt, attempt?.status, serverOffset]);

  async function startTest(test: Assessment) {
    setLoading(true);
    setError('');
    try {
      const started = await request(`/api/v1/tests/${test.id}/start`, accessToken, { method: 'POST' });
      const snapshot = await request(`/api/v1/tests/attempts/${started.attemptId}`, accessToken);
      setServerOffset(snapshot.serverTime ? new Date(snapshot.serverTime).getTime() - Date.now() : 0);
      const restored: Record<string, SavedAnswer> = {};
      for (const answer of snapshot.answers ?? []) restored[answer.question_id] = answer;
      setAnswers(restored);
      setActiveIndex(0);
      setAttempt(snapshot as Attempt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Test could not be started.');
    } finally {
      setLoading(false);
    }
  }

  async function saveAnswer(question: Question, answer: SavedAnswer) {
    setAnswers((current) => ({ ...current, [question.id]: answer }));
    setSaving(true);
    try {
      await request(`/api/v1/tests/attempts/${attempt?.attemptId}/answers`, accessToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: question.id, answer: answer.answer, markedForReview: answer.marked_for_review, timeSpentSeconds: answer.time_spent_seconds }] }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your answer could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function finishAttempt() {
    if (!attempt || attempt.status !== 'in_progress') return;
    setAttempt({ ...attempt, status: 'submitting' });
    try {
      await request(`/api/v1/tests/attempts/${attempt.attemptId}/submit`, accessToken, { method: 'POST' });
      const result = await request(`/api/v1/tests/attempts/${attempt.attemptId}/report`, accessToken);
      setReport(result as Report);
      setAttempt(null);
    } catch (cause) {
      setAttempt({ ...attempt, status: 'in_progress' });
      setError(cause instanceof Error ? cause.message : 'The test could not be submitted.');
    }
  }

  async function openReport(attemptId: string) {
    setLoading(true);
    setError('');
    try {
      const result = await request(`/api/v1/tests/attempts/${attemptId}/report`, accessToken);
      setReport(result as Report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Report could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  const activeQuestion = attempt?.questions[activeIndex];
  const activeAnswer = activeQuestion ? answers[activeQuestion.id] : undefined;
  const answeredCount = Object.values(answers).filter((answer) => answer.answer !== null).length;

  if (loading) return <div className="workspace-loading"><LoaderCircle className="spinner" size={18} />Loading assessment workspace</div>;
  if (error && !attempt && !report) return <div className="resume-error" role="alert">{error}</div>;

  if (report) return <section className="assessment-workspace">
    <div className="assessment-page-heading"><button className="text-link" onClick={() => setReport(null)} type="button"><ArrowLeft size={14} /> Back to tests</button><div className="section-kicker">ASSESSMENT REPORT</div><h1>{report.attempt.title}</h1></div>
    <section className="panel assessment-report-panel"><div className="assessment-score-summary"><strong>{Math.round(report.score)}<small>%</small></strong><span>{report.topicBreakdown.filter((topic) => topic.accuracy < 60).length ? 'A few topics need practice' : 'Strong result'}</span></div><div className="section-heading"><div><div className="section-kicker">TOPIC ACCURACY</div><h2>Where to focus next</h2></div></div>{report.topicBreakdown.map((topic) => <div className="assessment-topic-row" key={topic.topic}><span>{topic.topic}</span><strong>{topic.correct}/{topic.total}</strong><b>{Math.round(topic.accuracy)}%</b></div>)}<div className="section-heading assessment-review-heading"><div><div className="section-kicker">ANSWER REVIEW</div><h2>Questions and explanations</h2></div></div>{report.answerReview.map((item, index) => <article className="assessment-review-item" key={item.id}><div className="assessment-review-title"><span>Q{index + 1} · {item.topic}</span><strong className={item.isCorrect ? 'answer-correct' : 'answer-incorrect'}>{item.isCorrect === null ? 'Not answered' : item.isCorrect ? 'Correct' : 'Incorrect'}</strong></div><p>{item.prompt}</p>{item.options.map((option, optionIndex) => <span className={`review-option ${item.correctAnswer?.index === optionIndex ? 'review-correct' : item.answer?.index === optionIndex ? 'review-incorrect' : ''}`} key={`${item.id}-${optionIndex}`}>{String.fromCharCode(65 + optionIndex)}. {option}</span>)}<small>{item.explanation}</small></article>)}</section>
  </section>;

  if (attempt && activeQuestion) return <section className="assessment-workspace">
    <div className="assessment-live-header"><div><div className="section-kicker">TIMED ASSESSMENT</div><h1>{attempt.title}</h1></div><div className={`assessment-timer ${remainingSeconds < 60 ? 'timer-warning' : ''}`}><Clock3 size={16} /><strong>{formatTime(remainingSeconds)}</strong></div></div>
    <div className="assessment-live-meta"><span><ShieldCheck size={14} /> Timer uses the server deadline and survives refresh.</span><span>{saving ? <><LoaderCircle className="spinner" size={13} />Saving</> : <><Check size={13} />Saved</>}</span></div>
    {error && <div className="resume-error" role="alert">{error}</div>}
    <div className="assessment-live-grid"><section className="panel assessment-question-panel"><div className="assessment-question-heading"><span>QUESTION {activeIndex + 1} OF {attempt.questions.length}</span><span>{activeQuestion.topic} · {activeQuestion.difficulty} · {activeQuestion.marks} mark{Number(activeQuestion.marks) === 1 ? '' : 's'}</span></div><h2>{activeQuestion.prompt}</h2><div className="assessment-options">{activeQuestion.options.map((option, index) => <button className={`assessment-option ${activeAnswer?.answer?.index === index ? 'assessment-option-selected' : ''}`} key={`${activeQuestion.id}-${index}`} onClick={() => { void saveAnswer(activeQuestion, { question_id: activeQuestion.id, answer: { index }, marked_for_review: Boolean(activeAnswer?.marked_for_review), time_spent_seconds: (activeAnswer?.time_spent_seconds ?? 0) + 1 }); }} type="button"><span>{String.fromCharCode(65 + index)}</span>{option}</button>)}</div><div className="assessment-question-actions"><button className={`text-link ${activeAnswer?.marked_for_review ? 'review-marked' : ''}`} onClick={() => { void saveAnswer(activeQuestion, { question_id: activeQuestion.id, answer: activeAnswer?.answer ?? null, marked_for_review: !activeAnswer?.marked_for_review, time_spent_seconds: activeAnswer?.time_spent_seconds ?? 0 }); }} type="button">{activeAnswer?.marked_for_review ? 'Marked for review' : 'Mark for review'}</button><div><button className="date-button" disabled={activeIndex === 0} onClick={() => setActiveIndex((current) => Math.max(0, current - 1))} type="button"><ArrowLeft size={14} /> Previous</button><button className="practice-button" disabled={activeIndex === attempt.questions.length - 1} onClick={() => setActiveIndex((current) => Math.min(attempt.questions.length - 1, current + 1))} type="button">Next <ArrowRight size={14} /></button></div></div></section><aside className="panel assessment-palette-panel"><div className="section-heading"><div><div className="section-kicker">QUESTION PALETTE</div><h2>{answeredCount}/{attempt.questions.length} answered</h2></div></div><div className="question-palette">{attempt.questions.map((question, index) => <button aria-label={`Question ${index + 1}${answers[question.id]?.answer !== null && answers[question.id]?.answer !== undefined ? ', answered' : ''}${answers[question.id]?.marked_for_review ? ', marked for review' : ''}`} className={`${activeIndex === index ? 'palette-active' : ''} ${answers[question.id]?.answer !== null && answers[question.id]?.answer !== undefined ? 'palette-answered' : ''} ${answers[question.id]?.marked_for_review ? 'palette-review' : ''}`} key={question.id} onClick={() => setActiveIndex(index)} type="button">{index + 1}</button>)}</div><div className="palette-legend"><span><i className="legend-answered" />Answered</span><span><i className="legend-review" />Review</span><span><i className="legend-unanswered" />Not visited</span></div><button className="assessment-submit-button" disabled={attempt.status === 'submitting'} onClick={() => { void finishAttempt(); }} type="button">{attempt.status === 'submitting' ? 'Submitting…' : 'Submit test'} <ArrowRight size={14} /></button></aside></div>
  </section>;

  return <section className="assessment-workspace">
    <div className="assessment-page-heading"><div className="section-kicker">MOCK ONLINE ASSESSMENTS</div><h1>Practice under real test conditions.</h1><p>Timed questions autosave as you work. Your attempt deadline is enforced by the API.</p></div>
    {error && <div className="resume-error" role="alert">{error}</div>}
    {tests.length ? <div className="assessment-test-list">{tests.map((test) => {
      const completedAttempt = test.latest_attempt && ['submitted', 'auto_submitted', 'expired'].includes(test.latest_attempt.status);
      return <article className="panel assessment-test-card" key={test.id}>
        <div className="assessment-test-mark"><Clock3 size={17} /></div>
        <div className="assessment-test-details"><strong>{test.title}</strong><span>{test.description || 'Practice assessment'} · {test.question_count} questions · {Math.round(test.duration_seconds / 60)} minutes</span></div>
        {completedAttempt ? <button className="date-button" onClick={() => { void openReport(test.latest_attempt!.id); }} type="button">View report <ArrowRight size={14} /></button> : <button className="practice-button" onClick={() => { void startTest(test); }} type="button">{test.latest_attempt?.status === 'in_progress' ? 'Resume test' : 'Start test'} <ArrowRight size={14} /></button>}
      </article>;
    })}</div> : <div className="panel assessment-empty"><div className="empty-report-mark"><ShieldCheck size={21} /></div><h2>No tests are assigned yet.</h2><p>Global practice tests and assigned assessments will appear here.</p></div>}
    <div className="assessment-privacy-note">Your answers are private to your account. Proctor events are collected only after you grant consent.</div>
  </section>;
}