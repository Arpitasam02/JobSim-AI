import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, FileCheck2, FileUp, LoaderCircle, ShieldAlert } from 'lucide-react';

type Role = { id: string; name: string };
type ResumeVersion = { id: string; version: number; filename: string; parseStatus: string };
type ResumeSummary = { id: string; title: string; is_primary: boolean; versions: ResumeVersion[] };
type AnalysisResult = {
  score: number;
  subScores: Record<string, number>;
  verdict: string;
  criticalIssue: boolean;
  issues: Array<{ severity: string; category: string; issue: string; whyItMatters: string; location: string; suggestedFix: string; afterText: string | null }>;
  topRoles: Array<{ roleName: string; score: number; classification: string; explanation: string; missingSkills: string[] }>;
  limitedAnalysis: boolean;
};

const subScoreLabels: Record<string, string> = {
  atsCompatibility: 'ATS compatibility',
  formatStructure: 'Format and structure',
  contentQuality: 'Content quality',
  projectQuality: 'Project quality',
  skillsRelevance: 'Skills relevance',
  placementRelevance: 'Placement relevance',
  consistencyCredibility: 'Consistency and credibility',
};

type ResumeWorkspaceProps = { accessToken: string };

export default function ResumeWorkspace({ accessToken }: ResumeWorkspaceProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [targetRoleId, setTargetRoleId] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const headers = { Authorization: `Bearer ${accessToken}` };
    Promise.all([
      fetch('/api/v1/roles', { headers }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Roles could not be loaded.'))),
      fetch('/api/v1/resumes', { headers }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Resume history could not be loaded.'))),
    ]).then(([roleResponse, resumeResponse]) => {
      if (!active) return;
      setRoles(roleResponse.roles ?? []);
      setResumes(resumeResponse.resumes ?? []);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Workspace data could not be loaded.');
    });
    return () => { active = false; };
  }, [accessToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    setAnalysis(null);
    try {
      const extension = file.name.toLowerCase().split('.').pop();
      const expectedType = extension === 'pdf' ? 'application/pdf' : extension === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '';
      if (!expectedType || (file.type && file.type !== expectedType)) throw new Error('Choose a PDF or DOCX file.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Resume files must be 5 MB or smaller.');

      const upload = await fetch('/api/v1/resumes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': expectedType, 'X-File-Name': file.name.replace(/[^\x20-\x7E]/g, '_') },
        body: file,
      });
      const uploaded = await upload.json();
      if (!upload.ok) throw new Error(uploaded.message ?? 'Resume upload failed.');

      const analyzed = await fetch(`/api/v1/resumes/${uploaded.resumeId}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(targetRoleId ? { targetRoleId } : {}) }),
      });
      const result = await analyzed.json();
      if (!analyzed.ok) throw new Error(result.message ?? 'Resume analysis failed.');
      setAnalysis(result as AnalysisResult);

      const listResponse = await fetch('/api/v1/resumes', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (listResponse.ok) setResumes((await listResponse.json()).resumes ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Resume analysis failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="resume-workspace">
      <div className="resume-page-heading">
        <div><div className="section-kicker">RESUME WORKSPACE</div><h1>Make your experience easier to see.</h1><p>Upload a resume to review its structure, evidence, and role alignment.</p></div>
      </div>

      <div className="resume-workspace-grid">
        <div className="resume-upload-column">
          <section className="panel resume-upload-panel">
            <div className="section-heading"><div><div className="section-kicker">NEW VERSION</div><h2>Upload your resume</h2></div><span className="metric-icon resume-icon"><FileUp size={16} /></span></div>
            <form onSubmit={submit}>
              <label className="resume-file-picker">
                <input accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
                {file ? <FileCheck2 size={23} /> : <FileUp size={23} />}
                <strong>{file?.name ?? 'Choose a PDF or DOCX file'}</strong>
                <span>{file ? `${(file.size / 1024).toFixed(0)} KB selected` : 'Maximum file size: 5 MB'}</span>
              </label>
              <label className="resume-role-select">Target role <select onChange={(event) => setTargetRoleId(event.target.value)} value={targetRoleId}><option value="">Show all role matches</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
              {error && <div className="resume-error" role="alert"><ShieldAlert size={15} />{error}</div>}
              <button className="practice-button resume-submit" disabled={!file || busy} type="submit">{busy ? <><LoaderCircle className="spinner" size={16} /> Analyzing resume</> : <>Upload and analyze <ArrowRight size={15} /></>}</button>
            </form>
            <p className="resume-privacy-note">Files are private to your account. Recruiter sharing stays off until you opt in.</p>
          </section>

          <section className="panel resume-history-panel">
            <div className="section-heading"><div><div className="section-kicker">SAVED VERSIONS</div><h2>Your resume history</h2></div><span className="action-counter">{resumes.reduce((count, resume) => count + resume.versions.length, 0)} versions</span></div>
            {resumes.length ? <div className="resume-history-list">{resumes.flatMap((resume) => resume.versions.map((version) => <div className="resume-history-row" key={version.id}><span className="history-file-icon"><FileCheck2 size={16} /></span><span><strong>{version.filename}</strong><small>Version {version.version} · {version.parseStatus}</small></span>{resume.is_primary && <span className="primary-badge">PRIMARY</span>}</div>))}</div> : <p className="resume-empty">Your uploaded versions will appear here.</p>}
          </section>
        </div>

        {analysis ? <section className="panel resume-report-panel">
          <div className="section-heading"><div><div className="section-kicker">RULE-BASED REPORT · {analysis.limitedAnalysis ? 'LIMITED ANALYSIS' : 'EXPLAINABLE'}</div><h2>Resume health</h2></div><span className="report-score">{analysis.score}<small>/100</small></span></div>
          <div className={`verdict-banner ${analysis.criticalIssue ? 'verdict-critical' : ''}`}><span className="status-dot" />{analysis.verdict}</div>
          <div className="report-scores">{Object.entries(analysis.subScores).map(([key, score]) => <div className="report-score-row" key={key}><span>{subScoreLabels[key] ?? key}</span><strong>{score}</strong><div className="progress-track"><span style={{ width: `${score}%` }} /></div></div>)}</div>
          <div className="report-section-heading"><h3>What to work on</h3><span>{analysis.issues.length} findings</span></div>
          {['critical', 'important', 'nice_to_have'].map((severity) => {
            const issues = analysis.issues.filter((item) => item.severity === severity);
            if (!issues.length) return null;
            return <div className="report-issue-group" key={severity}><h4>{severity === 'nice_to_have' ? 'Nice to have' : severity[0].toUpperCase() + severity.slice(1)}</h4>{issues.map((item, index) => <article className="report-issue" key={`${item.category}-${index}`}><strong>{item.issue}</strong><span>{item.location}</span><p>{item.whyItMatters}</p><small>{item.suggestedFix}</small>{item.afterText && <blockquote>{item.afterText}</blockquote>}</article>)}</div>;
          })}
          <div className="report-section-heading"><h3>Role matches</h3><span>Based on stated skills and project evidence</span></div>
          {analysis.topRoles.map((role) => <div className="report-role-row" key={role.roleName}><div><strong>{role.roleName}</strong><span>{role.explanation}</span></div><b>{role.score}%</b></div>)}
        </section> : <section className="panel resume-report-empty"><div className="empty-report-mark"><FileCheck2 size={22} /></div><div className="section-kicker">YOUR NEXT REVIEW</div><h2>Your feedback, with receipts.</h2><p>Upload a resume to see specific findings, the rule behind each one, and role matches based on the skills you’ve listed.</p></section>}
      </div>
    </section>
  );
}