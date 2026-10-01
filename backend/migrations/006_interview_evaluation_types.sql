ALTER TABLE interview_evaluations DROP CONSTRAINT interview_evaluations_evaluation_type_check;
ALTER TABLE interview_evaluations ADD CONSTRAINT interview_evaluations_evaluation_type_check
  CHECK (evaluation_type IN ('ai', 'human', 'rule_based'));

CREATE UNIQUE INDEX interview_answer_one_per_question_idx ON interview_answers(question_id);
CREATE UNIQUE INDEX interview_evaluation_type_per_session_idx ON interview_evaluations(session_id, evaluation_type);