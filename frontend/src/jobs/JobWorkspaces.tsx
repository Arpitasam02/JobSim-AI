import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, BriefcaseBusiness, CheckCircle2, LoaderCircle, Pencil, ShieldAlert, Users } from 'lucide-react';

type Resume = { id: string; title: string; is_primary: boolean };
type JobPagination = { page: number; pageSize: number; total: number };
type CandidateJob = {
  id: string;
  role_id: string | null;
  title: string;
  description: string;
  required_skills: string[];
  role_name: string | null;
  experience_level: 'any' | 'freshers' | 'experienced';
  company_name: string;
  minimum_cgpa: number | null;
  eligible_branches: string[];
  graduation_years: number[];
  location: string | null;
  package_min: number | null;
  package_max: number | null;
  deadline: string | null;
  rounds: string[];
  fit_score: number | null;
};
type RecruiterJob = {
  id: string;
  company_id: string;
  company_name: string;
  role_id: string | null;
  title: string;
  description: string;
  required_skills: string[];
  minimum_cgpa: number | null;
  eligible_branches: string[];
  graduation_years: number[];
  location: string | null;
  package_min: number | null;
  package_max: number | null;
  deadline: string | null;
  rounds: string[];
  status: 'draft' | 'open' | 'closed';
  blind_screening: boolean;
  experience_level: 'any' | 'freshers' | 'experienced';
};
type RecruiterCompany = { id: string; name: string; member_role: string };
type Applicant = {
  applicationId: string;
  status: string;
  appliedAt: string;
  resume: { id: string; title: string; versionId: string; version: number; filename: string } | null;
  name?: string;
  email?: string;
  institution?: string | null;
};
type JobForm = {
  roleId: string;
  title: string;
  description: string;
  requiredSkills: string;
  minimumCgpa: string;
  eligibleBranches: string;
  graduationYears: string;
  location: string;
  packageMin: string;
  packageMax: string;
  deadline: string;
  rounds: string;
  status: RecruiterJob['status'];
  blindScreening: boolean;
  experienceLevel: 'any' | 'freshers' | 'experienced';
};

const emptyForm: JobForm = {
  roleId: '', title: '', description: '', requiredSkills: '', minimumCgpa: '',
  eligibleBranches: '', graduationYears: '', location: '', packageMin: '', packageMax: '',
  deadline: '', rounds: '', status: 'draft', blindScreening: false, experienceLevel: 'any',
};

function csvValues(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function describeApiFailure(cause: unknown, fallback: string) {
  if (cause instanceof TypeError) {
    return 'We could not reach the PlacePrep API. Start the API on port 4000 and try again.';
  }
  if (cause instanceof Error) {
    const message = cause.message || fallback;
    if (/session|sign in again|expired/i.test(message)) {
      return message;
    }
    if (/server|try again later|unexpected error|internal error/i.test(message)) {
      return 'The server is having trouble. Please try again in a moment.';
    }
    if (/validation|required|invalid|incorrect|verify|password/i.test(message)) {
      return message;
    }
    return message;
  }
  return fallback;
}

async function apiRequest<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = response.status === 204 || !contentType.includes('application/json') ? null : await response.json();
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
      ? body.message
      : 'The request could not be completed.';
    throw new Error(message);
  }
  return body as T;
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Enter valid finite numeric values.');
  return number;
}

