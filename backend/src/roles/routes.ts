import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthentication, requireRoles } from '../auth/middleware.js';
import { environment } from '../config.js';
import { withTransientDbRetry } from '../db.js';
import { calculateProbability, simulateProbability, type ProbabilityInput, type ProbabilityResult } from '../probability/engine.js';
import { buildProbabilityInputs, probabilityComponents } from '../probability/inputs.js';
import { analyzeResume, type ParsedResume, type RoleRequirement } from '../resumes/analyzer.js';

function sendError(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ code, message, details: null, requestId: response.req.requestId });
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function normalizeRoles(rows: Array<{ id: string; name: string; skills: Array<{ name: string; weight: number | string; mustHave: boolean }> }>): RoleRequirement[] {
  return rows.map((role) => ({
    id: role.id,
    name: role.name,
    skills: role.skills.map((skill) => ({ ...skill, weight: Number(skill.weight) })),
  }));
}

const placementProbabilityQuery = z.object({ roleId: z.string().uuid().optional() });
const probabilitySimulationBody = z.object({
  resume: z.number().finite().min(0).max(100).optional(),
  roleFit: z.number().finite().min(0).max(100).optional(),
  assessments: z.number().finite().min(0).max(100).optional(),
  interviews: z.number().finite().min(0).max(100).optional(),
  profile: z.number().finite().min(0).max(100).optional(),
}).strict();

type ProbabilityRole = { id: string; name: string };

async function loadProbabilityRole(pool: Pool, candidateId: string, requestedRoleId?: string): Promise<ProbabilityRole | null> {
  if (requestedRoleId) {
    const result = await pool.query('SELECT id, name FROM role_catalog WHERE id = $1', [requestedRoleId]);
    return (result.rows[0] as ProbabilityRole | undefined) ?? null;
  }
  const result = await pool.query(
    `SELECT rc.id, rc.name FROM role_fit_results rfr
     JOIN role_catalog rc ON rc.id = rfr.role_id
     WHERE rfr.candidate_id = $1 ORDER BY rfr.created_at DESC LIMIT 1`,
    [candidateId],
  );
  return (result.rows[0] as ProbabilityRole | undefined) ?? null;
}

