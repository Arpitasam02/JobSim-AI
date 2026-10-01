import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { raw, Router } from 'express';
import type { RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { environment } from '../config.js';
import { MalwareDetectedError, ScannerUnavailableError, scanUpload } from '../files/malware.js';
import { requireAuthentication, requireRoles } from '../auth/middleware.js';
import { analyzeResume, type ParsedResume } from './analyzer.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const parsedResumeSchema = z.object({
  contact: z.object({ email: z.string().nullable().optional(), phone: z.string().nullable().optional() }).optional(),
  summary: z.string().optional(),
  education: z.string().optional(),
  skills: z.record(z.array(z.string())).optional(),
  projects: z.array(z.string()).optional(),
  experience: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  achievements: z.array(z.string()).optional(),
  rawSections: z.record(z.string()).optional(),
  metadata: z.object({
    pageCount: z.number().int().nonnegative().optional(),
    characterCount: z.number().int().nonnegative().optional(),
    usedOcr: z.boolean().optional(),
    readable: z.boolean().optional(),
    warnings: z.array(z.string()).optional(),
    filename: z.string().optional(),
    sha256: z.string().optional(),
  }).optional(),
});
const analyzeRequestSchema = z.object({
  targetRoleId: z.string().uuid().optional(),
  jobDescription: z.string().trim().max(20_000).optional(),
});

function sendError(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ code, message, details: null, requestId: response.req.requestId });
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function safeFilename(value: string | undefined, contentType: string): string | null {
  if (!value || value.length > 255) return null;
  const filename = value.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._ -]/g, '_');
  const extension = path.extname(filename).toLowerCase();
  if (contentType === PDF_MIME && extension === '.pdf') return filename;
  if (contentType === DOCX_MIME && extension === '.docx') return filename;
  return null;
}

