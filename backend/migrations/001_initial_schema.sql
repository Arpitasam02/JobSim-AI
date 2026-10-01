CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource text NOT NULL,
  action text NOT NULL,
  UNIQUE (resource, action)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  website text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  email_verified_at timestamptz,
  suspended_at timestamptz,
  deleted_at timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  graduation_year integer,
  department text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);

CREATE TABLE candidate_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  degree text,
  branch text,
  graduation_year integer,
  cgpa numeric(4, 2) CHECK (cgpa IS NULL OR (cgpa >= 0 AND cgpa <= 10)),
  phone text,
  location text,
  links jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_roles text[] NOT NULL DEFAULT '{}',
  preferred_job_type text,
  recruiter_visibility boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX resumes_one_primary_per_candidate
  ON resumes(candidate_id) WHERE is_primary = true;

CREATE TABLE resume_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id uuid NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  storage_key text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL,
  parsed_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  parse_status text NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'processing', 'complete', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resume_id, version_number),
  UNIQUE (resume_id, sha256)
);

CREATE TABLE resume_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_version_id uuid NOT NULL REFERENCES resume_versions(id) ON DELETE CASCADE,
  target_role text,
  target_job_description text,
  overall_score numeric(5, 2) NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  sub_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  verdict text NOT NULL CHECK (verdict IN ('READY TO APPLY', 'ALMOST READY - MINOR FIXES', 'NEEDS IMPROVEMENT', 'NOT READY - MAJOR REWORK')),
  critical_issue boolean NOT NULL DEFAULT false,
  analysis_version text NOT NULL,
  limited_analysis boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resume_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES resume_analyses(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('critical', 'important', 'nice_to_have')),
  category text NOT NULL,
  issue text NOT NULL,
  why_it_matters text NOT NULL,
  location text,
  suggested_fix text NOT NULL,
  before_text text,
  after_text text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE role_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  experience_level text,
  assessment_types text[] NOT NULL DEFAULT '{}',
  interview_topics text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_skill_weights (
  role_id uuid NOT NULL REFERENCES role_catalog(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  weight numeric(5, 2) NOT NULL CHECK (weight >= 0 AND weight <= 100),
  must_have boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role_id, skill_id)
);

CREATE TABLE role_fit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_version_id uuid REFERENCES resume_versions(id) ON DELETE SET NULL,
  role_id uuid NOT NULL REFERENCES role_catalog(id) ON DELETE CASCADE,
  fit_score numeric(5, 2) NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  matched_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_gap_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES role_catalog(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roadmap_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES skill_gap_plans(id) ON DELETE CASCADE,
  skill_id uuid REFERENCES skills(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  week_number integer NOT NULL CHECK (week_number > 0),
  estimated_hours numeric(5, 2),
  resource_url text,
  completed_at timestamptz
);

CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  question_type text NOT NULL CHECK (question_type IN ('aptitude', 'technical_mcq', 'coding', 'domain', 'interview')),
  topic text NOT NULL,
  subtopic text,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer jsonb,
  explanation text,
  expected_seconds integer CHECK (expected_seconds IS NULL OR expected_seconds > 0),
  marks numeric(6, 2) NOT NULL DEFAULT 1,
  negative_marks numeric(6, 2) NOT NULL DEFAULT 0,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'institution', 'company', 'global')),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE question_tags (
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (question_id, tag)
);

CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  passing_score numeric(5, 2),
  attempt_limit integer NOT NULL DEFAULT 1 CHECK (attempt_limit > 0),
  available_from timestamptz,
  available_until timestamptz,
  strict_proctoring boolean NOT NULL DEFAULT false,
  randomized boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assessment_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  passing_score numeric(5, 2),
  question_ids uuid[] NOT NULL DEFAULT '{}',
  UNIQUE (assessment_id, position)
);

CREATE TABLE assessment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, candidate_id)
);

CREATE TABLE assessment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  submitted_at timestamptz,
  total_score numeric(7, 2),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'auto_submitted', 'expired')),
  UNIQUE (assessment_id, candidate_id, started_at)
);

CREATE TABLE attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  answer jsonb,
  is_correct boolean,
  score numeric(7, 2),
  time_spent_seconds integer NOT NULL DEFAULT 0,
  marked_for_review boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE TABLE code_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  language text NOT NULL,
  source_code text NOT NULL,
  runner_reference text,
  status text NOT NULL DEFAULT 'queued',
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE proctor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  role_id uuid REFERENCES role_catalog(id) ON DELETE SET NULL,
  interview_type text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('text', 'voice', 'video', 'human')),
  difficulty text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'in_progress',
  consent_record_id uuid,
  recording_storage_key text,
  recording_delete_after timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE interview_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  question text NOT NULL,
  ideal_answer_outline text,
  position integer NOT NULL,
  UNIQUE (session_id, position)
);

CREATE TABLE interview_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
  answer_text text NOT NULL DEFAULT '',
  transcript text,
  audio_storage_key text,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE interview_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  evaluator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  evaluation_type text NOT NULL CHECK (evaluation_type IN ('ai', 'human')),
  overall_score numeric(4, 2),
  rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  improvements jsonb NOT NULL DEFAULT '[]'::jsonb,
  shortlist_recommendation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL,
  required_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  minimum_cgpa numeric(4, 2),
  eligible_branches text[] NOT NULL DEFAULT '{}',
  graduation_years integer[] NOT NULL DEFAULT '{}',
  location text,
  package_min numeric(12, 2),
  package_max numeric(12, 2),
  deadline timestamptz,
  rounds jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  blind_screening boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_version_id uuid REFERENCES resume_versions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'applied',
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, candidate_id)
);

CREATE TABLE shortlist_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  decided_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('shortlist', 'hold', 'reject')),
  match_score numeric(5, 2),
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE interview_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  interviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'scheduled',
  video_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE scoring_weight_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  weights jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE placement_probability_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES role_catalog(id) ON DELETE CASCADE,
  probability numeric(5, 2) NOT NULL CHECK (probability BETWEEN 0 AND 100),
  confidence text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  components jsonb NOT NULL,
  model_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outcome_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied', 'oa_cleared', 'interview_cleared', 'offer', 'rejected')),
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('ai_analysis', 'audio_recording', 'video_recording', 'recruiter_sharing', 'proctoring')),
  granted boolean NOT NULL,
  policy_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE interview_sessions
  ADD CONSTRAINT interview_sessions_consent_fk
  FOREIGN KEY (consent_record_id) REFERENCES consent_records(id) ON DELETE SET NULL;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  request_id text,
  ip_hash text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX institutions_name_unique_idx ON institutions(name);
CREATE UNIQUE INDEX company_profiles_name_unique_idx ON company_profiles(name);
CREATE INDEX users_active_email_idx ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX resumes_candidate_idx ON resumes(candidate_id, created_at DESC);
CREATE INDEX resume_versions_hash_idx ON resume_versions(sha256);
CREATE INDEX role_fit_candidate_idx ON role_fit_results(candidate_id, created_at DESC);
CREATE INDEX attempts_candidate_idx ON assessment_attempts(candidate_id, started_at DESC);
CREATE INDEX applications_job_idx ON applications(job_id, applied_at DESC);
CREATE INDEX probability_candidate_role_idx ON placement_probability_snapshots(candidate_id, role_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);