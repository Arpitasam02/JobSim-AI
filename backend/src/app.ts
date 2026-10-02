import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { createAuthRouter } from './auth/routes.js';
import { createResumeRouter } from './resumes/routes.js';
import { createRoleRouter } from './roles/routes.js';
import { createAssessmentRouter } from './assessments/routes.js';
import { createInterviewRouter } from './interviews/routes.js';
import { createApplicationDecisionRouter, createCandidateJobsRouter, createRecruiterJobsRouter } from './jobs/routes.js';
import { classifyDatabaseConnectionError, withTransientDbRetry } from './db.js';

function redactErrorText(value: string | undefined) {
  return (value ?? 'Unknown error')
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi, '[REDACTED_CONNECTION_STRING]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/\b([A-Z0-9_-]*(?:password|passwd|pwd|token|secret|api[_-]?key|database[_-]?url)[A-Z0-9_-]*)(\s*[:=]\s*|\s+)[^\s,;"'`]+/gi, '$1$2[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]');
}

export function createApp(pool: Pool, accessSecret: string) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173', credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use((request, response, next) => {
    const requestId = request.header('x-request-id')?.slice(0, 100) || randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  });

  app.get('/api/v1/health', async (_request, response) => {
    try {
      await withTransientDbRetry(() => pool.query('SELECT 1'), 'database health check');
      response.status(200).json({ status: 'ok', service: 'placeprep-api', database: 'connected' });
    } catch (error: unknown) {
      const errorCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : null;
      const rawMessage = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : String(error ?? '');
      const message = redactErrorText(rawMessage || 'Database health check failed without an error message.');
      const classifiedReason = classifyDatabaseConnectionError(error);
      const reason = classifiedReason !== 'UNKNOWN'
        ? classifiedReason
        : errorCode ?? (rawMessage ? 'DATABASE_ERROR' : 'UNKNOWN');

      console.error('Database health check failed', { reason, code: errorCode, message, requestId: _request.requestId });
      response.status(503).json({
        status: 'degraded',
        service: 'placeprep-api',
        database: 'unavailable',
        reason,
      });
    }
  });

  app.get('/api/v1/roles', async (_request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT rc.id, rc.slug, rc.name, rc.description,
          COALESCE(json_agg(json_build_object('name', s.name, 'weight', rsk.weight, 'mustHave', rsk.must_have))
            FILTER (WHERE s.id IS NOT NULL), '[]') AS skills
         FROM role_catalog rc LEFT JOIN role_skill_weights rsk ON rsk.role_id = rc.id
         LEFT JOIN skills s ON s.id = rsk.skill_id
         WHERE rc.active = true GROUP BY rc.id ORDER BY rc.name`,
      );
      response.json({ roles: result.rows });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/v1/auth', createAuthRouter(pool, accessSecret));
  app.use('/api/v1/resumes', createResumeRouter(pool, accessSecret));
  app.use('/api/v1/me', createRoleRouter(pool, accessSecret));
  app.use('/api/v1/tests', createAssessmentRouter(pool, accessSecret));
  app.use('/api/v1/interviews', createInterviewRouter(pool, accessSecret));
  app.use('/api/v1/jobs', createCandidateJobsRouter(pool, accessSecret));
  app.use('/api/v1/recruiter', createRecruiterJobsRouter(pool, accessSecret));
  app.use('/api/v1/applications', createApplicationDecisionRouter(pool, accessSecret));

  app.use((_request, response) => {
    response.status(404).json({
      code: 'NOT_FOUND',
      message: 'The requested endpoint does not exist.',
      details: null,
      requestId: response.getHeader('x-request-id'),
    });
  });

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 500;
    const rawErrorCode = error instanceof Error && 'code' in error && typeof (error as { code?: string }).code === 'string'
      ? (error as { code: string }).code
      : 'UNKNOWN_ERROR';
    const errorCode = /^[A-Z0-9_]+$/.test(rawErrorCode) ? rawErrorCode : 'UNKNOWN_ERROR';
    const errorMessage = redactErrorText(error instanceof Error ? error.message : undefined);
    const stack = redactErrorText(error instanceof Error ? error.stack : undefined);

    console.error('Unhandled API error', {
      requestId: request.requestId,
      status,
      errorCode,
      message: errorMessage,
      stack,
    });

    response.status(status).json({
      code: status === 413 ? 'FILE_TOO_LARGE' : status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      message: status === 413 ? 'Resume files must be 5 MB or smaller.' : status === 400 ? 'The request body is invalid.' : 'An unexpected error occurred.',
      details: null,
      requestId: request.requestId,
    });
  });

  return app;
}