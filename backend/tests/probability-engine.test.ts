import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateProbability,
  createProbabilityConfig,
  defaultProbabilityWeights,
  simulateProbability,
} from '../src/probability/engine.js';

test('calculateProbability uses the configured weights and returns the expected score', () => {
  const config = createProbabilityConfig(defaultProbabilityWeights);
  const result = calculateProbability({
    resume: 82,
    roleFit: 74,
    assessments: 76,
    interviews: 68,
    profile: 81,
  }, config);

  assert.equal(result.probability, 88.9);
  assert.equal(result.confidence, 'High');
  assert.equal(result.dataPoints, 5);
  assert.equal(result.factors.length, 3);
  assert.equal(result.factors[0].label, 'Interview score');
});

test('calculateProbability handles missing components and lowers the confidence level', () => {
  const config = createProbabilityConfig(defaultProbabilityWeights);
  const result = calculateProbability({
    resume: 90,
    roleFit: 80,
    assessments: null,
    interviews: null,
    profile: 70,
  }, config);

  assert.equal(result.probability, 93.2);
  assert.equal(result.confidence, 'Medium');
  assert.equal(result.dataPoints, 3);
});

test('simulateProbability returns a positive delta when the scenario improves a score', () => {
  const config = createProbabilityConfig(defaultProbabilityWeights);
  const result = simulateProbability(
    {
      resume: 62,
      roleFit: 64,
      assessments: 58,
      interviews: 50,
      profile: 60,
    },
    {
      assessments: 75,
      profile: 80,
    },
    config,
  );

  assert.ok(result.delta > 0);
  assert.ok(result.after.probability > result.before.probability);
  assert.equal(result.after.confidence, 'High');
});

test('createProbabilityConfig rejects weights that do not sum to 100', () => {
  assert.throws(
    () => 
      createProbabilityConfig({
        resume: 20,
        roleFit: 20,
        assessments: 20,
        interviews: 20,
        profile: 5,
      }),
    /must sum to 100/,
  );
});