export function CandidateJobsWorkspace({ accessToken, onNavigate }: { accessToken: string; onNavigate: (section: string) => void }) {
  const [jobs, setJobs] = useState<CandidateJob[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [pagination, setPagination] = useState<JobPagination>({ page: 1, pageSize: 20, total: 0 });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [experienceFilter, setExperienceFilter] = useState<'any' | 'freshers' | 'experienced'>('any');
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<{ jobs: CandidateJob[]; pagination: JobPagination }>(`/api/v1/jobs?page=${pagination.page}&pageSize=${pagination.pageSize}`, accessToken),
      apiRequest<{ resumes: Resume[] }>('/api/v1/resumes', accessToken),
    ]).then(([jobResult, resumeResult]) => {
      if (!active) return;
      setJobs(jobResult.jobs ?? []);
      setPagination(jobResult.pagination ?? { page: 1, pageSize: 20, total: 0 });
      setResumes(resumeResult.resumes ?? []);
      setResumeId(resumeResult.resumes?.[0]?.id ?? '');
    }).catch((cause: unknown) => {
      if (active) setError(describeApiFailure(cause, 'Jobs could not be loaded.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken, pagination.page, pagination.pageSize]);

  const visibleJobs = jobs.filter((job) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [job.title, job.company_name, job.description, ...job.required_skills].some((value) => value.toLowerCase().includes(query));
    return matchesSearch && (!roleFilter || job.role_name === roleFilter)
      && (experienceFilter === 'any' || job.experience_level === 'any' || job.experience_level === experienceFilter);
  });
  const availableRoles = [...new Set(jobs.map((job) => job.role_name).filter((role): role is string => Boolean(role)))].sort();

  async function apply(jobId: string) {
    if (!resumeId) return;
    setApplying(jobId);
    setError('');
    try {
      await apiRequest(`/api/v1/jobs/${jobId}/apply`, accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId }),
      });
      setApplied((current) => ({ ...current, [jobId]: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your application could not be submitted.');
    } finally {
      setApplying('');
    }
  }

  return <section className="jobs-workspace">
    <div className="resume-page-heading"><div><div className="section-kicker">OPEN OPPORTUNITIES</div><h1>Explore jobs</h1><p>Find a role that fits where you want to go next.</p></div></div>
    {error && <div className="resume-error" role="alert"><ShieldAlert size={15} />{error}</div>}
    {!loading && jobs.length > 0 && <div className="job-filter-row">
      <label>Search openings<input aria-label="Search jobs and companies" onChange={(event) => setSearch(event.target.value)} placeholder="Title, company, skill" value={search} /></label>
      <label>Career field<select aria-label="Filter by career field" onChange={(event) => setRoleFilter(event.target.value)} value={roleFilter}><option value="">All fields</option>{availableRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
      <label>Experience<select aria-label="Filter by experience level" onChange={(event) => setExperienceFilter(event.target.value as typeof experienceFilter)} value={experienceFilter}><option value="any">Freshers and experienced</option><option value="freshers">Freshers</option><option value="experienced">Experienced</option></select></label>
      <span>{pagination.total} open job{pagination.total === 1 ? '' : 's'}</span>
    </div>}
    {!loading && resumes.length > 0 && <label className="resume-role-select jobs-resume-select">Resume to apply with<select aria-label="Resume to apply with" onChange={(event) => setResumeId(event.target.value)} value={resumeId}>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title}{resume.is_primary ? ' · primary' : ''}</option>)}</select></label>}
    {loading ? <div className="workspace-loading" role="status"><LoaderCircle className="spinner" size={18} />Loading open jobs</div>
      : visibleJobs.length === 0 ? <section className="panel jobs-empty"><BriefcaseBusiness size={22} /><h2>{jobs.length ? 'No matching jobs' : 'No open jobs yet'}</h2><p>{jobs.length ? 'Try another search or career field.' : 'New opportunities will appear here when companies start hiring.'}</p></section>
        : <div className="job-list">{visibleJobs.map((job) => <article className="panel job-card" key={job.id}>
          <div className="job-card-heading"><div><div className="section-kicker">{job.company_name}</div><h2>{job.title}</h2></div>{job.fit_score !== null && <span className="job-fit-score">{job.fit_score}<small>% fit</small></span>}</div>
          <p className="job-description">{job.description}</p>
          <div className="job-meta">{job.role_name && <span>{job.role_name}</span>}<span>{job.experience_level === 'any' ? 'Freshers and experienced' : job.experience_level}</span>{job.location && <span>{job.location}</span>}{job.minimum_cgpa !== null && <span>Minimum CGPA {job.minimum_cgpa}</span>}{job.eligible_branches.length > 0 && <span>{job.eligible_branches.join(', ')}</span>}{job.graduation_years.length > 0 && <span>Graduation: {job.graduation_years.join(', ')}</span>}{job.package_min !== null && <span>Package {job.package_min.toLocaleString()}{job.package_max === null ? '+' : `–${job.package_max.toLocaleString()}`}</span>}{job.deadline && <span>Apply by {new Date(job.deadline).toLocaleDateString()}</span>}</div>
          {job.required_skills.length > 0 && <div className="job-skills">{job.required_skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}
          {job.rounds.length > 0 && <p className="job-rounds"><strong>Rounds:</strong> {job.rounds.join(' · ')}</p>}
          {job.role_id && <button className="text-link job-practice-link" onClick={() => { localStorage.setItem('placeprep_interview_role_id', job.role_id!); onNavigate('Mock interviews'); }} type="button">Practice for this role <ArrowRight size={14} /></button>}
          {resumes.length === 0 ? <button className="practice-button" onClick={() => onNavigate('My resume')} type="button">Add a resume <ArrowRight size={15} /></button>
            : <button className="practice-button" disabled={Boolean(applying) || applied[job.id]} onClick={() => { void apply(job.id); }} type="button">{applying === job.id ? <LoaderCircle className="spinner" size={15} /> : applied[job.id] ? <CheckCircle2 size={15} /> : null}{applied[job.id] ? 'Application submitted' : applying === job.id ? 'Submitting' : 'Apply'}{!applied[job.id] && applying !== job.id && <ArrowRight size={15} />}</button>}
          {applied[job.id] && <p className="job-apply-confirmation" role="status">Your application has been submitted.</p>}
        </article>)}</div>}
      {!loading && pagination.total > pagination.pageSize && <nav className="jobs-pagination" aria-label="Job result pages"><button className="date-button" disabled={pagination.page <= 1} onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))} type="button">Previous</button><span>Page {pagination.page} of {Math.ceil(pagination.total / pagination.pageSize)}</span><button className="date-button" disabled={pagination.page * pagination.pageSize >= pagination.total} onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))} type="button">Next</button></nav>}
  </section>;
}

