import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { environment } from '../config.js';
import { requireAuthentication, requireRoles } from './middleware.js';
import { createAccessToken, createOpaqueToken, hashToken, passwordMeetsPolicy } from './tokens.js';

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(128),
  role: z.enum(['candidate', 'recruiter']),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().default(false),
});

const tokenSchema = z.object({ token: z.string().min(20).max(256) });
const resetSchema = tokenSchema.extend({ password: z.string().min(8).max(128) });
const profileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  degree: z.string().trim().max(120).nullable().optional(),
  branch: z.string().trim().max(120).nullable().optional(),
  graduationYear: z.number().int().min(1950).max(2100).nullable().optional(),
  cgpa: z.number().min(0).max(10).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  links: z.record(z.string().url().max(2048)).optional(),
  targetRoles: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  preferredJobType: z.enum(['internship', 'full_time']).nullable().optional(),
  recruiterVisibility: z.boolean().optional(),
});
const consentSchema = z.object({
  consents: z.array(z.object({
    type: z.enum(['ai_analysis', 'audio_recording', 'video_recording', 'recruiter_sharing', 'proctoring']),
    granted: z.boolean(),
  })).min(1).max(5),
  policyVersion: z.string().trim().min(1).max(40),
});

function sendError(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ code, message, details: null, requestId: response.req.requestId });
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.cookie?.split(';') ?? [];
  const cookie = cookies.map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
}

function setRefreshCookie(response: Response, token: string, maxAgeSeconds: number) {
  const secure = environment.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `placeprep_refresh=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=${maxAgeSeconds}${secure}`);
}

function clearRefreshCookie(response: Response) {
  const secure = environment.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `placeprep_refresh=; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=0${secure}`);
}

function createRefreshToken() {
  return createOpaqueToken();
}

async function createActionToken(client: PoolClient, userId: string, purpose: 'verify_email' | 'reset_password', expiresInHours: number) {
  const token = createOpaqueToken();
  await client.query(
    `INSERT INTO account_action_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 hour'))`,
    [userId, purpose, hashToken(token), expiresInHours],
  );
  return token;
}