async function loadProbabilitySnapshot(pool: Pool, candidateId: string, role: ProbabilityRole | null) {
  const [resumeResult, assessmentResult, interviewResult] = await Promise.all([
    pool.query(
      `SELECT ra.overall_score::float8 AS score FROM resume_analyses ra
       JOIN resume_versions rv ON rv.id = ra.resume_version_id
       JOIN resumes r ON r.id = rv.resume_id
       WHERE r.candidate_id = $1 ORDER BY ra.created_at DESC LIMIT 1`,
      [candidateId],
    ),
    pool.query(
      `SELECT total_score::float8 AS score FROM assessment_attempts
       WHERE candidate_id = $1 AND status IN ('submitted', 'auto_submitted', 'expired')
         AND total_score IS NOT NULL
       ORDER BY submitted_at DESC NULLS LAST, started_at DESC LIMIT 1`,
      [candidateId],
    ),
    pool.query(
      `SELECT e.overall_score::float8 AS score FROM interview_evaluations e
       JOIN interview_sessions s ON s.id = e.session_id
       WHERE s.candidate_id = $1 AND s.status = 'completed' AND e.overall_score IS NOT NULL
       ORDER BY s.finished_at DESC NULLS LAST, e.created_at DESC LIMIT 1`,
      [candidateId],
    ),
  ]);
  const roleFitResult = role
    ? await pool.query(
      `SELECT fit_score::float8 AS score FROM role_fit_results
       WHERE candidate_id = $1 AND role_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [candidateId, role.id],
    )
    : null;

  const input = buildProbabilityInputs({
    resume: resumeResult.rows[0]?.score,
    roleFit: roleFitResult?.rows[0]?.score,
    assessments: assessmentResult.rows[0]?.score,
    interviewOverallScore: interviewResult.rows[0]?.score,
  });
  const result = calculateProbability(input);
  return { input, result };
}

function apiProbabilityResult(result: ProbabilityResult) {
  return result.dataPoints === 0
    ? { ...result, probability: null, weightedScore: null }
    : result;
}

async function loadRoles(pool: Pool): Promise<RoleRequirement[]> {
  const result = await withTransientDbRetry(
    () => pool.query(
      `SELECT rc.id, rc.name,
        COALESCE(json_agg(json_build_object('name', s.name, 'weight', rsk.weight, 'mustHave', rsk.must_have))
          FILTER (WHERE s.id IS NOT NULL), '[]') AS skills
       FROM role_catalog rc LEFT JOIN role_skill_weights rsk ON rsk.role_id = rc.id
       LEFT JOIN skills s ON s.id = rsk.skill_id
       WHERE rc.active = true GROUP BY rc.id ORDER BY rc.name`,
    ),
    'role catalog load',
  );
  return normalizeRoles(result.rows);
}

async function loadLatestResume(pool: Pool, candidateId: string): Promise<ParsedResume | null> {
  const result = await withTransientDbRetry(
    () => pool.query(
      `SELECT rv.parsed_data FROM resumes r JOIN resume_versions rv ON rv.resume_id = r.id
       WHERE r.candidate_id = $1 ORDER BY r.is_primary DESC, rv.version_number DESC LIMIT 1`,
      [candidateId],
    ),
    'latest resume load',
  );
  return (result.rows[0]?.parsed_data as ParsedResume | undefined) ?? null;
}

async function loadSkillGaps(pool: Pool, roleId: string, resume: ParsedResume | null) {
  const requirements = await withTransientDbRetry(
    () => pool.query(
      `SELECT s.id, s.name, rsk.weight, rsk.must_have,
        COALESCE(json_agg(json_build_object('id', sr.id, 'title', sr.title, 'url', sr.url, 'provider', sr.provider, 'free', sr.free))
          FILTER (WHERE sr.id IS NOT NULL), '[]') AS resources
       FROM role_skill_weights rsk JOIN skills s ON s.id = rsk.skill_id
       LEFT JOIN skill_resources sr ON sr.skill_id = s.id AND sr.approved_at IS NOT NULL
       WHERE rsk.role_id = $1 GROUP BY s.id, rsk.weight, rsk.must_have
       ORDER BY rsk.must_have DESC, rsk.weight DESC, s.name`,
      [roleId],
    ),
    'skill gap load',
  );
  const candidateSkills = new Set(Object.values(resume?.skills ?? {}).flat().map((skill) => skill.toLowerCase().trim()));
  return requirements.rows
    .filter((skill) => !candidateSkills.has((skill.name as string).toLowerCase()))
    .map((skill) => ({
      id: skill.id as string,
      name: skill.name as string,
      priority: skill.must_have ? 'Must-have' : 'Good-to-have',
      weight: Number(skill.weight),
      estimatedHours: skill.must_have ? 8 : 4,
      resources: skill.resources as Array<{ id: string; title: string; url: string; provider: string; free: boolean }>,
    }));
}

export function createRoleRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const authenticate = requireAuthentication(pool, accessSecret);
  const candidateOnly = requireRoles('candidate');

  router.get('/dashboard', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const candidateId = request.authenticatedUser!.id;
    const [resumeResult, fitResult] = await Promise.all([
      pool.query(
        `SELECT ra.overall_score::float8 AS score FROM resumes r
         JOIN LATERAL (
           SELECT id FROM resume_versions WHERE resume_id = r.id ORDER BY version_number DESC LIMIT 1
         ) latest_version ON true
         JOIN resume_analyses ra ON ra.resume_version_id = latest_version.id
         WHERE r.candidate_id = $1 ORDER BY r.is_primary DESC, ra.created_at DESC LIMIT 1`,
        [candidateId],
      ),
      pool.query(
        `SELECT rc.name AS role_name, rfr.fit_score::float8 AS score
         FROM resumes r
         JOIN LATERAL (
           SELECT id FROM resume_versions WHERE resume_id = r.id ORDER BY version_number DESC LIMIT 1
         ) latest_version ON true
         JOIN role_fit_results rfr ON rfr.resume_version_id = latest_version.id
         JOIN role_catalog rc ON rc.id = rfr.role_id
         WHERE r.candidate_id = $1
         ORDER BY r.is_primary DESC, rfr.fit_score DESC, rfr.created_at DESC LIMIT 1`,
        [candidateId],
      ),
    ]);
    const topRoleMatch = fitResult.rowCount
      ? {
          roleName: String(fitResult.rows[0].role_name ?? 'Role'),
          score: Number(fitResult.rows[0].score),
        }
      : null;
    response.json({
      resumeHealth: resumeResult.rowCount ? Number(resumeResult.rows[0].score) : 0,
      dataAnalystFit: fitResult.rowCount ? Number(fitResult.rows[0].score) : 0,
      hasAnalyzedResume: Boolean(resumeResult.rowCount),
      topRoleMatch,
    });
  }));

  router.get('/placement-probability', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const query = placementProbabilityQuery.safeParse(request.query);
    if (!query.success) return sendError(response, 400, 'VALIDATION_ERROR', 'A valid roleId UUID is required.');
    const candidateId = request.authenticatedUser!.id;
    const role = await loadProbabilityRole(pool, candidateId, query.data.roleId);
    if (query.data.roleId && !role) return sendError(response, 404, 'ROLE_NOT_FOUND', 'The selected role does not exist.');

    const { input, result } = await loadProbabilitySnapshot(pool, candidateId, role);
    response.json({
      role,
      components: probabilityComponents(input),
      ...apiProbabilityResult(result),
    });
  }));

  router.post('/placement-probability/simulate', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const query = placementProbabilityQuery.safeParse(request.query);
    if (!query.success) return sendError(response, 400, 'VALIDATION_ERROR', 'A valid roleId UUID is required.');
    const body = probabilitySimulationBody.safeParse(request.body);
    if (!body.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Simulation overrides must use known component keys and finite values from 0 to 100.');
    const candidateId = request.authenticatedUser!.id;
    const role = await loadProbabilityRole(pool, candidateId, query.data.roleId);
    if (query.data.roleId && !role) return sendError(response, 404, 'ROLE_NOT_FOUND', 'The selected role does not exist.');

    const { input } = await loadProbabilitySnapshot(pool, candidateId, role);
    const simulation = simulateProbability(input, body.data);
    response.json({
      before: apiProbabilityResult(simulation.before),
      after: apiProbabilityResult(simulation.after),
      delta: simulation.delta,
    });
  }));

  router.get('/role-fit', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const resume = await loadLatestResume(pool, request.authenticatedUser!.id);
    if (!resume) return response.json({ roleMatches: [], message: 'Upload a resume to calculate role matches.' });
    const [roles, profile] = await Promise.all([
      loadRoles(pool),
      withTransientDbRetry(() => pool.query('SELECT cgpa FROM candidate_profiles WHERE user_id = $1', [request.authenticatedUser!.id]), 'candidate profile load'),
    ]);
    const analysis = analyzeResume(resume, roles, { cgpa: profile.rows[0]?.cgpa ?? null });
    response.json({ roleMatches: analysis.roleMatches });
  }));

  router.get('/skill-gap', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const query = z.object({ role: z.string().uuid() }).safeParse(request.query);
    if (!query.success) return sendError(response, 400, 'VALIDATION_ERROR', 'A valid role id is required.');
    const role = await pool.query('SELECT id, name FROM role_catalog WHERE id = $1 AND active = true', [query.data.role]);
    if (!role.rowCount) return sendError(response, 404, 'ROLE_NOT_FOUND', 'The selected role does not exist.');
    const resume = await loadLatestResume(pool, request.authenticatedUser!.id);
    const gaps = await loadSkillGaps(pool, query.data.role, resume);
    response.json({ role: role.rows[0], gaps, estimatedHours: gaps.reduce((total, gap) => total + gap.estimatedHours, 0) });
  }));

  router.get('/roadmap', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const query = z.object({ role: z.string().uuid().optional() }).safeParse(request.query);
    if (!query.success) return sendError(response, 400, 'VALIDATION_ERROR', 'A valid role id is required.');
    const candidateId = request.authenticatedUser!.id;
    const planResult = query.data.role
      ? await pool.query(
        `SELECT p.id, p.role_id, rc.name AS role_name, p.created_at FROM skill_gap_plans p
         JOIN role_catalog rc ON rc.id = p.role_id WHERE p.candidate_id = $1 AND p.role_id = $2
         ORDER BY p.created_at DESC LIMIT 1`,
        [candidateId, query.data.role],
      )
      : await pool.query(
        `SELECT p.id, p.role_id, rc.name AS role_name, p.created_at FROM skill_gap_plans p
         JOIN role_catalog rc ON rc.id = p.role_id WHERE p.candidate_id = $1
         ORDER BY p.created_at DESC LIMIT 1`,
        [candidateId],
      );
    if (!planResult.rowCount) return response.json({ roadmap: null, message: 'Generate a roadmap from a role skill gap.' });
    const tasks = await pool.query(
      `SELECT rt.id, rt.title, rt.description, rt.week_number, rt.estimated_hours,
        rt.resource_url, rt.completed_at, s.name AS skill
       FROM roadmap_tasks rt LEFT JOIN skills s ON s.id = rt.skill_id
       WHERE rt.plan_id = $1 ORDER BY rt.week_number, rt.id`,
      [planResult.rows[0].id],
    );
    response.json({ roadmap: { ...planResult.rows[0], tasks: tasks.rows } });
  }));

  router.post('/roadmap', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const body = z.object({ roleId: z.string().uuid() }).safeParse(request.body);
    if (!body.success) return sendError(response, 400, 'VALIDATION_ERROR', 'A valid role id is required.');
    const role = await pool.query('SELECT id, name FROM role_catalog WHERE id = $1 AND active = true', [body.data.roleId]);
    if (!role.rowCount) return sendError(response, 404, 'ROLE_NOT_FOUND', 'The selected role does not exist.');
    const resume = await loadLatestResume(pool, request.authenticatedUser!.id);
    const gaps = await loadSkillGaps(pool, body.data.roleId, resume);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const plan = await client.query(
        'INSERT INTO skill_gap_plans (candidate_id, role_id) VALUES ($1, $2) RETURNING id',
        [request.authenticatedUser!.id, body.data.roleId],
      );
      const planId = plan.rows[0].id as string;
      const tasks = [];
      for (const [index, gap] of gaps.slice(0, 6).entries()) {
        const learnWeek = 1 + index * 2;
        const resourceUrl = gap.resources.find((resource) => resource.free)?.url ?? null;
        const learningTask = await client.query(
          `INSERT INTO roadmap_tasks (plan_id, skill_id, title, description, week_number, estimated_hours, resource_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, title, week_number, estimated_hours, resource_url`,
          [planId, gap.id, `Learn ${gap.name} fundamentals`, `Study core concepts, then practice with small exercises. Priority: ${gap.priority.toLowerCase()}.`, learnWeek, gap.estimatedHours, resourceUrl],
        );
        const practiceTask = await client.query(
          `INSERT INTO roadmap_tasks (plan_id, skill_id, title, description, week_number, estimated_hours)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title, week_number, estimated_hours, resource_url`,
          [planId, gap.id, `Apply ${gap.name} in a project`, 'Add a small, original project feature and document what you built. Do not claim work you did not complete.', learnWeek + 1, 4],
        );
        tasks.push(learningTask.rows[0], practiceTask.rows[0]);
      }
      await client.query('COMMIT');
      response.status(201).json({ roadmap: { id: planId, role: role.rows[0].name, tasks } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  router.patch('/roadmap/tasks/:taskId', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const body = z.object({ completed: z.boolean() }).safeParse(request.body);
    if (!body.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Choose whether this task is complete.');
    const result = await pool.query(
      `UPDATE roadmap_tasks rt SET completed_at = CASE WHEN $3 THEN COALESCE(rt.completed_at, now()) ELSE NULL END
       FROM skill_gap_plans p
       WHERE rt.id = $1 AND p.id = rt.plan_id AND p.candidate_id = $2
       RETURNING rt.id, rt.completed_at`,
      [request.params.taskId, request.authenticatedUser!.id, body.data.completed],
    );
    if (!result.rowCount) return sendError(response, 404, 'TASK_NOT_FOUND', 'Roadmap task not found.');
    response.json({ task: result.rows[0] });
  }));

  return router;
}