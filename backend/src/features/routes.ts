import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthentication, requireRoles } from '../auth/middleware.js';

type Handler = (req: any, res: any, next: any) => Promise<unknown>;
function asyncHandler(fn: Handler) {
  return (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch((err: unknown) => {
    // If a table doesn't exist yet, return empty rather than 500
    if (err instanceof Error && 'code' in err && (err as any).code === '42P01') {
      res.json({ error: 'Feature tables not yet migrated.', data: null });
      return;
    }
    next(err);
  });
}

function sendError(res: any, status: number, code: string, message: string) {
  res.status(status).json({ code, message, details: null });
}

async function upsertStreak(pool: Pool, userId: string, activityType: string, activityId?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const today = new Date().toISOString().slice(0, 10);

    if (activityId) {
      await client.query(
        `INSERT INTO practice_activity_log (user_id, activity_type, activity_id, practice_date)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [userId, activityType, activityId, today],
      );
    } else {
      await client.query(
        `INSERT INTO practice_activity_log (user_id, activity_type, practice_date) VALUES ($1, $2, $3)`,
        [userId, activityType, today],
      );
    }

    const todayCount = await client.query(
      `SELECT count(*) AS cnt FROM practice_activity_log WHERE user_id = $1 AND practice_date = $2`,
      [userId, today],
    );
    if (Number(todayCount.rows[0].cnt) > 1) {
      await client.query('COMMIT');
      return;
    }

    const existing = await client.query(
      `SELECT current_streak, longest_streak, total_practice_days, last_practice_date
       FROM practice_streaks WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    let currentStreak = 1;
    let longestStreak = 1;
    let totalDays = 1;

    if (existing.rowCount) {
      const row = existing.rows[0];
      const last = row.last_practice_date ? new Date(row.last_practice_date).toISOString().slice(0, 10) : null;
      const todayDate = new Date(today);
      const yesterday = new Date(todayDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      totalDays = Number(row.total_practice_days) + 1;

      if (last === yesterdayStr) {
        currentStreak = Number(row.current_streak) + 1;
      } else if (last === today) {
        await client.query('COMMIT');
        return;
      } else {
        currentStreak = 1;
      }
      longestStreak = Math.max(Number(row.longest_streak), currentStreak);
    }

    await client.query(
      `INSERT INTO practice_streaks (user_id, current_streak, longest_streak, total_practice_days, last_practice_date, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = $2, longest_streak = $3,
         total_practice_days = $4, last_practice_date = $5, updated_at = now()`,
      [userId, currentStreak, longestStreak, totalDays, today],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function createStreakRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const auth = requireAuthentication(pool, accessSecret);
  const candidate = requireRoles('candidate');

  router.get('/', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    const [streakResult, activityResult] = await Promise.all([
      pool.query(
        `SELECT current_streak, longest_streak, total_practice_days, last_practice_date
         FROM practice_streaks WHERE user_id = $1`,
        [userId],
      ),
      pool.query(
        `SELECT practice_date, array_agg(activity_type) AS activities
         FROM practice_activity_log WHERE user_id = $1 AND practice_date >= CURRENT_DATE - INTERVAL '90 days'
         GROUP BY practice_date ORDER BY practice_date DESC`,
        [userId],
      ),
    ]);

    const streak = streakResult.rows[0] ?? { current_streak: 0, longest_streak: 0, total_practice_days: 0, last_practice_date: null };
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = streak.last_practice_date ? new Date(streak.last_practice_date).toISOString().slice(0, 10) : null;

    res.json({
      currentStreak: Number(streak.current_streak),
      longestStreak: Number(streak.longest_streak),
      totalPracticeDays: Number(streak.total_practice_days),
      lastPracticeDate: streak.last_practice_date,
      practicedToday: lastDate === today,
      activityLog: activityResult.rows.map((row) => ({
        date: new Date(row.practice_date).toISOString().slice(0, 10),
        activities: row.activities,
      })),
    });
  }));

  router.post('/log', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const schema = z.object({
      activityType: z.enum(['mock_test', 'mock_interview', 'challenge', 'coding_problem', 'resume_analysis']),
      activityId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid activity data.');
    await upsertStreak(pool, req.authenticatedUser!.id, parsed.data.activityType, parsed.data.activityId);
    res.json({ logged: true });
  }));

  return router;
}

const SEED_CHALLENGES = [
  { title: 'Percentage Puzzle', description: 'Solve 5 percentage-based aptitude questions in 10 minutes.', category: 'aptitude', difficulty: 'easy', points: 20, time_limit_seconds: 600, is_daily: true },
  { title: 'Number Series Sprint', description: 'Find the missing number in 5 logical series questions.', category: 'reasoning', difficulty: 'easy', points: 20, time_limit_seconds: 480, is_daily: true },
  { title: 'Pseudocode Trace', description: 'Trace through 3 pseudocode snippets and predict the output.', category: 'pseudocode', difficulty: 'medium', points: 30, time_limit_seconds: 600, is_daily: false },
  { title: 'Vocabulary Builder', description: 'Match 10 words with their correct synonyms.', category: 'vocabulary', difficulty: 'easy', points: 15, time_limit_seconds: 300, is_daily: true },
  { title: 'Array Mastery', description: 'Answer 5 questions on arrays, searching, and sorting.', category: 'programming', difficulty: 'medium', points: 40, time_limit_seconds: 900, is_daily: false },
  { title: 'HR Interview Blitz', description: 'Answer 3 common HR interview questions with structured responses.', category: 'interview_question', difficulty: 'easy', points: 25, time_limit_seconds: 600, is_daily: true },
  { title: 'Mixed Placement Drill', description: 'A 10-question mixed challenge covering aptitude, reasoning, and verbal.', category: 'mixed', difficulty: 'medium', points: 50, time_limit_seconds: 900, is_daily: false },
  { title: 'Logical Deduction', description: 'Solve 5 syllogism and blood relation problems.', category: 'reasoning', difficulty: 'medium', points: 35, time_limit_seconds: 600, is_daily: false },
  { title: 'DSA Hard Mode', description: 'Tackle 3 hard-level data structures and algorithms questions.', category: 'programming', difficulty: 'hard', points: 80, time_limit_seconds: 1800, is_daily: false },
  { title: 'Grammar Check', description: 'Identify errors in 8 sentences covering tenses and subject-verb agreement.', category: 'vocabulary', difficulty: 'easy', points: 20, time_limit_seconds: 480, is_daily: true },
];

export function createChallengeRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const auth = requireAuthentication(pool, accessSecret);
  const candidate = requireRoles('candidate');

  async function ensureChallenges() {
    for (const ch of SEED_CHALLENGES) {
      const exists = await pool.query('SELECT 1 FROM challenges WHERE title = $1 LIMIT 1', [ch.title]);
      if (!exists.rowCount) {
        await pool.query(
          `INSERT INTO challenges (title, description, category, difficulty, points, time_limit_seconds, is_daily)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ch.title, ch.description, ch.category, ch.difficulty, ch.points, ch.time_limit_seconds, ch.is_daily],
        );
      }
    }
  }

  router.get('/', auth, candidate, asyncHandler(async (req: any, res: any) => {
    await ensureChallenges();
    const userId = req.authenticatedUser!.id;
    const result = await pool.query(
      `SELECT c.id, c.title, c.description, c.category, c.difficulty, c.points,
         c.time_limit_seconds, c.is_daily, c.available_date, c.expires_date,
         ca.id AS attempt_id, ca.score, ca.points_earned, ca.time_taken_seconds, ca.completed_at
       FROM challenges c
       LEFT JOIN challenge_attempts ca ON ca.challenge_id = c.id AND ca.user_id = $1
       ORDER BY c.is_daily DESC, c.difficulty, c.created_at`,
      [userId],
    );
    res.json({ challenges: result.rows });
  }));

  router.post('/:challengeId/attempt', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const schema = z.object({
      answers: z.record(z.unknown()).default({}),
      timeTakenSeconds: z.number().int().min(0).optional(),
      score: z.number().int().min(0).max(100).default(0),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid attempt data.');

    const userId = req.authenticatedUser!.id;
    const { challengeId } = req.params;

    const challenge = await pool.query('SELECT * FROM challenges WHERE id = $1', [challengeId]);
    if (!challenge.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Challenge not found.');

    const existing = await pool.query(
      'SELECT id FROM challenge_attempts WHERE challenge_id = $1 AND user_id = $2',
      [challengeId, userId],
    );
    if (existing.rowCount) return sendError(res, 409, 'ALREADY_ATTEMPTED', 'You have already completed this challenge.');

    const ch = challenge.rows[0];
    const scorePercent = parsed.data.score;
    const pointsEarned = scorePercent >= 80 ? ch.points : scorePercent >= 50 ? Math.floor(ch.points * 0.5) : Math.floor(ch.points * 0.2);

    await pool.query(
      `INSERT INTO challenge_attempts (challenge_id, user_id, score, points_earned, time_taken_seconds, answers)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [challengeId, userId, scorePercent, pointsEarned, parsed.data.timeTakenSeconds ?? null, JSON.stringify(parsed.data.answers)],
    );

    await pool.query(
      `INSERT INTO user_points (user_id, total_points, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET total_points = user_points.total_points + $2, updated_at = now()`,
      [userId, pointsEarned],
    );

    await upsertStreak(pool, userId, 'challenge', challengeId);

    const attemptCount = await pool.query('SELECT count(*) AS cnt FROM challenge_attempts WHERE user_id = $1', [userId]);
    const cnt = Number(attemptCount.rows[0].cnt);
    const achievementSlugs: string[] = [];
    if (cnt === 1) achievementSlugs.push('first_challenge');
    if (cnt === 5) achievementSlugs.push('five_challenges');
    if (cnt === 10) achievementSlugs.push('ten_challenges');
    if (ch.category === 'programming' && scorePercent >= 90) achievementSlugs.push('coding_champion');

    for (const slug of achievementSlugs) {
      const ach = await pool.query('SELECT id FROM achievements WHERE slug = $1', [slug]);
      if (ach.rowCount) {
        await pool.query(
          'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, ach.rows[0].id],
        );
      }
    }

    res.json({ success: true, pointsEarned, score: scorePercent, newAchievements: achievementSlugs });
  }));

  router.get('/leaderboard', auth, asyncHandler(async (_req: any, res: any) => {
    const result = await pool.query(
      `SELECT u.name, up.total_points,
         (SELECT count(*) FROM challenge_attempts ca WHERE ca.user_id = u.id) AS challenges_completed
       FROM user_points up JOIN users u ON u.id = up.user_id
       WHERE u.deleted_at IS NULL
       ORDER BY up.total_points DESC LIMIT 20`,
    );
    res.json({ leaderboard: result.rows });
  }));

  router.get('/my-stats', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    const [points, attempts, achievements] = await Promise.all([
      pool.query('SELECT total_points FROM user_points WHERE user_id = $1', [userId]),
      pool.query(
        `SELECT ca.*, c.title, c.category, c.difficulty
         FROM challenge_attempts ca JOIN challenges c ON c.id = ca.challenge_id
         WHERE ca.user_id = $1 ORDER BY ca.completed_at DESC LIMIT 20`,
        [userId],
      ),
      pool.query(
        `SELECT a.slug, a.title, a.description, a.icon, ua.earned_at
         FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
         WHERE ua.user_id = $1 ORDER BY ua.earned_at DESC`,
        [userId],
      ),
    ]);
    res.json({
      totalPoints: Number(points.rows[0]?.total_points ?? 0),
      recentAttempts: attempts.rows,
      achievements: achievements.rows,
    });
  }));

  return router;
}