export function createAuthRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const authenticate = requireAuthentication(pool, accessSecret);

  router.post('/register', asyncHandler(async (request, response, next) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Enter a valid name, email, password, and signup role.');
    if (!passwordMeetsPolicy(parsed.data.password)) {
      return sendError(response, 400, 'WEAK_PASSWORD', 'Password must include upper- and lowercase letters, a number, and a special character.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const email = parsed.data.email.toLowerCase();
      const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 409, 'EMAIL_IN_USE', 'An account with this email already exists.');
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const inserted = await client.query(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
        [email, passwordHash, parsed.data.name],
      );
      const userId = inserted.rows[0].id as string;
      const role = await client.query('SELECT id FROM roles WHERE slug = $1', [parsed.data.role]);
      if (!role.rowCount) throw new Error('Signup role is missing from the database seed.');
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, role.rows[0].id]);
      if (parsed.data.role === 'candidate') {
        await client.query('INSERT INTO candidate_profiles (user_id) VALUES ($1)', [userId]);
      }
      const verificationToken = await createActionToken(client, userId, 'verify_email', 24);
      await client.query('COMMIT');

      response.status(201).json({
        message: 'Account created. Verify your email before signing in.',
        ...(environment.NODE_ENV === 'development' ? { developmentVerificationToken: verificationToken } : {}),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  router.post('/verify-email', asyncHandler(async (request, response, next) => {
    const parsed = tokenSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'A valid verification token is required.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT id, user_id FROM account_action_tokens
         WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashToken(parsed.data.token)],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 400, 'INVALID_TOKEN', 'This verification link is invalid or expired.');
      }
      await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [result.rows[0].user_id]);
      await client.query('UPDATE account_action_tokens SET used_at = now() WHERE id = $1', [result.rows[0].id]);
      await client.query('COMMIT');
      response.json({ message: 'Email verified. You can now sign in.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  router.post('/login', asyncHandler(async (request, response, next) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Enter a valid email and password.');
    try {
      const email = parsed.data.email.toLowerCase();
      const result = await pool.query(
        `SELECT id, email, name, password_hash, email_verified_at, suspended_at, deleted_at, locked_until
         FROM users WHERE email = $1`,
        [email],
      );
      const user = result.rows[0];
      if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        return sendError(response, 423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
      }
      if (!user || user.deleted_at || user.suspended_at || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
        if (user && !user.deleted_at && !user.suspended_at) {
          await pool.query(
            `UPDATE users SET failed_login_count = failed_login_count + 1,
              locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
             WHERE id = $1`,
            [user.id],
          );
        }
        return sendError(response, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      if (!user.email_verified_at) return sendError(response, 403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in.');

      const maxAgeSeconds = parsed.data.rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
      const refreshToken = createRefreshToken();
      const familyId = randomUUID();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
        `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
        [user.id],
        );
        await client.query(
        `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
        [user.id, familyId, hashToken(refreshToken), maxAgeSeconds],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      setRefreshCookie(response, refreshToken, maxAgeSeconds);
      response.json({ accessToken: createAccessToken(user.id, accessSecret), user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
      next(error);
    }
  }));

  router.post('/refresh', asyncHandler(async (request, response, next) => {
    const token = readCookie(request, 'placeprep_refresh');
    if (!token) return sendError(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT id, user_id, family_id, expires_at, revoked_at
         FROM refresh_sessions WHERE token_hash = $1 FOR UPDATE`,
        [hashToken(token)],
      );
      const session = result.rows[0];
      if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        clearRefreshCookie(response);
        return sendError(response, 401, 'INVALID_SESSION', 'Your session has expired. Sign in again.');
      }
      if (session.revoked_at) {
        await client.query('UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1', [session.family_id]);
        await client.query('COMMIT');
        clearRefreshCookie(response);
        return sendError(response, 401, 'SESSION_REPLAYED', 'This session is no longer valid. Sign in again.');
      }

      const userResult = await client.query(
        'SELECT id, email, name FROM users WHERE id = $1 AND email_verified_at IS NOT NULL AND suspended_at IS NULL AND deleted_at IS NULL',
        [session.user_id],
      );
      if (!userResult.rowCount) {
        await client.query('UPDATE refresh_sessions SET revoked_at = now() WHERE family_id = $1', [session.family_id]);
        await client.query('COMMIT');
        clearRefreshCookie(response);
        return sendError(response, 401, 'INVALID_SESSION', 'Your session is no longer valid.');
      }

      const nextToken = createRefreshToken();
      const remainingSeconds = Math.max(1, Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000));
      const inserted = await client.query(
        `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [session.user_id, session.family_id, hashToken(nextToken), session.expires_at],
      );
      await client.query(
        'UPDATE refresh_sessions SET revoked_at = now(), replaced_by = $2 WHERE id = $1',
        [session.id, inserted.rows[0].id],
      );
      await client.query('COMMIT');
      setRefreshCookie(response, nextToken, remainingSeconds);
      response.json({
        accessToken: createAccessToken(userResult.rows[0].id, accessSecret),
        user: { id: userResult.rows[0].id, email: userResult.rows[0].email, name: userResult.rows[0].name },
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  router.post('/logout', asyncHandler(async (request, response, next) => {
    const token = readCookie(request, 'placeprep_refresh');
    try {
      if (token) await pool.query('UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1', [hashToken(token)]);
      clearRefreshCookie(response);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  }));

  router.post('/forgot', asyncHandler(async (request, response, next) => {
    const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Enter a valid email address.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [parsed.data.email.toLowerCase()]);
      let developmentResetToken: string | undefined;
      if (user.rowCount) {
        await client.query("UPDATE account_action_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL", [user.rows[0].id]);
        developmentResetToken = await createActionToken(client, user.rows[0].id, 'reset_password', 1);
      }
      await client.query('COMMIT');
      response.json({
        message: 'If an account exists for that email, password reset instructions will be sent.',
        ...(environment.NODE_ENV === 'development' && developmentResetToken ? { developmentResetToken } : {}),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  router.post('/reset', asyncHandler(async (request, response, next) => {
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'A valid reset token and password are required.');
    if (!passwordMeetsPolicy(parsed.data.password)) return sendError(response, 400, 'WEAK_PASSWORD', 'Password must include upper- and lowercase letters, a number, and a special character.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const token = await client.query(
        `SELECT id, user_id FROM account_action_tokens
         WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashToken(parsed.data.token)],
      );
      if (!token.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 400, 'INVALID_TOKEN', 'This reset link is invalid or expired.');
      }
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      await client.query('UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1', [token.rows[0].user_id, passwordHash]);
      await client.query('UPDATE account_action_tokens SET used_at = now() WHERE id = $1', [token.rows[0].id]);
      await client.query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [token.rows[0].user_id]);
      await client.query('COMMIT');
      response.json({ message: 'Password updated. Sign in with your new password.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  router.get('/me', authenticate, requireRoles('candidate', 'recruiter', 'placement_officer', 'mentor', 'super_admin'), asyncHandler(async (request, response, next) => {
    try {
      const user = request.authenticatedUser!;
      const result = await pool.query(
        `SELECT u.id, u.email, u.name, u.email_verified_at, u.created_at,
          cp.phone, cp.degree, cp.branch, cp.graduation_year, cp.cgpa, cp.location,
          cp.links, cp.target_roles, cp.preferred_job_type, cp.recruiter_visibility
         FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = $1`,
        [user.id],
      );
      response.json({ ...result.rows[0], roles: user.roles });
    } catch (error) {
      next(error);
    }
  }));

  router.put('/me', authenticate, requireRoles('candidate', 'recruiter', 'placement_officer', 'mentor', 'super_admin'), asyncHandler(async (request, response, next) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'One or more profile fields are invalid.');
    const data = parsed.data;
    const user = request.authenticatedUser!;
    const candidateFields = ['phone', 'degree', 'branch', 'graduationYear', 'cgpa', 'location', 'links', 'targetRoles', 'preferredJobType', 'recruiterVisibility'];
    if (!user.roles.includes('candidate') && candidateFields.some((field) => Object.hasOwn(data, field))) {
      return sendError(response, 403, 'FORBIDDEN', 'Candidate profile fields are only available to candidate accounts.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (data.name !== undefined) {
        await client.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [user.id, data.name]);
      }
      if (user.roles.includes('candidate')) await client.query(
        `INSERT INTO candidate_profiles (
          user_id, phone, degree, branch, graduation_year, cgpa, location, links, target_roles, preferred_job_type, recruiter_visibility
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (user_id) DO UPDATE SET
          phone = CASE WHEN $12 THEN $2 ELSE candidate_profiles.phone END,
          degree = CASE WHEN $13 THEN $3 ELSE candidate_profiles.degree END,
          branch = CASE WHEN $14 THEN $4 ELSE candidate_profiles.branch END,
          graduation_year = CASE WHEN $15 THEN $5 ELSE candidate_profiles.graduation_year END,
          cgpa = CASE WHEN $16 THEN $6 ELSE candidate_profiles.cgpa END,
          location = CASE WHEN $17 THEN $7 ELSE candidate_profiles.location END,
          links = CASE WHEN $18 THEN $8 ELSE candidate_profiles.links END,
          target_roles = CASE WHEN $19 THEN $9 ELSE candidate_profiles.target_roles END,
          preferred_job_type = CASE WHEN $20 THEN $10 ELSE candidate_profiles.preferred_job_type END,
          recruiter_visibility = CASE WHEN $21 THEN $11 ELSE candidate_profiles.recruiter_visibility END,
          updated_at = now()`,
        [
          user.id,
          data.phone ?? null,
          data.degree ?? null,
          data.branch ?? null,
          data.graduationYear ?? null,
          data.cgpa ?? null,
          data.location ?? null,
          data.links === undefined ? '{}' : JSON.stringify(data.links),
          data.targetRoles ?? [],
          data.preferredJobType ?? null,
          data.recruiterVisibility ?? false,
          Object.hasOwn(data, 'phone'),
          Object.hasOwn(data, 'degree'),
          Object.hasOwn(data, 'branch'),
          Object.hasOwn(data, 'graduationYear'),
          Object.hasOwn(data, 'cgpa'),
          Object.hasOwn(data, 'location'),
          Object.hasOwn(data, 'links'),
          Object.hasOwn(data, 'targetRoles'),
          Object.hasOwn(data, 'preferredJobType'),
          Object.hasOwn(data, 'recruiterVisibility'),
        ],
      );
      await client.query('COMMIT');
      response.json({ message: 'Profile updated.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  router.get('/me/consents', authenticate, requireRoles('candidate', 'recruiter', 'placement_officer', 'mentor', 'super_admin'), asyncHandler(async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT DISTINCT ON (consent_type) consent_type, granted, policy_version, recorded_at
         FROM consent_records WHERE user_id = $1
         ORDER BY consent_type, recorded_at DESC`,
        [request.authenticatedUser!.id],
      );
      response.json({ consents: result.rows });
    } catch (error) {
      next(error);
    }
  }));

  router.put('/me/consents', authenticate, requireRoles('candidate', 'recruiter', 'placement_officer', 'mentor', 'super_admin'), asyncHandler(async (request, response, next) => {
    const parsed = consentSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Provide valid consent choices and a policy version.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const consent of parsed.data.consents) {
        await client.query(
          `INSERT INTO consent_records (user_id, consent_type, granted, policy_version)
           VALUES ($1, $2, $3, $4)`,
          [request.authenticatedUser!.id, consent.type, consent.granted, parsed.data.policyVersion],
        );
      }
      await client.query('COMMIT');
      response.json({ message: 'Consent preferences updated.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  router.get('/me/export', authenticate, requireRoles('candidate', 'recruiter', 'placement_officer', 'mentor', 'super_admin'), asyncHandler(async (request, response, next) => {
    const userId = request.authenticatedUser!.id;
    try {
      const [profile, resumes, analyses, attempts, interviews, applications, consents, outcomes] = await Promise.all([
        pool.query(
          `SELECT u.id, u.email, u.name, u.email_verified_at, u.created_at,
            cp.phone, cp.degree, cp.branch, cp.graduation_year, cp.cgpa, cp.location,
            cp.links, cp.target_roles, cp.preferred_job_type, cp.recruiter_visibility
           FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = $1`,
          [userId],
        ),
        pool.query(
          `SELECT r.id, r.title, r.is_primary, r.created_at,
            COALESCE(json_agg(json_build_object('id', rv.id, 'version', rv.version_number, 'filename', rv.original_filename, 'createdAt', rv.created_at))
              FILTER (WHERE rv.id IS NOT NULL), '[]') AS versions
           FROM resumes r LEFT JOIN resume_versions rv ON rv.resume_id = r.id
           WHERE r.candidate_id = $1 GROUP BY r.id ORDER BY r.created_at`,
          [userId],
        ),
        pool.query(
          `SELECT ra.id, ra.overall_score, ra.sub_scores, ra.verdict, ra.analysis_version, ra.created_at,
            COALESCE(json_agg(json_build_object('severity', ri.severity, 'category', ri.category, 'issue', ri.issue, 'suggestedFix', ri.suggested_fix))
              FILTER (WHERE ri.id IS NOT NULL), '[]') AS issues
           FROM resume_analyses ra JOIN resume_versions rv ON rv.id = ra.resume_version_id
           JOIN resumes r ON r.id = rv.resume_id LEFT JOIN resume_issues ri ON ri.analysis_id = ra.id
           WHERE r.candidate_id = $1 GROUP BY ra.id ORDER BY ra.created_at`,
          [userId],
        ),
        pool.query('SELECT id, assessment_id, started_at, submitted_at, total_score, status FROM assessment_attempts WHERE candidate_id = $1 ORDER BY started_at', [userId]),
        pool.query('SELECT id, interview_type, mode, status, started_at, finished_at FROM interview_sessions WHERE candidate_id = $1 ORDER BY started_at', [userId]),
        pool.query('SELECT id, job_id, status, applied_at FROM applications WHERE candidate_id = $1 ORDER BY applied_at', [userId]),
        pool.query('SELECT consent_type, granted, policy_version, recorded_at FROM consent_records WHERE user_id = $1 ORDER BY recorded_at', [userId]),
        pool.query('SELECT id, job_id, outcome, recorded_at FROM outcome_records WHERE candidate_id = $1 ORDER BY recorded_at', [userId]),
      ]);
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Content-Disposition', 'attachment; filename="placeprep-account-export.json"');
      response.json({
        exportedAt: new Date().toISOString(),
        profile: profile.rows[0],
        resumes: resumes.rows,
        resumeAnalyses: analyses.rows,
        assessmentAttempts: attempts.rows,
        interviewSessions: interviews.rows,
        applications: applications.rows,
        consents: consents.rows,
        outcomes: outcomes.rows,
      });
    } catch (error) {
      next(error);
    }
  }));

  router.delete('/me', authenticate, requireRoles('candidate', 'recruiter', 'placement_officer', 'mentor', 'super_admin'), asyncHandler(async (request, response, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userId = request.authenticatedUser!.id;
      const resumeFiles = await client.query(
        `SELECT rv.storage_key FROM resumes r JOIN resume_versions rv ON rv.resume_id = r.id
         WHERE r.candidate_id = $1`,
        [userId],
      );
      await client.query('DELETE FROM refresh_sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM account_action_tokens WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM consent_records WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM candidate_profiles WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM resumes WHERE candidate_id = $1', [userId]);
      await client.query('DELETE FROM assessment_attempts WHERE candidate_id = $1', [userId]);
      await client.query('DELETE FROM interview_sessions WHERE candidate_id = $1', [userId]);
      await client.query('DELETE FROM applications WHERE candidate_id = $1', [userId]);
      await client.query('DELETE FROM placement_probability_snapshots WHERE candidate_id = $1', [userId]);
      await client.query('DELETE FROM role_fit_results WHERE candidate_id = $1', [userId]);
      await client.query('DELETE FROM skill_gap_plans WHERE candidate_id = $1', [userId]);
      await client.query('DELETE FROM outcome_records WHERE candidate_id = $1', [userId]);
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
      await client.query(
        `UPDATE users SET email = $2, password_hash = $3, name = 'Deleted account',
          email_verified_at = NULL, suspended_at = NULL, deleted_at = now(), updated_at = now()
         WHERE id = $1`,
        [userId, `deleted-${userId}@deleted.invalid`, await bcrypt.hash(createOpaqueToken(), 12)],
      );
      await client.query('COMMIT');
      await Promise.all(resumeFiles.rows.map((row) => rm(path.join(process.cwd(), 'uploads', 'resumes', path.basename(row.storage_key)), { force: true }).catch(() => {})));
      clearRefreshCookie(response);
      response.status(204).end();
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }));

  return router;
}