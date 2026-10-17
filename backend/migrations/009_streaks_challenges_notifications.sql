-- Practice streaks
CREATE TABLE IF NOT EXISTS practice_streaks (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak integer NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  total_practice_days integer NOT NULL DEFAULT 0 CHECK (total_practice_days >= 0),
  last_practice_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS practice_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('mock_test', 'mock_interview', 'challenge', 'coding_problem', 'resume_analysis')),
  activity_id uuid,
  practice_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS practice_log_user_date_activity ON practice_activity_log(user_id, activity_type, activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS practice_log_user_date ON practice_activity_log(user_id, practice_date DESC);

-- Challenges
CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('aptitude', 'reasoning', 'pseudocode', 'programming', 'vocabulary', 'interview_question', 'mixed')),
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  points integer NOT NULL DEFAULT 10 CHECK (points > 0),
  time_limit_seconds integer CHECK (time_limit_seconds IS NULL OR time_limit_seconds > 0),
  question_ids uuid[] NOT NULL DEFAULT '{}',
  available_date date,
  expires_date date,
  is_daily boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  points_earned integer NOT NULL DEFAULT 0 CHECK (points_earned >= 0),
  time_taken_seconds integer CHECK (time_taken_seconds IS NULL OR time_taken_seconds >= 0),
  answers jsonb NOT NULL DEFAULT '{}',
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS challenge_attempts_user ON challenge_attempts(user_id, completed_at DESC);

-- User points and achievements
CREATE TABLE IF NOT EXISTS user_points (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_points integer NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL DEFAULT 'trophy',
  points_reward integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

-- Saved jobs
CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX IF NOT EXISTS saved_jobs_user ON saved_jobs(user_id, saved_at DESC);

-- User preferences (notification settings, font size, etc.)
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  font_size text NOT NULL DEFAULT 'medium' CHECK (font_size IN ('small', 'medium', 'large')),
  notification_daily_reminder boolean NOT NULL DEFAULT true,
  notification_streak_alerts boolean NOT NULL DEFAULT true,
  notification_challenge_alerts boolean NOT NULL DEFAULT true,
  notification_test_results boolean NOT NULL DEFAULT true,
  reminder_time time,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed achievements
INSERT INTO achievements (slug, title, description, icon, points_reward) VALUES
  ('first_challenge', 'First Challenge', 'Completed your first challenge', 'star', 50),
  ('five_challenges', 'Challenge Streak', 'Completed 5 challenges', 'zap', 100),
  ('ten_challenges', 'Challenge Champion', 'Completed 10 challenges', 'trophy', 200),
  ('streak_3', '3-Day Streak', 'Practiced 3 days in a row', 'flame', 75),
  ('streak_7', 'Week Warrior', 'Practiced 7 days in a row', 'flame', 150),
  ('streak_14', 'Fortnight Focus', 'Practiced 14 days in a row', 'flame', 300),
  ('streak_30', 'Monthly Master', 'Practiced 30 days in a row', 'crown', 600),
  ('streak_100', 'Century Champion', 'Practiced 100 days in a row', 'crown', 2000),
  ('coding_champion', 'Coding Champion', 'Scored 90%+ on a programming challenge', 'code', 200),
  ('weekly_champion', 'Weekly Practice Champion', 'Completed challenges every day this week', 'calendar', 300)
ON CONFLICT (slug) DO NOTHING;
