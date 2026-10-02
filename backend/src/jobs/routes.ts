import { Router, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthentication, requireRoles } from '../auth/middleware.js';
import { isEligibleForJob, redactBlindApplicant } from './logic.js';

const jobColumns = `
  j.id, j.company_id, j.role_id, j.title, j.description, j.required_skills,
  j.experience_level,
  j.minimum_cgpa::float8 AS minimum_cgpa, j.eligible_branches, j.graduation_years,
  j.location, j.package_min::float8 AS package_min, j.package_max::float8 AS package_max,
  j.deadline, j.rounds, j.status, j.blind_screening, j.created_at, j.updated_at`;

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
}).strict();

const jobFieldsSchema = z.object({
  companyId: z.string().uuid(),
  roleId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(20_000),
  requiredSkills: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  minimumCgpa: z.number().finite().min(0).max(10).nullable().optional(),
  eligibleBranches: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  graduationYears: z.array(z.number().int().min(2000).max(2100)).max(30).default([]),
  location: z.string().trim().max(160).nullable().optional(),
  packageMin: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
  packageMax: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  rounds: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  status: z.enum(['draft', 'open', 'closed']).default('draft'),
  experienceLevel: z.enum(['any', 'freshers', 'experienced']).default('any'),
  blindScreening: z.boolean().default(false),
}).strict();

const checkPackageRange = (job: { packageMin?: number | null; packageMax?: number | null }, context: z.RefinementCtx) => {
  if (job.packageMin != null && job.packageMax != null && job.packageMin > job.packageMax) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['packageMax'], message: 'Package maximum must be at least the minimum.' });
  }
};

const createJobSchema = jobFieldsSchema.superRefine(checkPackageRange);
const patchJobSchema = jobFieldsSchema.omit({ companyId: true }).partial().strict().superRefine(checkPackageRange);

const applySchema = z.object({ resumeId: z.string().uuid() }).strict();
const decisionSchema = z.object({ decision: z.enum(['shortlist', 'reject']) }).strict();
const uuidSchema = z.string().uuid();

type JobInput = z.infer<typeof createJobSchema>;

function sendError(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ code, message, details: null, requestId: response.req.requestId });
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

async function hasCompanyMembership(pool: Pool, userId: string, companyId: string, writeAccess = false) {
  const result = await pool.query(
    `SELECT 1 FROM company_members
     WHERE user_id = $1 AND company_id = $2
       AND ($3::boolean = false OR member_role IN ('admin', 'hiring_manager'))`,
    [userId, companyId, writeAccess],
  );
  return Boolean(result.rowCount);
}

async function recruiterJob(pool: Pool, userId: string, jobId: string, writeAccess = false) {
  return pool.query(
    `SELECT ${jobColumns}, cp.name AS company_name
     FROM jobs j
     JOIN company_profiles cp ON cp.id = j.company_id
     JOIN company_members cm ON cm.company_id = j.company_id AND cm.user_id = $2
     WHERE j.id = $1
       AND ($3::boolean = false OR cm.member_role IN ('admin', 'hiring_manager'))`,
    [jobId, userId, writeAccess],
  );
}

async function roleExists(pool: Pool, roleId: string | null | undefined) {
  if (roleId == null) return true;
  const result = await pool.query('SELECT 1 FROM role_catalog WHERE id = $1 AND active = true', [roleId]);
  return Boolean(result.rowCount);
}

