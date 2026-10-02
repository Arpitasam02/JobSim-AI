import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSkillMatchScore, isEligibleForJob, redactBlindApplicant } from '../src/jobs/logic.js';

test('job eligibility applies known CGPA, branch, and graduation-year constraints', () => {
  const job = { minimumCgpa: 7, eligibleBranches: ['Computer Science'], graduationYears: [2026] };
  assert.equal(isEligibleForJob(job, { cgpa: 7.5, branch: 'Computer Science', graduationYear: 2026 }), true);
  assert.equal(isEligibleForJob(job, { cgpa: 6.9, branch: 'Computer Science', graduationYear: 2026 }), false);
  assert.equal(isEligibleForJob(job, { cgpa: 7.5, branch: 'Electronics', graduationYear: 2026 }), false);
  assert.equal(isEligibleForJob(job, { cgpa: 7.5, branch: 'Computer Science', graduationYear: 2027 }), false);
  assert.equal(isEligibleForJob(job, { cgpa: null, branch: null, graduationYear: null }), true);
});

test('skill match score is case-insensitive, deduplicated, and finite', () => {
  assert.equal(calculateSkillMatchScore([' sql ', 'Python', 'python'], ['SQL', 'Python', 'React', 'React']), 66.67);
  assert.equal(calculateSkillMatchScore(['SQL'], []), null);
});

test('blind screening removes identity fields until an application is shortlisted', () => {
  const applicant = { applicationId: 'app-1', status: 'applied', name: 'Candidate', email: 'candidate@example.test', institution: 'Example University' };
  const redacted = redactBlindApplicant(applicant, true, false);
  assert.equal(Object.hasOwn(redacted, 'name'), false);
  assert.equal(Object.hasOwn(redacted, 'email'), false);
  assert.equal(Object.hasOwn(redacted, 'institution'), false);
  assert.equal(redacted.applicationId, applicant.applicationId);
  assert.equal(Object.hasOwn(redactBlindApplicant(applicant, true, true), 'name'), true);
});