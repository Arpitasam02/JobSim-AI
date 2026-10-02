import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Check, LoaderCircle, Target } from 'lucide-react';

type Role = { id: string; name: string; skills: Array<{ name: string; weight: number; mustHave: boolean }> };
type RoleFit = { roleId: string; roleName: string; score: number; classification: string; matchedSkills: string[]; missingSkills: string[]; explanation: string };
type Gap = { id: string; name: string; priority: string; weight: number; estimatedHours: number; resources: Array<{ title: string; url: string; provider: string; free: boolean }> };
type RoadmapTask = { id: string; title: string; description?: string; week_number: number; estimated_hours: number; resource_url: string | null; completed_at: string | null; skill?: string };
type Roadmap = { id: string; role_name: string; tasks: RoadmapTask[] };

type RoleWorkspaceProps = { accessToken: string; view: 'roles' | 'roadmap' };

async function apiRequest(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? 'Request failed.');
  return body;
}

export default function RoleWorkspace({ accessToken, view }: RoleWorkspaceProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [fits, setFits] = useState<RoleFit[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const tasks = view === 'roles'
      ? Promise.all([
        apiRequest('/api/v1/roles', accessToken),
        apiRequest('/api/v1/me/role-fit', accessToken),
      ]).then(([roleResult, fitResult]) => {
        if (!active) return;
        setRoles(roleResult.roles ?? []);
        setFits(fitResult.roleMatches ?? []);
      })
      : Promise.all([
        apiRequest('/api/v1/roles', accessToken),
        apiRequest('/api/v1/me/roadmap', accessToken),
      ]).then(([roleResult, roadmapResult]) => {
        if (!active) return;
        setRoles(roleResult.roles ?? []);
        setRoadmap(roadmapResult.roadmap ?? null);
        setSelectedRole(roadmapResult.roadmap?.role_id ?? '');
      });
    tasks.catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Workspace could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken, view]);

  async function selectRole(roleId: string) {
    setSelectedRole(roleId);
    setError('');
    setRoadmap(null);
    try {
      const result = await apiRequest(`/api/v1/me/skill-gap?role=${encodeURIComponent(roleId)}`, accessToken);
      setGaps(result.gaps ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Skill gaps could not be loaded.');
    }
  }

  async function createRoadmap() {
    if (!selectedRole) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('/api/v1/me/roadmap', accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId: selectedRole }),
      });
      setRoadmap({ id: result.roadmap.id, role_name: result.roadmap.role, tasks: result.roadmap.tasks });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Roadmap could not be generated.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task: RoadmapTask) {
    if (!roadmap) return;
    const completed = !task.completed_at;
    setRoadmap({ ...roadmap, tasks: roadmap.tasks.map((item) => item.id === task.id ? { ...item, completed_at: completed ? new Date().toISOString() : null } : item) });
    try {
      await apiRequest(`/api/v1/me/roadmap/tasks/${task.id}`, accessToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
    } catch (cause) {
      setRoadmap({ ...roadmap, tasks: roadmap.tasks.map((item) => item.id === task.id ? task : item) });
      setError(cause instanceof Error ? cause.message : 'Task could not be updated.');
    }
  }

  const selectedRoleName = roles.find((role) => role.id === selectedRole)?.name ?? roadmap?.role_name ?? '';
  const completedCount = roadmap?.tasks.filter((task) => task.completed_at).length ?? 0;

  return (
    <section className="role-workspace">
      <div className="resume-page-heading">
        <div><div className="section-kicker">{view === 'roles' ? 'ROLE FIT & SKILL GAPS' : '30 / 60 / 90 DAY PLAN'}</div><h1>{view === 'roles' ? 'Find the roles within reach.' : 'Turn a skill gap into a plan.'}</h1><p>{view === 'roles' ? 'Matches use your stated skills and project evidence, not protected attributes.' : 'Tasks are generated from the latest role skill gap and stay editable as your goals change.'}</p></div>
      </div>
      {error && <div className="resume-error" role="alert">{error}</div>}
      {loading ? <div className="workspace-loading"><LoaderCircle className="spinner" size={18} />Loading your role data</div> : view === 'roles' ? <div className="role-workspace-grid">
        <section className="panel role-match-panel">
          <div className="section-heading"><div><div className="section-kicker">YOUR TOP MATCHES</div><h2>Based on your resume</h2></div><span className="metric-icon probability-icon"><Target size={16} /></span></div>
          <label className="role-explorer-select">Explore any career field<select aria-label="Explore a career field" onChange={(event) => { if (event.target.value) void selectRole(event.target.value); }} value={selectedRole}><option value="">Choose a role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          {fits.length ? <div className="role-match-list">{fits.map((fit, index) => <button className={`role-match-card ${selectedRole === fit.roleId ? 'role-match-selected' : ''}`} key={fit.roleId} onClick={() => { void selectRole(fit.roleId); }} type="button"><span className={`role-rank rank-${Math.min(index + 1, 3)}`}>0{index + 1}</span><span className="role-match-copy"><strong>{fit.roleName}</strong><small>{fit.classification}</small><span>{fit.explanation}</span></span><b>{fit.score}%</b></button>)}</div> : <p className="resume-empty">Upload a readable resume to calculate skill-based role matches.</p>}
        </section>
        <section className="panel skill-gap-panel">
          <div className="section-heading"><div><div className="section-kicker">PRIORITIZED GAPS</div><h2>{selectedRoleName || 'Choose a role match'}</h2></div><span className="action-counter">{gaps.length} skills</span></div>
          {gaps.length ? <div className="skill-gap-list">{gaps.map((gap) => <article className="skill-gap-card" key={gap.id}><div><strong>{gap.name}</strong><span>{gap.priority} · about {gap.estimatedHours} hours</span></div>{gap.resources.filter((resource) => resource.free).slice(0, 1).map((resource) => <a href={resource.url} key={resource.url} rel="noreferrer" target="_blank"><BookOpen size={13} /> {resource.provider || resource.title}</a>)}</article>)}</div> : <p className="resume-empty">Choose a role to see the skills you have and the gaps to prioritize.</p>}
          {selectedRole && <button className="practice-button roadmap-generate" disabled={busy || gaps.length === 0} onClick={() => { void createRoadmap(); }} type="button">{busy ? <LoaderCircle className="spinner" size={15} /> : null}Build a 90-day roadmap <ArrowRight size={14} /></button>}
        </section>
      </div> : <section className="panel roadmap-panel">
        <div className="section-heading"><div><div className="section-kicker">{roadmap ? roadmap.role_name : 'NO ROADMAP YET'}</div><h2>{roadmap ? 'Your next 12 weeks' : 'Start with a role goal'}</h2></div>{roadmap && <span className="action-counter">{completedCount}/{roadmap.tasks.length} complete</span>}</div>
        {roadmap && <label className="roadmap-role-switch">Roadmap career field<select aria-label="Roadmap career field" onChange={(event) => { setRoadmap(null); if (event.target.value) void selectRole(event.target.value); }} value={selectedRole}><option value="">Choose a role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>}
        {roadmap?.tasks.length ? <div className="roadmap-task-list">{roadmap.tasks.map((task) => <label className={`roadmap-task ${task.completed_at ? 'roadmap-task-done' : ''}`} key={task.id}><input checked={Boolean(task.completed_at)} onChange={() => { void toggleTask(task); }} type="checkbox" /><span className="roadmap-week">WEEK {String(task.week_number).padStart(2, '0')}</span><span className="roadmap-task-copy"><strong>{task.title}</strong><small>{task.description ?? task.skill} · {task.estimated_hours} hours</small></span>{task.resource_url && <a aria-label="Open learning resource" href={task.resource_url} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank"><BookOpen size={15} /></a>}{task.completed_at && <Check className="task-done-icon" size={16} />}</label>)}</div> : <><p className="resume-empty">Choose a role and create a roadmap from its current skill gaps.</p><div className="roadmap-role-picker"><label>Target role<select onChange={(event) => setSelectedRole(event.target.value)} value={selectedRole}><option value="">Choose a role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><button className="practice-button" disabled={!selectedRole || busy} onClick={() => { if (selectedRole) void selectRole(selectedRole).then(createRoadmap); }} type="button">Generate roadmap <ArrowRight size={14} /></button></div></>}
      </section>}
    </section>
  );
}