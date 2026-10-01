CREATE TABLE skill_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  provider text,
  language text NOT NULL DEFAULT 'en',
  free boolean NOT NULL DEFAULT true,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, url)
);

CREATE INDEX skill_resources_skill_idx ON skill_resources(skill_id) WHERE approved_at IS NOT NULL;