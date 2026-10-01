import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreAssessment } from '../dist/assessments/scoring.js';

test('assessment scoring applies negative marks and ignores unanswered questions', () => {
  const result = scoreAssessment([
    { id: 'q1', topic: 'SQL', marks: 2, negativeMarks: 0.5, correctAnswer: { index: 1 } },
    { id: 'q2', topic: 'SQL', marks: 1, negativeMarks: 0.25, correctAnswer: { index: 0 } },
    { id: 'q3', topic: 'OS', marks: 1, negativeMarks: 0, correctAnswer: { index: 2 } },
  ], new Map([
    ['q1', { index: 1 }],
    ['q2', { index: 2 }],
  ]));

  assert.equal(result.earnedMarks, 1.75);
  assert.equal(result.maximumMarks, 4);
  assert.equal(result.percentage, 43.75);
  assert.deepEqual(result.topicBreakdown, [
    { topic: 'SQL', correct: 1, total: 2, accuracy: 50 },
    { topic: 'OS', correct: 0, total: 1, accuracy: 0 },
  ]);
  assert.equal(result.answers[2].isCorrect, null);
});

test('assessment score is clamped to zero when negative marks exceed earned marks', () => {
  const result = scoreAssessment([
    { id: 'q1', topic: 'Aptitude', marks: 1, negativeMarks: 4, correctAnswer: 'right' },
  ], new Map([['q1', 'wrong']]));

  assert.equal(result.percentage, 0);
  assert.equal(result.earnedMarks, -4);
});