export function createNotificationRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const auth = requireAuthentication(pool, accessSecret);
  const candidate = requireRoles('candidate');

  router.get('/', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    const result = await pool.query(
      `SELECT id, notification_type, title, body, payload, read_at, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    const unreadCount = result.rows.filter((n: any) => !n.read_at).length;
    res.json({ notifications: result.rows, unreadCount });
  }));

  router.post('/generate', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    const [streak, challenges] = await Promise.all([
      pool.query('SELECT current_streak, last_practice_date FROM practice_streaks WHERE user_id = $1', [userId]),
      pool.query(
        `SELECT count(*) AS cnt FROM challenges c
         WHERE NOT EXISTS (SELECT 1 FROM challenge_attempts ca WHERE ca.challenge_id = c.id AND ca.user_id = $1)
         AND c.is_daily = true`,
        [userId],
      ),
    ]);

    const notifications: Array<{ type: string; title: string; body: string }> = [];
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = streak.rows[0]?.last_practice_date
      ? new Date(streak.rows[0].last_practice_date).toISOString().slice(0, 10)
      : null;

    if (lastDate !== today) {
      notifications.push({
        type: 'daily_reminder',
        title: "Time for your daily practice!",
        body: "It's time for your daily placement practice! Keep your streak alive.",
      });
    }

    if (Number(challenges.rows[0]?.cnt) > 0) {
      notifications.push({
        type: 'challenge_available',
        title: 'Daily challenges waiting',
        body: `You have ${challenges.rows[0].cnt} daily challenge${Number(challenges.rows[0].cnt) > 1 ? 's' : ''} available today.`,
      });
    }

    const currentStreak = Number(streak.rows[0]?.current_streak ?? 0);
    for (const milestone of [3, 7, 14, 30, 100]) {
      if (currentStreak === milestone) {
        notifications.push({
          type: 'streak_milestone',
          title: `🔥 ${milestone}-Day Streak!`,
          body: `Congratulations! You have completed ${milestone} consecutive practice days.`,
        });
      }
    }

    for (const n of notifications) {
      const exists = await pool.query(
        `SELECT 1 FROM notifications WHERE user_id = $1 AND notification_type = $2
         AND created_at > now() - INTERVAL '24 hours' LIMIT 1`,
        [userId, n.type],
      );
      if (!exists.rowCount) {
        await pool.query(
          `INSERT INTO notifications (user_id, notification_type, title, body) VALUES ($1, $2, $3, $4)`,
          [userId, n.type, n.title, n.body],
        );
      }
    }

    res.json({ generated: notifications.length });
  }));

  router.patch('/:notificationId/read', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    await pool.query(
      'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
      [req.params.notificationId, userId],
    );
    res.json({ updated: true });
  }));

  router.post('/read-all', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    const result = await pool.query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    res.json({ updated: result.rowCount });
  }));

  router.delete('/:notificationId', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    await pool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.notificationId, userId]);
    res.json({ deleted: true });
  }));

  return router;
}

export function createSavedJobsRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const auth = requireAuthentication(pool, accessSecret);
  const candidate = requireRoles('candidate');

  router.get('/', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    const result = await pool.query(
      `SELECT j.id, j.title, j.description, j.required_skills, j.location,
         j.package_min, j.package_max, j.deadline, j.status, j.experience_level,
         cp.name AS company_name, sj.saved_at
       FROM saved_jobs sj
       JOIN jobs j ON j.id = sj.job_id
       JOIN company_profiles cp ON cp.id = j.company_id
       WHERE sj.user_id = $1 AND j.status = 'open'
       ORDER BY sj.saved_at DESC`,
      [userId],
    );
    res.json({ savedJobs: result.rows });
  }));

  router.post('/:jobId', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    const { jobId } = req.params;
    const job = await pool.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (!job.rowCount) return sendError(res, 404, 'NOT_FOUND', 'Job not found.');
    await pool.query(
      'INSERT INTO saved_jobs (user_id, job_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, jobId],
    );
    res.json({ saved: true });
  }));

  router.delete('/:jobId', auth, candidate, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    await pool.query('DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2', [userId, req.params.jobId]);
    res.json({ removed: true });
  }));

  return router;
}

export function createPreferencesRouter(pool: Pool, accessSecret: string) {
  const router = Router();
  const auth = requireAuthentication(pool, accessSecret);

  const prefsSchema = z.object({
    fontSize: z.enum(['small', 'medium', 'large']).optional(),
    notificationDailyReminder: z.boolean().optional(),
    notificationStreakAlerts: z.boolean().optional(),
    notificationChallengeAlerts: z.boolean().optional(),
    notificationTestResults: z.boolean().optional(),
    reminderTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    timezone: z.string().max(60).optional(),
  });

  router.get('/', auth, asyncHandler(async (req: any, res: any) => {
    const userId = req.authenticatedUser!.id;
    const result = await pool.query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
    if (!result.rowCount) {
      return res.json({ fontSize: 'medium', notificationDailyReminder: true, notificationStreakAlerts: true, notificationChallengeAlerts: true, notificationTestResults: true, reminderTime: null, timezone: 'Asia/Kolkata' });
    }
    const row = result.rows[0];
    res.json({
      fontSize: row.font_size,
      notificationDailyReminder: row.notification_daily_reminder,
      notificationStreakAlerts: row.notification_streak_alerts,
      notificationChallengeAlerts: row.notification_challenge_alerts,
      notificationTestResults: row.notification_test_results,
      reminderTime: row.reminder_time,
      timezone: row.timezone,
    });
  }));

  router.put('/', auth, asyncHandler(async (req: any, res: any) => {
    const parsed = prefsSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid preferences.');
    const userId = req.authenticatedUser!.id;
    const d = parsed.data;
    await pool.query(
      `INSERT INTO user_preferences (user_id, font_size, notification_daily_reminder, notification_streak_alerts,
         notification_challenge_alerts, notification_test_results, reminder_time, timezone, updated_at)
       VALUES ($1, COALESCE($2,'medium'), COALESCE($3,true), COALESCE($4,true), COALESCE($5,true), COALESCE($6,true), $7, COALESCE($8,'Asia/Kolkata'), now())
       ON CONFLICT (user_id) DO UPDATE SET
         font_size = COALESCE($2, user_preferences.font_size),
         notification_daily_reminder = COALESCE($3, user_preferences.notification_daily_reminder),
         notification_streak_alerts = COALESCE($4, user_preferences.notification_streak_alerts),
         notification_challenge_alerts = COALESCE($5, user_preferences.notification_challenge_alerts),
         notification_test_results = COALESCE($6, user_preferences.notification_test_results),
         reminder_time = COALESCE($7, user_preferences.reminder_time),
         timezone = COALESCE($8, user_preferences.timezone),
         updated_at = now()`,
      [userId, d.fontSize ?? null, d.notificationDailyReminder ?? null, d.notificationStreakAlerts ?? null,
       d.notificationChallengeAlerts ?? null, d.notificationTestResults ?? null,
       d.reminderTime ?? null, d.timezone ?? null],
    );
    res.json({ updated: true });
  }));

  return router;
}
