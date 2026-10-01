import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProbabilityInputs, probabilityComponents } from '../src/probability/inputs.js';

test('buildProbabilityInputs scales interview scores and clamps components', () => {
  const input = buildProbabilityInputs({
    resume: 120,
    roleFit: -5,
    assessments: 74,
    interviewOverallScore: 8,
  });

  assert.deepEqual(input, { resume: 100, roleFit: 0, assessments: 74, interviews: 80 });
  assert.equal('profile' in input, false);
});

test('buildProbabilityInputs drops non-finite and missing values', () => {
  const input = buildProbabilityInputs({
    resume: Number.NaN,
    roleFit: Number.POSITIVE_INFINITY,
    assessments: null,
    interviewOverallScore: Number.NaN,
  });

  assert.deepEqual(input, {});
  assert.deepEqual(probabilityComponents(input), {
    resume: null,
    roleFit: null,
    assessments: null,
    interviews: null,
    profile: null,
  });
});

test('buildProbabilityInputs clamps converted interview scores', () => {
  assert.deepEqual(buildProbabilityInputs({ interviewOverallScore: 12 }), { interviews: 100 });
});