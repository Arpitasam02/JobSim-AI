import { Router } from 'express';
import { randomInt } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { requireAuthentication, requireRoles } from '../auth/middleware.js';
import { scoreAssessment } from './scoring.js';

const createAssessmentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).default(''),
  durationSeconds: z.number().int().min(60).max(4 * 60 * 60),
  passingScore: z.number().min(0).max(100).nullable().optional(),
  attemptLimit: z.number().int().min(1).max(20).default(1),
  availableFrom: z.string().datetime().nullable().optional(),
  availableUntil: z.string().datetime().nullable().optional(),
  strictProctoring: z.boolean().default(false),
  randomized: z.boolean().default(true),
  published: z.boolean().default(false),
  sections: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    durationSeconds: z.number().int().positive().nullable().optional(),
    passingScore: z.number().min(0).max(100).nullable().optional(),
    questionIds: z.array(z.string().uuid()).min(1).max(100),
  })).min(1).max(20),
});

const answerUpdateSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    answer: z.unknown().nullable(),
    markedForReview: z.boolean().default(false),
    timeSpentSeconds: z.number().int().min(0).max(24 * 60 * 60).default(0),
  })).min(1).max(200),
});

const proctorEventSchema = z.object({
  eventType: z.enum(['tab_hidden', 'window_blur', 'fullscreen_exit', 'copy_attempt', 'paste_attempt', 'snapshot_captured']),
  details: z.record(z.unknown()).default({}),
});

function sendError(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ code, message, details: null, requestId: response.req.requestId });
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

async function loadAttemptQuestions(client: PoolClient, attemptId: string) {
  const result = await client.query(
    `SELECT q.id, q.prompt, q.options, q.topic, q.subtopic, q.difficulty,
      q.marks::float8 AS marks, q.negative_marks::float8 AS negative_marks,
      q.correct_answer, q.explanation
     FROM attempt_question_order aq
     JOIN questions q ON q.id = aq.question_id
     WHERE aq.attempt_id = $1 ORDER BY aq.position`,
    [attemptId],
  );
  return result.rows;
}

