import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTextInterview } from '../dist/interviews/evaluator.js';

test('interview evaluation uses quoted answer evidence and caps its rubric scores', () => {
  const result = evaluateTextInterview(
    [{ id: 'question-1', question: 'Describe your project.', idealAnswerOutline: 'Context, action, outcome.' }],
    [{ questionId: 'question-1', answerText: 'I built and tested the feature. The result improved response time by 20%.' }],
  );

  assert.ok(result.overallScore >= 1 && result.overallScore <= 10);
  assert.equal(result.questions[0].question, 'Describe your project.');
  assert.match(result.questions[0].evidence, /I built and tested/);
  assert.equal(result.questions[0].modelAnswerOutline, 'Context, action, outcome.');
  assert.equal(result.modelVersion, 'rules-interview-1');
});

test('missing answers receive low scores and do not claim evidence', () => {
  const result = evaluateTextInterview(
    [{ id: 'question-1', question: 'Tell me about your work.', idealAnswerOutline: null }],
    [],
  );

  assert.equal(result.overallScore, 1);
  assert.equal(result.shortlistRecommendation, 'Unlikely');
  assert.equal(result.questions[0].evidence, 'No response recorded.');
  assert.match(result.questions[0].improvement, /Answer this question/);
});