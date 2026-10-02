import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthentication, requireRoles } from '../auth/middleware.js';
import { evaluateTextInterview } from './evaluator.js';

const createSchema = z.object({
  type: z.enum(['hr_behavioral', 'technical', 'project_deep_dive', 'managerial', 'case_situational', 'full_simulation']),
  mode: z.enum(['text', 'voice', 'video']).default('text'),
  roleId: z.string().uuid().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).default(15),
});

const answerSchema = z.object({ questionId: z.string().uuid(), answer: z.string().trim().max(20_000) });

function sendError(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ code, message, details: null, requestId: response.req.requestId });
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function buildQuestions(type: string, roleName: string, skills: string[], project: string | null, difficulty: 'easy' | 'medium' | 'hard') {
  const questions: Array<{ question: string; outline: string }> = [];
  if (type === 'project_deep_dive' || type === 'full_simulation') {
    if (project) {
      questions.push({
        question: `Walk me through this project from your resume: "${project.slice(0, 240)}" What problem were you solving, what did you personally build, and how did you verify the result?`,
        outline: 'Explain the user or technical problem, your specific contribution, key choices, testing or validation, and an accurate outcome.',
      });
    }
  }
  if (type === 'hr_behavioral' || type === 'managerial' || type === 'full_simulation') {
    questions.push({ question: 'Tell me about a time you received difficult feedback. What did you do next?', outline: 'Use context, the feedback, the specific change you made, and what you learned.' });
    questions.push({ question: 'Describe a time you worked through a disagreement on a team.', outline: 'Explain the shared goal, how you listened and communicated, the resolution, and your part in it.' });
  }
  if (type === 'case_situational') {
    questions.push({ question: 'A project is behind schedule and a key requirement is unclear. How would you decide what to do first?', outline: 'Clarify constraints, identify impact and dependencies, communicate tradeoffs, and propose a testable next step.' });
  }
  if (type === 'technical' || type === 'project_deep_dive' || type === 'full_simulation') {
    const isComputerScienceRole = /software|computer|developer|engineer|qa|quality/i.test(roleName)
      || skills.some((skill) => /programming|data structures|algorithms/i.test(skill));
    if (isComputerScienceRole) {
      const dsaQuestions = {
        easy: 'Given an unsorted array, explain how you would find its largest value. What is the time complexity, and how would you handle an empty array?',
        medium: 'Given an array of integers and a target, describe an algorithm that finds two values adding to the target. Compare a hash map with a nested-loop solution for time and space.',
        hard: 'Given a directed graph of course prerequisites, explain how to detect a cycle and produce a valid order when one exists. Discuss the algorithm and its complexity.',
      };
      questions.push({
        question: `${difficulty}-level DSA for ${roleName}: ${dsaQuestions[difficulty]}`,
        outline: 'State the algorithm, explain the data structure and edge cases, then analyze time and space complexity. For harder levels, discuss why the approach is correct.',
      });
    }
    for (const skill of skills.slice(0, 3)) {
      questions.push({ question: `At ${difficulty} level, explain a ${skill} concept relevant to ${roleName}. How would you apply it, and what tradeoff or limitation should you consider?`, outline: `Explain the ${skill} concept at ${difficulty} depth, give a practical application, compare alternatives, and describe how you would validate the choice.` });
    }
    if (!skills.length) {
      questions.push({ question: `What fundamentals are most important for an entry-level ${roleName} role, and how have you practiced them?`, outline: 'Name relevant fundamentals, describe a practice example, and explain how you assessed your understanding.' });
    }
  }
  if (!questions.length) {
    questions.push({ question: 'Tell me about a piece of work you are proud of and the part you personally contributed.', outline: 'Provide context, your actions, a result or learning, and what you would improve next.' });
  }
  return questions.slice(0, 6);
}

