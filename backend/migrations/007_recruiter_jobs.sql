CREATE TABLE IF NOT EXISTS company_members (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'admin'
    CHECK (member_role IN ('admin', 'hiring_manager', 'interviewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS company_members_company_idx ON company_members(company_id, user_id);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES role_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_company_status_idx ON jobs(company_id, status, created_at DESC);