async function finalizeAttempt(client: PoolClient, attemptId: string, candidateId: string, status: 'submitted' | 'auto_submitted') {
  await client.query('BEGIN');
  try {
    const attemptResult = await client.query(
      `SELECT id, assessment_id, status FROM assessment_attempts
       WHERE id = $1 AND candidate_id = $2 FOR UPDATE`,
      [attemptId, candidateId],
    );
    if (!attemptResult.rowCount) {
      await client.query('ROLLBACK');
      return { error: 'ATTEMPT_NOT_FOUND' as const };
    }
    const attempt = attemptResult.rows[0];
    if (attempt.status !== 'in_progress') {
      await client.query('COMMIT');
      return { alreadySubmitted: true as const };
    }

    const [questions, savedAnswers] = await Promise.all([
      loadAttemptQuestions(client, attempt.id),
      client.query('SELECT question_id, answer FROM attempt_answers WHERE attempt_id = $1', [attemptId]),
    ]);
    const answerMap = new Map<string, unknown>(savedAnswers.rows.filter((row) => row.answer !== null).map((row) => [row.question_id as string, row.answer]));
    const scored = scoreAssessment(questions.map((question) => ({
      id: question.id,
      topic: question.topic,
      marks: Number(question.marks),
      negativeMarks: Number(question.negative_marks),
      correctAnswer: question.correct_answer,
    })), answerMap);
    await client.query(
      'UPDATE assessment_attempts SET status = $2, submitted_at = now(), total_score = $3 WHERE id = $1',
      [attemptId, status, scored.percentage],
    );
    await client.query('COMMIT');
    return { alreadySubmitted: false as const, percentage: scored.percentage };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export function createAssessmentRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const authenticate = requireAuthentication(pool, accessSecret);

  router.get('/', authenticate, requireRoles('candidate', 'recruiter', 'placement_officer', 'super_admin'), asyncHandler(async (request, response) => {
    const user = request.authenticatedUser!;
    const result = await pool.query(
      `SELECT a.id, a.title, a.description, a.duration_seconds, a.passing_score,
        a.attempt_limit, a.available_from, a.available_until, a.strict_proctoring, a.visibility,
        (SELECT count(*) FROM assessment_sections s CROSS JOIN LATERAL unnest(s.question_ids) q(id) WHERE s.assessment_id = a.id) AS question_count,
        (SELECT json_build_object('id', aa.id, 'status', aa.status, 'score', aa.total_score::float8, 'startedAt', aa.started_at)
         FROM assessment_attempts aa WHERE aa.assessment_id = a.id AND aa.candidate_id = $1
         ORDER BY aa.started_at DESC LIMIT 1) AS latest_attempt
      FROM assessments a
      LEFT JOIN assessment_assignments aa ON aa.assessment_id = a.id AND aa.candidate_id = $1
      WHERE (a.creator_id = $1 OR (a.published = true AND a.visibility = 'global') OR aa.id IS NOT NULL)
         AND (a.available_from IS NULL OR a.available_from <= now())
         AND (a.available_until IS NULL OR a.available_until > now())
       ORDER BY a.created_at DESC`,
      [user.id],
    );
    response.json({ tests: result.rows });
  }));

  router.post('/', authenticate, requireRoles('recruiter', 'placement_officer', 'super_admin'), asyncHandler(async (request, response) => {
    const parsed = createAssessmentSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Assessment configuration is invalid.');
    const user = request.authenticatedUser!;
    const questionIds = [...new Set(parsed.data.sections.flatMap((section) => section.questionIds))];
    const allQuestionIds = parsed.data.sections.flatMap((section) => section.questionIds);
    if (questionIds.length !== allQuestionIds.length) return sendError(response, 400, 'DUPLICATE_QUESTIONS', 'A question can only appear once in an assessment.');
    const questions = await pool.query(
      `SELECT id FROM questions WHERE id = ANY($1::uuid[])
        AND (owner_id IS NULL OR owner_id = $2)
        AND (visibility = 'global' OR owner_id = $2)`,
      [questionIds, user.id],
    );
    if (questions.rowCount !== questionIds.length) return sendError(response, 400, 'INVALID_QUESTIONS', 'One or more selected questions are unavailable to your account.');
    if (parsed.data.availableFrom && parsed.data.availableUntil && new Date(parsed.data.availableUntil) <= new Date(parsed.data.availableFrom)) {
      return sendError(response, 400, 'INVALID_WINDOW', 'Assessment end time must be after its start time.');
    }

    const visibility = user.roles.includes('super_admin') ? 'global' : user.roles.includes('recruiter') ? 'company' : 'institution';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const assessment = await client.query(
        `INSERT INTO assessments (
          creator_id, title, description, duration_seconds, passing_score, attempt_limit,
          available_from, available_until, strict_proctoring, randomized, published, visibility
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          user.id,
          parsed.data.title,
          parsed.data.description,
          parsed.data.durationSeconds,
          parsed.data.passingScore ?? null,
          parsed.data.attemptLimit,
          parsed.data.availableFrom ?? null,
          parsed.data.availableUntil ?? null,
          parsed.data.strictProctoring,
          parsed.data.randomized,
          parsed.data.published,
          visibility,
        ],
      );
      const assessmentId = assessment.rows[0].id as string;
      for (const [position, section] of parsed.data.sections.entries()) {
        await client.query(
          `INSERT INTO assessment_sections (assessment_id, title, position, duration_seconds, passing_score, question_ids)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [assessmentId, section.title, position, section.durationSeconds ?? null, section.passingScore ?? null, section.questionIds],
        );
      }
      await client.query('COMMIT');
      response.status(201).json({ assessmentId, message: 'Assessment created.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post('/:assessmentId/start', authenticate, requireRoles('candidate'), asyncHandler(async (request, response) => {
    const candidateId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [candidateId]);
      const assessment = await client.query(
        `SELECT a.id, a.duration_seconds, a.attempt_limit, a.randomized
         FROM assessments a LEFT JOIN assessment_assignments aa ON aa.assessment_id = a.id AND aa.candidate_id = $2
         WHERE a.id = $1 AND ((a.visibility = 'global' AND a.published = true) OR aa.id IS NOT NULL)
           AND (a.available_from IS NULL OR a.available_from <= now())
           AND (a.available_until IS NULL OR a.available_until > now())`,
        [request.params.assessmentId, candidateId],
      );
      if (!assessment.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 404, 'TEST_NOT_FOUND', 'This test is unavailable.');
      }
      const current = await client.query(
        `SELECT id, deadline_at FROM assessment_attempts
         WHERE assessment_id = $1 AND candidate_id = $2 AND status = 'in_progress'
         ORDER BY started_at DESC LIMIT 1 FOR UPDATE`,
        [assessment.rows[0].id, candidateId],
      );
      if (current.rowCount && new Date(current.rows[0].deadline_at).getTime() > Date.now()) {
        await client.query('COMMIT');
        return response.json({ attemptId: current.rows[0].id, deadlineAt: current.rows[0].deadline_at, serverTime: new Date().toISOString(), resumed: true });
      }
      if (current.rowCount) {
        await client.query("UPDATE assessment_attempts SET status = 'expired', submitted_at = now() WHERE id = $1", [current.rows[0].id]);
      }
      const count = await client.query(
        `SELECT count(*)::integer AS attempts FROM assessment_attempts
         WHERE assessment_id = $1 AND candidate_id = $2 AND status IN ('submitted', 'auto_submitted', 'expired')`,
        [assessment.rows[0].id, candidateId],
      );
      if (count.rows[0].attempts >= assessment.rows[0].attempt_limit) {
        await client.query('ROLLBACK');
        return sendError(response, 409, 'ATTEMPTS_EXHAUSTED', 'You have used all attempts for this test.');
      }
      const inserted = await client.query(
        `INSERT INTO assessment_attempts (assessment_id, candidate_id, deadline_at)
         VALUES ($1, $2, now() + ($3 * interval '1 second')) RETURNING id, deadline_at, now() AS server_time`,
        [assessment.rows[0].id, candidateId, assessment.rows[0].duration_seconds],
      );
      const attemptId = inserted.rows[0].id as string;
      const configuredQuestions = await client.query(
        `SELECT question.question_id
         FROM assessment_sections section
         CROSS JOIN LATERAL unnest(section.question_ids) WITH ORDINALITY AS question(question_id, question_position)
         WHERE section.assessment_id = $1 ORDER BY section.position, question.question_position`,
        [assessment.rows[0].id],
      );
      const orderedQuestions = assessment.rows[0].randomized
        ? shuffled(configuredQuestions.rows.map((row) => row.question_id as string))
        : configuredQuestions.rows.map((row) => row.question_id as string);
      for (const [position, questionId] of orderedQuestions.entries()) {
        await client.query(
          'INSERT INTO attempt_question_order (attempt_id, question_id, position) VALUES ($1, $2, $3)',
          [attemptId, questionId, position],
        );
      }
      await client.query('COMMIT');
      response.status(201).json({ attemptId, deadlineAt: inserted.rows[0].deadline_at, serverTime: inserted.rows[0].server_time, resumed: false });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  router.get('/attempts/:attemptId', authenticate, requireRoles('candidate'), asyncHandler(async (request, response) => {
    const candidateId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      const attemptResult = await client.query(
        `SELECT aa.id, aa.assessment_id, aa.deadline_at, aa.status, aa.submitted_at,
          a.title, a.duration_seconds, now() AS server_time
         FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
         WHERE aa.id = $1 AND aa.candidate_id = $2`,
        [request.params.attemptId, candidateId],
      );
      if (!attemptResult.rowCount) return sendError(response, 404, 'ATTEMPT_NOT_FOUND', 'Test attempt not found.');
      const attempt = attemptResult.rows[0];
      if (attempt.status === 'in_progress' && new Date(attempt.deadline_at).getTime() <= Date.now()) {
        await finalizeAttempt(client, attempt.id, candidateId, 'auto_submitted');
        return response.json({ attemptId: attempt.id, status: 'auto_submitted', submitted: true, deadlineAt: attempt.deadline_at });
      }
      const [questions, answers] = await Promise.all([
        loadAttemptQuestions(client, attempt.id),
        client.query('SELECT question_id, answer, marked_for_review, time_spent_seconds FROM attempt_answers WHERE attempt_id = $1', [attempt.id]),
      ]);
      response.json({
        attemptId: attempt.id,
        title: attempt.title,
        status: attempt.status,
        deadlineAt: attempt.deadline_at,
        serverTime: attempt.server_time,
        questions: questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          options: question.options,
          topic: question.topic,
          difficulty: question.difficulty,
          marks: question.marks,
        })),
        answers: answers.rows,
      });
    } finally {
      client.release();
    }
  }));

  router.put('/attempts/:attemptId/answers', authenticate, requireRoles('candidate'), asyncHandler(async (request, response) => {
    const parsed = answerUpdateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Answer data is invalid.');
    const candidateId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const attempt = await client.query(
        `SELECT aa.assessment_id, aa.deadline_at, aa.status, now() AS server_time
         FROM assessment_attempts aa WHERE aa.id = $1 AND aa.candidate_id = $2 FOR UPDATE`,
        [request.params.attemptId, candidateId],
      );
      if (!attempt.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 404, 'ATTEMPT_NOT_FOUND', 'Test attempt not found.');
      }
      if (attempt.rows[0].status !== 'in_progress' || new Date(attempt.rows[0].deadline_at).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return sendError(response, 409, 'ATTEMPT_CLOSED', 'This test attempt is no longer accepting answers.');
      }
      const allowedQuestionIds = new Set((await loadAttemptQuestions(client, String(request.params.attemptId))).map((question) => question.id as string));
      for (const answer of parsed.data.answers) {
        if (!allowedQuestionIds.has(answer.questionId)) {
          await client.query('ROLLBACK');
          return sendError(response, 400, 'INVALID_QUESTION', 'One or more questions are not part of this test.');
        }
        await client.query(
          `INSERT INTO attempt_answers (attempt_id, question_id, answer, marked_for_review, time_spent_seconds)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET answer = EXCLUDED.answer,
             marked_for_review = EXCLUDED.marked_for_review,
             time_spent_seconds = GREATEST(attempt_answers.time_spent_seconds, EXCLUDED.time_spent_seconds),
             updated_at = now()`,
          [request.params.attemptId, answer.questionId, answer.answer === null ? null : JSON.stringify(answer.answer), answer.markedForReview, answer.timeSpentSeconds],
        );
      }
      await client.query('COMMIT');
      response.json({ saved: parsed.data.answers.length, deadlineAt: attempt.rows[0].deadline_at, serverTime: attempt.rows[0].server_time });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post('/attempts/:attemptId/submit', authenticate, requireRoles('candidate'), asyncHandler(async (request, response) => {
    const candidateId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      const deadline = await client.query(
        'SELECT deadline_at FROM assessment_attempts WHERE id = $1 AND candidate_id = $2',
        [request.params.attemptId, candidateId],
      );
      if (!deadline.rowCount) return sendError(response, 404, 'ATTEMPT_NOT_FOUND', 'Test attempt not found.');
      const status = new Date(deadline.rows[0].deadline_at).getTime() <= Date.now() ? 'auto_submitted' : 'submitted';
      const result = await finalizeAttempt(client, String(request.params.attemptId), candidateId, status);
      if ('error' in result) return sendError(response, 404, 'ATTEMPT_NOT_FOUND', 'Test attempt not found.');
      response.json({ submitted: true, alreadySubmitted: result.alreadySubmitted, status, reportUrl: `/api/v1/tests/attempts/${request.params.attemptId}/report` });
    } finally {
      client.release();
    }
  }));

  router.get('/attempts/:attemptId/report', authenticate, requireRoles('candidate'), asyncHandler(async (request, response) => {
    const candidateId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      const attempt = await client.query(
        `SELECT aa.id, aa.assessment_id, aa.status, aa.total_score::float8 AS total_score, aa.started_at, aa.submitted_at,
          a.title, a.passing_score
         FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
         WHERE aa.id = $1 AND aa.candidate_id = $2`,
        [request.params.attemptId, candidateId],
      );
      if (!attempt.rowCount) return sendError(response, 404, 'ATTEMPT_NOT_FOUND', 'Test attempt not found.');
      if (attempt.rows[0].status === 'in_progress') return sendError(response, 409, 'REPORT_NOT_READY', 'Submit the test before viewing its report.');
      const [questions, savedAnswers] = await Promise.all([
        loadAttemptQuestions(client, attempt.rows[0].id),
        client.query('SELECT question_id, answer, time_spent_seconds FROM attempt_answers WHERE attempt_id = $1', [request.params.attemptId]),
      ]);
      const answerMap = new Map<string, unknown>(savedAnswers.rows.filter((row) => row.answer !== null).map((row) => [row.question_id as string, row.answer]));
      const scoringQuestions = questions.map((question) => ({ id: question.id, topic: question.topic, marks: Number(question.marks), negativeMarks: Number(question.negative_marks), correctAnswer: question.correct_answer }));
      const score = scoreAssessment(scoringQuestions, answerMap);
      const timeByQuestion = new Map(savedAnswers.rows.map((row) => [row.question_id as string, row.time_spent_seconds as number]));
      response.json({
        attempt: attempt.rows[0],
        score: score.percentage,
        topicBreakdown: score.topicBreakdown,
        answerReview: questions.map((question, index) => ({
          id: question.id,
          prompt: question.prompt,
          options: question.options,
          topic: question.topic,
          answer: score.answers[index].answer,
          correctAnswer: question.correct_answer,
          isCorrect: score.answers[index].isCorrect,
          explanation: question.explanation,
          timeSpentSeconds: timeByQuestion.get(question.id) ?? 0,
        })),
      });
    } finally {
      client.release();
    }
  }));

  router.post('/attempts/:attemptId/proctor-events', authenticate, requireRoles('candidate'), asyncHandler(async (request, response) => {
    const parsed = proctorEventSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Proctor event is invalid.');
    const candidateId = request.authenticatedUser!.id;
    const consent = await pool.query(
      `SELECT granted FROM consent_records WHERE user_id = $1 AND consent_type = 'proctoring'
       ORDER BY recorded_at DESC LIMIT 1`,
      [candidateId],
    );
    if (!consent.rows[0]?.granted) return sendError(response, 403, 'CONSENT_REQUIRED', 'Proctoring events require your consent.');
    const attempt = await pool.query('SELECT id FROM assessment_attempts WHERE id = $1 AND candidate_id = $2 AND status = $3', [request.params.attemptId, candidateId, 'in_progress']);
    if (!attempt.rowCount) return sendError(response, 404, 'ATTEMPT_NOT_FOUND', 'Active test attempt not found.');
    await pool.query(
      'INSERT INTO proctor_events (attempt_id, event_type, details) VALUES ($1, $2, $3)',
      [request.params.attemptId, parsed.data.eventType, JSON.stringify(parsed.data.details)],
    );
    response.status(202).json({ recorded: true });
  }));

  return router;
}