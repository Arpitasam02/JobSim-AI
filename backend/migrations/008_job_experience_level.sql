ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS experience_level text NOT NULL DEFAULT 'any'
    CHECK (experience_level IN ('any', 'freshers', 'experienced'));

CREATE INDEX IF NOT EXISTS jobs_open_experience_idx
  ON jobs(experience_level, created_at DESC)
  WHERE status = 'open';