CREATE TABLE attempt_question_order (
  attempt_id uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (attempt_id, question_id),
  UNIQUE (attempt_id, position)
);

CREATE UNIQUE INDEX assessment_attempt_one_active_idx
  ON assessment_attempts(assessment_id, candidate_id) WHERE status = 'in_progress';