export function createCandidateJobsRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const authenticate = requireAuthentication(pool, accessSecret);
  const candidateOnly = requireRoles('candidate');

  router.get('/', authenticate, candidateOnly, asyncHandler(async (request, response, next) => {
    const parsedQuery = pageQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Page and pageSize must be valid positive integers.');
    const { page, pageSize } = parsedQuery.data;
    const candidateId = request.authenticatedUser!.id;
    const eligibility = `
      (j.minimum_cgpa IS NULL OR cp.cgpa IS NULL OR cp.cgpa >= j.minimum_cgpa)
      AND (cardinality(j.eligible_branches) = 0 OR cp.branch IS NULL OR cp.branch = ANY(j.eligible_branches))
      AND (cardinality(j.graduation_years) = 0 OR cp.graduation_year IS NULL OR cp.graduation_year = ANY(j.graduation_years))`;
    try {
      const [countResult, jobsResult] = await Promise.all([
        pool.query(
          `SELECT count(*)::float8 AS total FROM jobs j
           LEFT JOIN candidate_profiles cp ON cp.user_id = $1
           WHERE j.status = 'open' AND (j.deadline IS NULL OR j.deadline >= now()) AND ${eligibility}`,
          [candidateId],
        ),
        pool.query(
          `SELECT j.id, j.title, j.description, j.required_skills, j.role_id,
            rc.name AS role_name, cp_company.name AS company_name,
            j.experience_level,
            j.minimum_cgpa::float8 AS minimum_cgpa, j.eligible_branches, j.graduation_years,
            j.location, j.package_min::float8 AS package_min, j.package_max::float8 AS package_max,
            j.deadline, j.rounds,
            rfr.fit_score::float8 AS fit_score
           FROM jobs j
           JOIN company_profiles cp_company ON cp_company.id = j.company_id
           LEFT JOIN role_catalog rc ON rc.id = j.role_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = $1
           LEFT JOIN LATERAL (
             SELECT fit_score FROM role_fit_results
             WHERE candidate_id = $1 AND role_id = j.role_id
             ORDER BY created_at DESC LIMIT 1
           ) rfr ON j.role_id IS NOT NULL
           WHERE j.status = 'open' AND (j.deadline IS NULL OR j.deadline >= now()) AND ${eligibility}
           ORDER BY j.created_at DESC, j.id
           LIMIT $2 OFFSET $3`,
          [candidateId, pageSize, (page - 1) * pageSize],
        ),
      ]);
      response.json({
        jobs: jobsResult.rows,
        pagination: { page, pageSize, total: Number(countResult.rows[0].total) },
      });
    } catch (error) {
      next(error);
    }
  }));

  router.post('/:id/apply', authenticate, candidateOnly, asyncHandler(async (request, response, next) => {
    const jobId = uuidSchema.safeParse(request.params.id);
    const body = applySchema.safeParse(request.body);
    if (!jobId.success || !body.success) return sendError(response, 400, 'VALIDATION_ERROR', 'A valid job ID and resumeId are required.');
    const candidateId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const jobResult = await client.query(
        `SELECT j.id, j.status, j.deadline, j.minimum_cgpa::float8 AS minimum_cgpa,
          j.eligible_branches, j.graduation_years,
          cp.cgpa::float8 AS cgpa, cp.branch, cp.graduation_year
         FROM jobs j LEFT JOIN candidate_profiles cp ON cp.user_id = $2
         WHERE j.id = $1 FOR SHARE OF j`,
        [jobId.data, candidateId],
      );
      if (!jobResult.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 404, 'NOT_FOUND', 'Job not found.');
      }
      const job = jobResult.rows[0];
      if (job.status !== 'open' || (job.deadline && new Date(job.deadline).getTime() < Date.now())) {
        await client.query('ROLLBACK');
        return sendError(response, 409, 'JOB_NOT_OPEN', 'This job is not accepting applications.');
      }
      if (!isEligibleForJob({
        minimumCgpa: job.minimum_cgpa,
        eligibleBranches: job.eligible_branches,
        graduationYears: job.graduation_years,
      }, {
        cgpa: job.cgpa,
        branch: job.branch,
        graduationYear: job.graduation_year,
      })) {
        await client.query('ROLLBACK');
        return sendError(response, 409, 'NOT_ELIGIBLE', 'Your profile does not meet this job’s listed eligibility criteria.');
      }
      const resumeResult = await client.query(
        `SELECT r.id, rv.id AS resume_version_id
         FROM resumes r
         JOIN LATERAL (
           SELECT id FROM resume_versions WHERE resume_id = r.id ORDER BY version_number DESC LIMIT 1
         ) rv ON true
         WHERE r.id = $1 AND r.candidate_id = $2`,
        [body.data.resumeId, candidateId],
      );
      if (!resumeResult.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 404, 'NOT_FOUND', 'Resume not found.');
      }
      const application = await client.query(
        `INSERT INTO applications (job_id, candidate_id, resume_version_id)
         VALUES ($1, $2, $3) ON CONFLICT (job_id, candidate_id) DO NOTHING
         RETURNING id, status, applied_at`,
        [jobId.data, candidateId, resumeResult.rows[0].resume_version_id],
      );
      if (!application.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 409, 'ALREADY_APPLIED', 'You have already applied to this job.');
      }
      await client.query('COMMIT');
      response.status(201).json({ application: application.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  return router;
}

export function createRecruiterJobsRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const authenticate = requireAuthentication(pool, accessSecret);
  const recruiterOnly = requireRoles('recruiter');

  router.get('/companies', authenticate, recruiterOnly, asyncHandler(async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT cp.id, cp.name, cm.member_role
         FROM company_members cm JOIN company_profiles cp ON cp.id = cm.company_id
         WHERE cm.user_id = $1 ORDER BY cp.name`,
        [request.authenticatedUser!.id],
      );
      response.json({ companies: result.rows });
    } catch (error) {
      next(error);
    }
  }));

  router.post('/jobs', authenticate, recruiterOnly, asyncHandler(async (request, response, next) => {
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Provide valid job details.');
    const userId = request.authenticatedUser!.id;
    const job = parsed.data;
    try {
      if (!await hasCompanyMembership(pool, userId, job.companyId, true)) return sendError(response, 404, 'NOT_FOUND', 'Company not found.');
      if (!await roleExists(pool, job.roleId)) return sendError(response, 404, 'NOT_FOUND', 'Career role not found.');
      const result = await pool.query(
        `INSERT INTO jobs (
          company_id, created_by, role_id, title, description, required_skills, minimum_cgpa,
          eligible_branches, graduation_years, location, package_min, package_max, deadline,
          rounds, status, blind_screening
          , experience_level
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)
        RETURNING id`,
        [job.companyId, userId, job.roleId ?? null, job.title, job.description, JSON.stringify(job.requiredSkills),
          job.minimumCgpa ?? null, job.eligibleBranches, job.graduationYears, job.location ?? null,
          job.packageMin ?? null, job.packageMax ?? null, job.deadline ?? null,
          JSON.stringify(job.rounds), job.status, job.blindScreening, job.experienceLevel],
      );
      const created = await recruiterJob(pool, userId, result.rows[0].id);
      response.status(201).json({ job: created.rows[0] });
    } catch (error) {
      next(error);
    }
  }));

  router.get('/jobs', authenticate, recruiterOnly, asyncHandler(async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT ${jobColumns}, cp.name AS company_name
         FROM jobs j
         JOIN company_profiles cp ON cp.id = j.company_id
         JOIN company_members cm ON cm.company_id = j.company_id AND cm.user_id = $1
         ORDER BY j.updated_at DESC, j.id`,
        [request.authenticatedUser!.id],
      );
      response.json({ jobs: result.rows });
    } catch (error) {
      next(error);
    }
  }));

  router.get('/jobs/:id', authenticate, recruiterOnly, asyncHandler(async (request, response, next) => {
    const jobId = uuidSchema.safeParse(request.params.id);
    if (!jobId.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Job ID must be a valid UUID.');
    try {
      const result = await recruiterJob(pool, request.authenticatedUser!.id, jobId.data);
      if (!result.rowCount) return sendError(response, 404, 'NOT_FOUND', 'Job not found.');
      response.json({ job: result.rows[0] });
    } catch (error) {
      next(error);
    }
  }));

  router.patch('/jobs/:id', authenticate, recruiterOnly, asyncHandler(async (request, response, next) => {
    const jobId = uuidSchema.safeParse(request.params.id);
    const parsed = patchJobSchema.safeParse(request.body);
    if (!jobId.success || !parsed.success || !Object.keys(parsed.data).length) {
      return sendError(response, 400, 'VALIDATION_ERROR', 'Provide a valid job ID and at least one valid job field.');
    }
    const userId = request.authenticatedUser!.id;
    try {
      const existing = await recruiterJob(pool, userId, jobId.data, true);
      if (!existing.rowCount) return sendError(response, 404, 'NOT_FOUND', 'Job not found.');
      const current = existing.rows[0];
      const minimum = parsed.data.packageMin === undefined ? current.package_min : parsed.data.packageMin;
      const maximum = parsed.data.packageMax === undefined ? current.package_max : parsed.data.packageMax;
      if (minimum != null && maximum != null && minimum > maximum) {
        return sendError(response, 400, 'VALIDATION_ERROR', 'Package maximum must be at least the minimum.');
      }
      if (!await roleExists(pool, parsed.data.roleId)) return sendError(response, 404, 'NOT_FOUND', 'Career role not found.');

      const values: unknown[] = [jobId.data, userId];
      const assignments: string[] = [];
      const fields: Array<[keyof typeof parsed.data, string, boolean]> = [
        ['roleId', 'role_id', false], ['title', 'title', false], ['description', 'description', false],
        ['requiredSkills', 'required_skills', true], ['minimumCgpa', 'minimum_cgpa', false],
        ['eligibleBranches', 'eligible_branches', false], ['graduationYears', 'graduation_years', false],
        ['location', 'location', false], ['packageMin', 'package_min', false], ['packageMax', 'package_max', false],
        ['deadline', 'deadline', false], ['rounds', 'rounds', true], ['status', 'status', false],
        ['blindScreening', 'blind_screening', false],
        ['experienceLevel', 'experience_level', false],
      ];
      for (const [key, column, json] of fields) {
        const value = parsed.data[key];
        if (value === undefined) continue;
        values.push(json ? JSON.stringify(value) : key === 'deadline' && value === null ? null : value);
        assignments.push(`${column} = $${values.length}${json ? '::jsonb' : ''}`);
      }
      assignments.push('updated_at = now()');
      const updated = await pool.query(
        `UPDATE jobs j SET ${assignments.join(', ')}
         WHERE j.id = $1 AND EXISTS (
           SELECT 1 FROM company_members cm
           WHERE cm.company_id = j.company_id AND cm.user_id = $2
             AND cm.member_role IN ('admin', 'hiring_manager')
         ) RETURNING j.id`,
        values,
      );
      if (!updated.rowCount) return sendError(response, 404, 'NOT_FOUND', 'Job not found.');
      const result = await recruiterJob(pool, userId, jobId.data);
      response.json({ job: result.rows[0] });
    } catch (error) {
      next(error);
    }
  }));

  router.get('/jobs/:id/applicants', authenticate, recruiterOnly, asyncHandler(async (request, response, next) => {
    const jobId = uuidSchema.safeParse(request.params.id);
    const parsedQuery = pageQuerySchema.safeParse(request.query);
    if (!jobId.success || !parsedQuery.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Provide a valid job ID and pagination values.');
    const userId = request.authenticatedUser!.id;
    const { page, pageSize } = parsedQuery.data;
    try {
      const job = await recruiterJob(pool, userId, jobId.data);
      if (!job.rowCount) return sendError(response, 404, 'NOT_FOUND', 'Job not found.');
      const result = await pool.query(
        `SELECT a.id AS application_id, a.status, a.applied_at,
          r.id AS resume_id, r.title AS resume_title, rv.id AS resume_version_id,
          rv.version_number, rv.original_filename AS resume_filename,
          u.name, u.email, i.name AS institution
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN company_members cm ON cm.company_id = j.company_id AND cm.user_id = $2
         JOIN users u ON u.id = a.candidate_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         LEFT JOIN institutions i ON i.id = cp.institution_id
         LEFT JOIN resume_versions rv ON rv.id = a.resume_version_id
         LEFT JOIN resumes r ON r.id = rv.resume_id
         WHERE a.job_id = $1
         ORDER BY a.applied_at DESC, a.id
         LIMIT $3 OFFSET $4`,
        [jobId.data, userId, pageSize, (page - 1) * pageSize],
      );
      const totalResult = await pool.query(
        `SELECT count(*)::float8 AS total FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN company_members cm ON cm.company_id = j.company_id AND cm.user_id = $2
         WHERE a.job_id = $1`,
        [jobId.data, userId],
      );
      const applicants = result.rows.map((row) => redactBlindApplicant({
        applicationId: row.application_id,
        status: row.status,
        appliedAt: row.applied_at,
        resume: row.resume_id ? {
          id: row.resume_id,
          title: row.resume_title,
          versionId: row.resume_version_id,
          version: row.version_number,
          filename: row.resume_filename,
        } : null,
        name: row.name,
        email: row.email,
        institution: row.institution,
      }, job.rows[0].blind_screening, row.status === 'shortlisted'));
      response.json({ applicants, pagination: { page, pageSize, total: Number(totalResult.rows[0].total) } });
    } catch (error) {
      next(error);
    }
  }));

  return router;
}

export function createApplicationDecisionRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const authenticate = requireAuthentication(pool, accessSecret);
  const recruiterOnly = requireRoles('recruiter');

  router.post('/:id/decision', authenticate, recruiterOnly, asyncHandler(async (request, response, next) => {
    const applicationId = uuidSchema.safeParse(request.params.id);
    const parsed = decisionSchema.safeParse(request.body);
    if (!applicationId.success || !parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Provide a valid application ID and decision.');
    const userId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const application = await client.query(
        `SELECT a.id FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN company_members cm ON cm.company_id = j.company_id AND cm.user_id = $2
           AND cm.member_role IN ('admin', 'hiring_manager')
         WHERE a.id = $1 FOR UPDATE OF a`,
        [applicationId.data, userId],
      );
      if (!application.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 404, 'NOT_FOUND', 'Application not found.');
      }
      const status = parsed.data.decision === 'shortlist' ? 'shortlisted' : 'rejected';
      await client.query(
        'INSERT INTO shortlist_decisions (application_id, decided_by, decision) VALUES ($1, $2, $3)',
        [applicationId.data, userId, parsed.data.decision],
      );
      await client.query('UPDATE applications SET status = $2 WHERE id = $1', [applicationId.data, status]);
      await client.query('COMMIT');
      response.json({ applicationId: applicationId.data, status });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  return router;
}