export function RecruiterJobsWorkspace({ accessToken }: { accessToken: string }) {
  const [companies, setCompanies] = useState<RecruiterCompany[]>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [jobs, setJobs] = useState<RecruiterJob[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [editing, setEditing] = useState<RecruiterJob | null>(null);
  const [form, setForm] = useState<JobForm>(emptyForm);
  const [applicants, setApplicants] = useState<Applicant[] | null>(null);
  const [applicantsFor, setApplicantsFor] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadJobs() {
    const result = await apiRequest<{ jobs: RecruiterJob[] }>('/api/v1/recruiter/jobs', accessToken);
    setJobs(result.jobs ?? []);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<{ companies: RecruiterCompany[] }>('/api/v1/recruiter/companies', accessToken),
      apiRequest<{ jobs: RecruiterJob[] }>('/api/v1/recruiter/jobs', accessToken),
      apiRequest<{ roles: Array<{ id: string; name: string }> }>('/api/v1/roles', accessToken),
    ]).then(([companyResult, jobResult, roleResult]) => {
      if (!active) return;
      setCompanies(companyResult.companies ?? []);
      setCompanyId(companyResult.companies?.[0]?.id ?? '');
      setJobs(jobResult.jobs ?? []);
      setRoles(roleResult.roles ?? []);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Recruiter jobs could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  function editJob(job: RecruiterJob) {
    setEditing(job);
    setCompanyId(job.company_id);
    setForm({
      roleId: job.role_id ?? '',
      title: job.title,
      description: job.description,
      requiredSkills: job.required_skills.join(', '),
      minimumCgpa: job.minimum_cgpa?.toString() ?? '',
      eligibleBranches: job.eligible_branches.join(', '),
      graduationYears: job.graduation_years.join(', '),
      location: job.location ?? '',
      packageMin: job.package_min?.toString() ?? '',
      packageMax: job.package_max?.toString() ?? '',
      deadline: job.deadline ? new Date(job.deadline).toISOString().slice(0, 16) : '',
      rounds: job.rounds.join(', '),
      status: job.status,
      blindScreening: job.blind_screening,
      experienceLevel: job.experience_level,
    });
    setApplicants(null);
    setError('');
  }

  function resetForm() {
    setEditing(null);
    setForm(emptyForm);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        roleId: form.roleId || null,
        title: form.title,
        description: form.description,
        requiredSkills: csvValues(form.requiredSkills),
        minimumCgpa: numberOrNull(form.minimumCgpa),
        eligibleBranches: csvValues(form.eligibleBranches),
        graduationYears: csvValues(form.graduationYears).map((year) => Number(year)),
        location: form.location.trim() || null,
        packageMin: numberOrNull(form.packageMin),
        packageMax: numberOrNull(form.packageMax),
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
        rounds: csvValues(form.rounds),
        status: form.status,
        blindScreening: form.blindScreening,
        experienceLevel: form.experienceLevel,
      };
      if (editing) {
        await apiRequest(`/api/v1/recruiter/jobs/${editing.id}`, accessToken, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/api/v1/recruiter/jobs', accessToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, companyId }),
        });
      }
      await loadJobs();
      setNotice(editing ? 'Job updated.' : 'Job created.');
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The job could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function showApplicants(job: RecruiterJob) {
    setApplicantsFor(job.id);
    setApplicants(null);
    setError('');
    try {
      const result = await apiRequest<{ applicants: Applicant[] }>(`/api/v1/recruiter/jobs/${job.id}/applicants`, accessToken);
      setApplicants(result.applicants ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Applicants could not be loaded.');
    }
  }

  return <section className="jobs-workspace recruiter-jobs-workspace">
    <div className="resume-page-heading"><div><div className="section-kicker">RECRUITER SPACE</div><h1>Jobs and applicants</h1><p>Create openings and review applications for your companies.</p></div></div>
    {error && <div className="resume-error" role="alert"><ShieldAlert size={15} />{error}</div>}
    {notice && <div className="jobs-notice" role="status"><CheckCircle2 size={15} />{notice}</div>}
    {loading ? <div className="workspace-loading" role="status"><LoaderCircle className="spinner" size={18} />Loading your companies and jobs</div> : <div className="recruiter-jobs-grid">
      <section className="panel recruiter-job-form-panel">
        <div className="section-heading"><div><div className="section-kicker">{editing ? 'EDIT OPENING' : 'NEW OPENING'}</div><h2>{editing ? 'Update job details' : 'Create a job'}</h2></div><BriefcaseBusiness size={18} /></div>
        {companies.length === 0 ? <p className="resume-empty">Your recruiter account is not linked to a company yet.</p> : <form className="job-form" onSubmit={(event) => { void submit(event); }}>
          {!editing && <label>Company<select required onChange={(event) => setCompanyId(event.target.value)} value={companyId}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
          <label>Career field<select onChange={(event) => setForm({ ...form, roleId: event.target.value })} value={form.roleId}><option value="">General opening</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <label>Experience level<select onChange={(event) => setForm({ ...form, experienceLevel: event.target.value as JobForm['experienceLevel'] })} value={form.experienceLevel}><option value="any">Freshers and experienced</option><option value="freshers">Freshers</option><option value="experienced">Experienced</option></select></label>
          <label>Job title<input maxLength={160} onChange={(event) => setForm({ ...form, title: event.target.value })} required value={form.title} /></label>
          <label>Description<textarea maxLength={20000} onChange={(event) => setForm({ ...form, description: event.target.value })} required rows={4} value={form.description} /></label>
          <label>Required skills<input maxLength={1000} onChange={(event) => setForm({ ...form, requiredSkills: event.target.value })} placeholder="SQL, Python, communication" value={form.requiredSkills} /></label>
          <label>Eligible branches<input maxLength={1000} onChange={(event) => setForm({ ...form, eligibleBranches: event.target.value })} placeholder="Computer Science, Information Technology" value={form.eligibleBranches} /></label>
          <label>Graduation years<input maxLength={200} onChange={(event) => setForm({ ...form, graduationYears: event.target.value })} placeholder="2026, 2027" value={form.graduationYears} /></label>
          <div className="job-form-numbers">
            <label>Minimum CGPA<input max="10" min="0" onChange={(event) => setForm({ ...form, minimumCgpa: event.target.value })} step="0.01" type="number" value={form.minimumCgpa} /></label>
            <label>Package minimum<input max="1000000000" min="0" onChange={(event) => setForm({ ...form, packageMin: event.target.value })} step="any" type="number" value={form.packageMin} /></label>
            <label>Package maximum<input max="1000000000" min="0" onChange={(event) => setForm({ ...form, packageMax: event.target.value })} step="any" type="number" value={form.packageMax} /></label>
          </div>
          <label>Location<input maxLength={160} onChange={(event) => setForm({ ...form, location: event.target.value })} value={form.location} /></label>
          <label>Application deadline<input onChange={(event) => setForm({ ...form, deadline: event.target.value })} type="datetime-local" value={form.deadline} /></label>
          <label>Hiring rounds<input maxLength={1200} onChange={(event) => setForm({ ...form, rounds: event.target.value })} placeholder="Resume review, technical interview, HR" value={form.rounds} /></label>
          <label>Status<select onChange={(event) => setForm({ ...form, status: event.target.value as RecruiterJob['status'] })} value={form.status}><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
          <label className="job-blind-toggle"><input checked={form.blindScreening} onChange={(event) => setForm({ ...form, blindScreening: event.target.checked })} type="checkbox" /><span>Blind screening</span></label>
          <div className="job-form-actions"><button className="practice-button" disabled={busy || !companyId} type="submit">{busy ? <LoaderCircle className="spinner" size={15} /> : null}{editing ? 'Save changes' : 'Create job'}<ArrowRight size={14} /></button>{editing && <button className="text-link" onClick={resetForm} type="button">Cancel</button>}</div>
        </form>}
      </section>
      <section className="recruiter-job-list-panel">
        <div className="section-heading"><div><div className="section-kicker">YOUR COMPANIES</div><h2>Posted jobs</h2></div><span className="action-counter">{jobs.length} jobs</span></div>
        {jobs.length === 0 ? <p className="resume-empty">Jobs you create will appear here.</p> : <div className="recruiter-job-list">{jobs.map((job) => <article className="panel recruiter-job-row" key={job.id}>
          <div className="recruiter-job-row-head"><div><strong>{job.title}</strong><small>{job.company_name} · {roles.find((role) => role.id === job.role_id)?.name ?? 'General'} · {job.status}</small></div>{job.blind_screening && <span className="blind-badge">Blind screening</span>}</div>
          <p>{job.description}</p>
          <div className="recruiter-job-actions"><button aria-label={`Edit ${job.title}`} className="icon-button" onClick={() => editJob(job)} title="Edit job" type="button"><Pencil size={15} /></button><button className="text-link" onClick={() => { void showApplicants(job); }} type="button"><Users size={14} /> Applicants</button></div>
          {applicantsFor === job.id && <div className="applicant-list" aria-label={`Applicants for ${job.title}`}>
            {applicants === null ? <div className="workspace-loading"><LoaderCircle className="spinner" size={16} />Loading applicants</div> : applicants.length === 0 ? <p className="resume-empty">No applications yet.</p> : applicants.map((applicant) => <article className="applicant-row" key={applicant.applicationId}>
              <div><strong>{applicant.name ?? 'Anonymous applicant'}</strong><small>{applicant.email ?? (job.blind_screening ? 'Identity hidden until shortlisted' : 'Email unavailable')}</small>{applicant.institution && <small>{applicant.institution}</small>}</div>
              <div><span className="application-status">{applicant.status}</span><small>{applicant.resume?.filename ?? 'Resume unavailable'}</small></div>
            </article>)}
          </div>}
        </article>)}</div>}
      </section>
    </div>}
  </section>;
}