export function createInterviewRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const authenticate = requireAuthentication(pool, accessSecret);
  const candidateOnly = requireRoles('candidate');

  router.get('/', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT s.id, s.interview_type, s.mode, s.difficulty, s.status, s.started_at, s.finished_at, rc.name AS role_name,
        (SELECT count(*)::integer FROM interview_questions q WHERE q.session_id = s.id) AS question_count
       FROM interview_sessions s LEFT JOIN role_catalog rc ON rc.id = s.role_id
       WHERE s.candidate_id = $1 ORDER BY s.started_at DESC LIMIT 50`,
      [request.authenticatedUser!.id],
    );
    response.json({ interviews: result.rows });
  }));

  router.post('/', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Interview setup is invalid.');
    if (parsed.data.mode !== 'text') return sendError(response, 501, 'MODE_UNAVAILABLE', 'Voice and video interview modes are not available yet. Choose text mode.');
    const candidateId = request.authenticatedUser!.id;
    let roleName = 'your target role';
    let skills: string[] = [];
    if (parsed.data.roleId) {
      const role = await pool.query(
        `SELECT rc.id, rc.name, COALESCE(array_agg(s.name ORDER BY rsk.must_have DESC, rsk.weight DESC)
          FILTER (WHERE s.id IS NOT NULL), '{}') AS skills
         FROM role_catalog rc LEFT JOIN role_skill_weights rsk ON rsk.role_id = rc.id
         LEFT JOIN skills s ON s.id = rsk.skill_id
         WHERE rc.id = $1 AND rc.active = true GROUP BY rc.id`,
        [parsed.data.roleId],
      );
      if (!role.rowCount) return sendError(response, 404, 'ROLE_NOT_FOUND', 'The selected role does not exist.');
      roleName = role.rows[0].name as string;
      skills = (role.rows[0].skills as string[]).slice(0, 4);
    }

    const resume = await pool.query(
      `SELECT rv.parsed_data FROM resumes r JOIN resume_versions rv ON rv.resume_id = r.id
       WHERE r.candidate_id = $1 ORDER BY r.is_primary DESC, rv.version_number DESC LIMIT 1`,
      [candidateId],
    );
    const parsedResume = resume.rows[0]?.parsed_data as { projects?: string[] } | undefined;
    const project = parsed.data.type === 'project_deep_dive' || parsed.data.type === 'full_simulation'
      ? parsedResume?.projects?.[0]?.replace(/[\r\n\t]/g, ' ').slice(0, 240) ?? null
      : null;
    const questions = buildQuestions(parsed.data.type, roleName, skills, project, parsed.data.difficulty);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query(
        `INSERT INTO interview_sessions (candidate_id, role_id, interview_type, mode, difficulty, status)
         VALUES ($1, $2, $3, 'text', $4, 'in_progress') RETURNING id`,
        [candidateId, parsed.data.roleId ?? null, parsed.data.type, parsed.data.difficulty],
      );
      const sessionId = session.rows[0].id as string;
      for (const [position, question] of questions.entries()) {
        await client.query(
          'INSERT INTO interview_questions (session_id, question, ideal_answer_outline, position) VALUES ($1, $2, $3, $4)',
          [sessionId, question.question, question.outline, position],
        );
      }
      await client.query('COMMIT');
      response.status(201).json({ sessionId, mode: 'text', questionCount: questions.length, message: 'Text interview created.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  router.get('/:sessionId', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const candidateId = request.authenticatedUser!.id;
    const session = await pool.query(
      `SELECT id, interview_type, mode, difficulty, status, started_at, finished_at
       FROM interview_sessions WHERE id = $1 AND candidate_id = $2`,
      [request.params.sessionId, candidateId],
    );
    if (!session.rowCount) return sendError(response, 404, 'INTERVIEW_NOT_FOUND', 'Interview not found.');
    const result = await pool.query(
      `SELECT q.id, q.question, q.position, a.answer_text, a.created_at AS answered_at
       FROM interview_questions q LEFT JOIN interview_answers a ON a.question_id = q.id
       WHERE q.session_id = $1 ORDER BY q.position`,
      [session.rows[0].id],
    );
    const nextQuestion = result.rows.find((item) => item.answered_at === null) ?? null;
    response.json({ session: session.rows[0], currentQuestion: nextQuestion ? { id: nextQuestion.id, question: nextQuestion.question, position: nextQuestion.position } : null, answers: result.rows.filter((item) => item.answered_at !== null).map((item) => ({ questionId: item.id, question: item.question, answer: item.answer_text, answeredAt: item.answered_at })) });
  }));

  router.post('/:sessionId/answer', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const parsed = answerSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Provide a question and an answer of up to 20,000 characters.');
    const candidateId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query(
        `SELECT id FROM interview_sessions WHERE id = $1 AND candidate_id = $2 AND status = 'in_progress' FOR UPDATE`,
        [request.params.sessionId, candidateId],
      );
      if (!session.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 404, 'INTERVIEW_NOT_FOUND', 'Active interview not found.');
      }
      const nextQuestion = await client.query(
        `SELECT q.id, q.question, q.position FROM interview_questions q
         LEFT JOIN interview_answers a ON a.question_id = q.id
         WHERE q.session_id = $1 AND a.id IS NULL ORDER BY q.position LIMIT 1 FOR UPDATE OF q`,
        [session.rows[0].id],
      );
      if (!nextQuestion.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 409, 'INTERVIEW_COMPLETE', 'There are no unanswered questions. Finish the interview to see your report.');
      }
      if (nextQuestion.rows[0].id !== parsed.data.questionId) {
        await client.query('ROLLBACK');
        return sendError(response, 409, 'OUT_OF_ORDER', 'Answer the current interview question before continuing.');
      }
      const inserted = await client.query(
        'INSERT INTO interview_answers (question_id, answer_text) VALUES ($1, $2) RETURNING id',
        [parsed.data.questionId, parsed.data.answer],
      );
      await client.query('COMMIT');
      response.status(201).json({ answerId: inserted.rows[0].id, saved: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post('/:sessionId/finish', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const candidateId = request.authenticatedUser!.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query(
        `SELECT id FROM interview_sessions WHERE id = $1 AND candidate_id = $2 AND status = 'in_progress' FOR UPDATE`,
        [request.params.sessionId, candidateId],
      );
      if (!session.rowCount) {
        await client.query('ROLLBACK');
        return sendError(response, 404, 'INTERVIEW_NOT_FOUND', 'Active interview not found.');
      }
      const result = await client.query(
        `SELECT q.id, q.question, q.ideal_answer_outline, a.answer_text
         FROM interview_questions q LEFT JOIN interview_answers a ON a.question_id = q.id
         WHERE q.session_id = $1 ORDER BY q.position`,
        [session.rows[0].id],
      );
      const evaluation = evaluateTextInterview(
        result.rows.map((row) => ({ id: row.id as string, question: row.question as string, idealAnswerOutline: row.ideal_answer_outline as string | null })),
        result.rows.filter((row) => row.answer_text !== null).map((row) => ({ questionId: row.id as string, answerText: row.answer_text as string })),
      );
      await client.query(
        `INSERT INTO interview_evaluations (
          session_id, evaluation_type, overall_score, rubric, strengths, improvements, shortlist_recommendation
        ) VALUES ($1, 'rule_based', $2, $3, $4, $5, $6)`,
        [session.rows[0].id, evaluation.overallScore, JSON.stringify({ modelVersion: evaluation.modelVersion, questions: evaluation.questions }), JSON.stringify(evaluation.strengths), JSON.stringify(evaluation.improvements), evaluation.shortlistRecommendation],
      );
      await client.query("UPDATE interview_sessions SET status = 'completed', finished_at = now() WHERE id = $1", [session.rows[0].id]);
      await client.query('COMMIT');
      response.json({ message: 'Interview finished.', overallScore: evaluation.overallScore, shortlistRecommendation: evaluation.shortlistRecommendation });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));

  router.get('/:sessionId/report', authenticate, candidateOnly, asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT s.id, s.interview_type, s.mode, s.finished_at,
        e.evaluation_type, e.overall_score::float8 AS overall_score,
        e.rubric, e.strengths, e.improvements, e.shortlist_recommendation
       FROM interview_sessions s JOIN interview_evaluations e ON e.session_id = s.id
       WHERE s.id = $1 AND s.candidate_id = $2`,
      [request.params.sessionId, request.authenticatedUser!.id],
    );
    if (!result.rowCount) return sendError(response, 404, 'REPORT_NOT_FOUND', 'Interview report not found.');
    response.json({ report: result.rows[0] });
  }));

  return router;
}