export function createResumeRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const authenticate = requireAuthentication(pool, accessSecret);
  const rawResumeBody = expressRawBody();
  const candidateOnly = requireRoles('candidate');

  router.post('/', authenticate, candidateOnly, rawResumeBody, asyncHandler(async (request, response, next) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return sendError(response, 400, 'FILE_REQUIRED', 'Choose a PDF or DOCX resume to upload.');
    }
    if (request.body.length > MAX_FILE_BYTES) {
      return sendError(response, 413, 'FILE_TOO_LARGE', 'Resume files must be 5 MB or smaller.');
    }

    const contentType = request.header('content-type')?.split(';', 1)[0].toLowerCase() ?? '';
    const filename = safeFilename(request.header('x-file-name'), contentType);
    const isPdf = contentType === PDF_MIME && request.body.subarray(0, 5).toString('ascii') === '%PDF-';
    const isDocx = contentType === DOCX_MIME && request.body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (!filename || (!isPdf && !isDocx)) {
      return sendError(response, 415, 'UNSUPPORTED_FILE', 'Upload a valid PDF or DOCX file.');
    }

    let scanStatus: 'clean' | 'not_scanned';
    try {
      scanStatus = await scanUpload(request.body);
    } catch (error) {
      if (error instanceof MalwareDetectedError) return sendError(response, 422, 'MALWARE_DETECTED', error.message);
      if (error instanceof ScannerUnavailableError) return sendError(response, 503, 'SCANNER_UNAVAILABLE', error.message);
      return next(error);
    }

    const sha256 = createHash('sha256').update(request.body).digest('hex');
    let parsedResume: ParsedResume = {
      metadata: { readable: false, warnings: ['Resume parsing service is unavailable; analysis is limited.'] },
    };
    let parseStatus: 'complete' | 'failed' = 'complete';
    let limitedAnalysis = false;
    try {
      const parseResponse = await fetch(`${environment.AI_SERVICE_URL}/resume/parse`, {
        method: 'POST',
        headers: { 'Content-Type': contentType, 'X-File-Name': encodeURIComponent(filename) },
        body: new Uint8Array(request.body),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await parseResponse.json();
      if (!parseResponse.ok) {
        const details = z.object({ detail: z.object({ code: z.string(), message: z.string() }) }).safeParse(result);
        if (details.success && ['INVALID_PDF', 'INVALID_DOCX'].includes(details.data.detail.code)) {
          parsedResume = { metadata: { readable: false, warnings: [details.data.detail.message] } };
          limitedAnalysis = true;
          parseStatus = 'failed';
        } else if (details.success) {
          return sendError(response, parseResponse.status, details.data.detail.code, details.data.detail.message);
        }
        throw new Error('Resume parser returned an invalid response.');
      }
      if (parseResponse.ok) {
        const validated = parsedResumeSchema.safeParse(result);
        if (!validated.success) throw new Error('Resume parser returned invalid structured data.');
        parsedResume = validated.data;
        if (!parsedResume.metadata?.readable) parseStatus = 'failed';
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return sendError(response, 504, 'PARSER_TIMEOUT', 'Resume parsing took too long. Please try again.');
      }
      if (error instanceof Error && error.message.includes('structured data')) {
        limitedAnalysis = true;
        parseStatus = 'failed';
      } else if (error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')) {
        limitedAnalysis = true;
        parseStatus = 'failed';
      } else if (error instanceof Error && error.message.includes('invalid response')) {
        limitedAnalysis = true;
        parseStatus = 'failed';
      } else {
        throw error;
      }
    }

    parsedResume.metadata = {
      ...parsedResume.metadata,
      filename,
      sha256,
      scanStatus,
      ...(limitedAnalysis ? { warnings: [...(parsedResume.metadata?.warnings ?? []), 'Limited analysis: parser service is unavailable.'] } : {}),
    } as ParsedResume['metadata'];

    const ownerId = request.authenticatedUser!.id;
    const duplicate = await pool.query(
      `SELECT r.id FROM resumes r JOIN resume_versions rv ON rv.resume_id = r.id
       WHERE r.candidate_id = $1 AND rv.sha256 = $2 LIMIT 1`,
      [ownerId, sha256],
    );
    if (duplicate.rowCount) return sendError(response, 409, 'DUPLICATE_RESUME', 'This exact resume version has already been uploaded.');

    const storageKey = `${randomUUID()}${isPdf ? '.pdf' : '.docx'}`;
    const uploadDirectory = path.resolve(process.cwd(), 'uploads', 'resumes');
    const storagePath = path.join(uploadDirectory, storageKey);
    const client = await pool.connect();
    try {
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(storagePath, request.body, { flag: 'wx', mode: 0o600 });
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
      const existingResume = await client.query(
        'SELECT id FROM resumes WHERE candidate_id = $1 AND is_primary = true FOR UPDATE',
        [ownerId],
      );
      let resumeId: string;
      if (existingResume.rowCount) {
        resumeId = existingResume.rows[0].id;
      } else {
        const createdResume = await client.query(
          'INSERT INTO resumes (candidate_id, title, is_primary) VALUES ($1, $2, true) RETURNING id',
          [ownerId, path.basename(filename, path.extname(filename))],
        );
        resumeId = createdResume.rows[0].id;
      }
      const versionResult = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM resume_versions WHERE resume_id = $1',
        [resumeId],
      );
      const versionNumber = Number(versionResult.rows[0].next_version);
      const version = await client.query(
        `INSERT INTO resume_versions (
          resume_id, version_number, storage_key, original_filename, mime_type,
          file_size_bytes, sha256, parsed_data, parse_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [resumeId, versionNumber, storageKey, filename, contentType, request.body.length, sha256, JSON.stringify(parsedResume), parseStatus],
      );
      await client.query('COMMIT');
      response.status(201).json({
        resumeId,
        versionId: version.rows[0].id,
        version: versionNumber,
        parsedData: parsedResume,
        limitedAnalysis: limitedAnalysis || parseStatus === 'failed',
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      await rm(storagePath, { force: true });
      next(error);
    } finally {
      client.release();
    }
  }));

  router.get('/', authenticate, candidateOnly, asyncHandler(async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT r.id, r.title, r.is_primary, r.created_at,
          COALESCE(json_agg(json_build_object('id', rv.id, 'version', rv.version_number, 'filename', rv.original_filename,
            'parseStatus', rv.parse_status, 'createdAt', rv.created_at)) FILTER (WHERE rv.id IS NOT NULL), '[]') AS versions
         FROM resumes r LEFT JOIN resume_versions rv ON rv.resume_id = r.id
         WHERE r.candidate_id = $1 GROUP BY r.id ORDER BY r.is_primary DESC, r.created_at DESC`,
        [request.authenticatedUser!.id],
      );
      response.json({ resumes: result.rows });
    } catch (error) {
      next(error);
    }
  }));

  router.get('/:resumeId', authenticate, candidateOnly, asyncHandler(async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT r.id, r.title, r.is_primary, rv.id AS version_id, rv.version_number, rv.original_filename,
          rv.parsed_data, rv.parse_status, rv.created_at
         FROM resumes r JOIN resume_versions rv ON rv.resume_id = r.id
         WHERE r.id = $1 AND r.candidate_id = $2 ORDER BY rv.version_number DESC`,
        [request.params.resumeId, request.authenticatedUser!.id],
      );
      if (!result.rowCount) return sendError(response, 404, 'RESUME_NOT_FOUND', 'Resume not found.');
      response.json({ resume: { id: result.rows[0].id, title: result.rows[0].title, isPrimary: result.rows[0].is_primary }, versions: result.rows.map((row) => ({ id: row.version_id, version: row.version_number, filename: row.original_filename, parsedData: row.parsed_data, parseStatus: row.parse_status, createdAt: row.created_at })) });
    } catch (error) {
      next(error);
    }
  }));

  router.post('/:resumeId/analyze', authenticate, candidateOnly, asyncHandler(async (request, response, next) => {
    const requestBody = analyzeRequestSchema.safeParse(request.body ?? {});
    if (!requestBody.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Choose a valid target role and job description.');
    const client = await pool.connect();
    try {
      const ownerId = request.authenticatedUser!.id;
      const versionResult = await client.query(
        `SELECT rv.id, rv.parsed_data, rv.parse_status
         FROM resumes r JOIN resume_versions rv ON rv.resume_id = r.id
         WHERE r.id = $1 AND r.candidate_id = $2
         ORDER BY rv.version_number DESC LIMIT 1`,
        [request.params.resumeId, ownerId],
      );
      if (!versionResult.rowCount) return sendError(response, 404, 'RESUME_NOT_FOUND', 'Resume not found.');

      const parsed = parsedResumeSchema.safeParse(versionResult.rows[0].parsed_data);
      const resumeData: ParsedResume = parsed.success ? parsed.data : { metadata: { readable: false } };
      const [roleResult, profileResult] = await Promise.all([
        client.query(
          `SELECT rc.id, rc.name,
            COALESCE(json_agg(json_build_object('name', s.name, 'weight', rsk.weight, 'mustHave', rsk.must_have))
              FILTER (WHERE s.id IS NOT NULL), '[]') AS skills
           FROM role_catalog rc LEFT JOIN role_skill_weights rsk ON rsk.role_id = rc.id
           LEFT JOIN skills s ON s.id = rsk.skill_id
           WHERE rc.active = true GROUP BY rc.id ORDER BY rc.name`,
        ),
        client.query('SELECT cgpa FROM candidate_profiles WHERE user_id = $1', [ownerId]),
      ]);
      const roles = roleResult.rows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        skills: (row.skills as Array<{ name: string; weight: number | string; mustHave: boolean }>).map((skill) => ({
          ...skill,
          weight: Number(skill.weight),
        })),
      }));
      if (requestBody.data.targetRoleId) {
        const selected = roles.find((role) => role.id === requestBody.data.targetRoleId);
        if (!selected) return sendError(response, 404, 'ROLE_NOT_FOUND', 'The selected target role does not exist.');
        roles.sort((left, right) => Number(right.id === selected.id) - Number(left.id === selected.id));
      }
      const result = analyzeResume(resumeData, roles, { cgpa: profileResult.rows[0]?.cgpa ?? null });
      const primaryRole = roles[0];
      await client.query('BEGIN');
      const insertedAnalysis = await client.query(
        `INSERT INTO resume_analyses (
          resume_version_id, target_role, target_job_description, overall_score, sub_scores,
          verdict, critical_issue, analysis_version, limited_analysis
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          versionResult.rows[0].id,
          primaryRole?.name ?? null,
          requestBody.data.jobDescription ?? null,
          result.score,
          JSON.stringify(result.subScores),
          result.verdict,
          result.criticalIssue,
          result.modelVersion,
          versionResult.rows[0].parse_status !== 'complete',
        ],
      );
      const analysisId = insertedAnalysis.rows[0].id as string;
      for (const item of result.issues) {
        await client.query(
          `INSERT INTO resume_issues (
            analysis_id, severity, category, issue, why_it_matters, location,
            suggested_fix, before_text, after_text, evidence
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [analysisId, item.severity, item.category, item.issue, item.whyItMatters, item.location, item.suggestedFix, item.beforeText, item.afterText, JSON.stringify(item.evidence)],
        );
      }
      for (const fit of result.roleMatches) {
        await client.query(
          `INSERT INTO role_fit_results (candidate_id, resume_version_id, role_id, fit_score, matched_skills, missing_skills, explanation)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ownerId, versionResult.rows[0].id, fit.roleId, fit.score, JSON.stringify(fit.matchedSkills), JSON.stringify(fit.missingSkills), fit.explanation],
        );
      }
      await client.query('COMMIT');
      const limitedAnalysis = versionResult.rows[0].parse_status !== 'complete';
      const analysisReason = limitedAnalysis ? 'ai-service unreachable' : 'ok';
      response.status(201).json({
        analysisId,
        resumeVersionId: versionResult.rows[0].id,
        score: result.score,
        subScores: result.subScores,
        verdict: result.verdict,
        criticalIssue: result.criticalIssue,
        issues: result.issues,
        topRoles: result.roleMatches,
        limitedAnalysis,
        reason: analysisReason,
        modelVersion: result.modelVersion,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  router.get('/:resumeId/analysis', authenticate, candidateOnly, asyncHandler(async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT ra.id, ra.overall_score::float8 AS overall_score, ra.sub_scores, ra.verdict, ra.critical_issue,
          ra.analysis_version, ra.limited_analysis, ra.created_at,
          COALESCE(json_agg(json_build_object('severity', ri.severity, 'category', ri.category,
            'issue', ri.issue, 'whyItMatters', ri.why_it_matters, 'location', ri.location,
            'suggestedFix', ri.suggested_fix, 'beforeText', ri.before_text, 'afterText', ri.after_text,
            'evidence', ri.evidence)) FILTER (WHERE ri.id IS NOT NULL), '[]') AS issues
         FROM resumes r JOIN resume_versions rv ON rv.resume_id = r.id
         JOIN resume_analyses ra ON ra.resume_version_id = rv.id
         LEFT JOIN resume_issues ri ON ri.analysis_id = ra.id
         WHERE r.id = $1 AND r.candidate_id = $2
         GROUP BY ra.id ORDER BY ra.created_at DESC`,
        [request.params.resumeId, request.authenticatedUser!.id],
      );
      if (!result.rowCount) return sendError(response, 404, 'ANALYSIS_NOT_FOUND', 'No analysis exists for this resume yet.');
      response.json({ analyses: result.rows });
    } catch (error) {
      next(error);
    }
  }));

  return router;
}

function expressRawBody(): RequestHandler {
  return raw({ type: ['application/pdf', DOCX_MIME, 'application/octet-stream'], limit: MAX_FILE_BYTES });
}