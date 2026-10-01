import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { app, createRoleUser, deleteUsers, pool, request, withAuth } from './context.mjs';

async function createProbabilityFixture(candidateId, onAssessmentCreated) {
  const roleResult = await pool.query("SELECT id FROM role_catalog WHERE slug = 'software-engineer' AND active = true");
  assert.equal(roleResult.rowCount, 1, 'seed the role catalog before running API integration tests');
  const roleId = roleResult.rows[0].id;
  const resume = await pool.query(
    'INSERT INTO resumes (candidate_id, title, is_primary) VALUES ($1, $2, true) RETURNING id',
    [candidateId, `Probability fixture ${randomUUID()}`],
  );
  const resumeVersion = await pool.query(
    `INSERT INTO resume_versions (
      resume_id, version_number, storage_key, original_filename, mime_type, file_size_bytes, sha256, parse_status
    ) VALUES ($1, 1, $2, 'fixture.pdf', 'application/pdf', 1, $3, 'complete') RETURNING id`,
    [resume.rows[0].id, `test/${randomUUID()}`, randomUUID()],
  );
  await pool.query(
    `INSERT INTO resume_analyses (
      resume_version_id, overall_score, verdict, analysis_version
    ) VALUES ($1, 80, 'READY TO APPLY', 'probability-test')`,
    [resumeVersion.rows[0].id],
  );
  await pool.query(
    `INSERT INTO role_fit_results (candidate_id, resume_version_id, role_id, fit_score, explanation)
     VALUES ($1, $2, $3, 75, 'Probability API fixture')`,
    [candidateId, resumeVersion.rows[0].id, roleId],
  );

  const assessment = await pool.query(
    'INSERT INTO assessments (creator_id, title, duration_seconds) VALUES ($1, $2, 60) RETURNING id',
    [candidateId, `Probability assessment ${randomUUID()}`],
  );
  onAssessmentCreated(assessment.rows[0].id);
  await pool.query(
    `INSERT INTO assessment_attempts (
      assessment_id, candidate_id, deadline_at, submitted_at, total_score, status
    ) VALUES ($1, $2, now() + interval '1 hour', now(), 70, 'submitted')`,
    [assessment.rows[0].id, candidateId],
  );

  const interview = await pool.query(
    `INSERT INTO interview_sessions (candidate_id, role_id, interview_type, mode, status, finished_at)
     VALUES ($1, $2, 'technical', 'text', 'completed', now()) RETURNING id`,
    [candidateId, roleId],
  );
  await pool.query(
    `INSERT INTO interview_evaluations (session_id, evaluation_type, overall_score)
     VALUES ($1, 'rule_based', 8)`,
    [interview.rows[0].id],
  );

  return roleId;
}

test('candidate placement probability is private, numeric, and simulation is read-only', async (t) => {
  const candidate = await createRoleUser('candidate');
  const otherCandidate = await createRoleUser('candidate');
  const recruiter = await createRoleUser('recruiter');
  let fixtureAssessmentId = null;
  t.after(async () => {
    if (fixtureAssessmentId) {
      await pool.query('DELETE FROM assessment_attempts WHERE assessment_id = $1', [fixtureAssessmentId]);
      await pool.query('DELETE FROM assessments WHERE id = $1', [fixtureAssessmentId]);
    }
    await deleteUsers([candidate, otherCandidate, recruiter]);
  });

  const path = '/api/v1/me/placement-probability';
  const unauthenticated = await request(app).get(path);
  assert.equal(unauthenticated.status, 401);
  const forbidden = await withAuth(request(app).get(path), recruiter.token);
  assert.equal(forbidden.status, 403);

  const empty = await withAuth(request(app).get(path), candidate.token);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.components, {
    resume: null,
    roleFit: null,
    assessments: null,
    interviews: null,
    profile: null,
  });
  assert.equal(empty.body.probability, null);
  assert.equal(empty.body.weightedScore, null);
  assert.equal(empty.body.confidence, 'Low');
  assert.equal(empty.body.dataPoints, 0);

  const roleId = await createProbabilityFixture(candidate.id, (assessmentId) => { fixtureAssessmentId = assessmentId; });
  const latestRole = await withAuth(request(app).get(path), candidate.token);
  assert.equal(latestRole.status, 200);
  assert.equal(latestRole.body.role.id, roleId);
  const invalidRole = await withAuth(request(app).get(`${path}?roleId=not-a-uuid`), candidate.token);
  assert.equal(invalidRole.status, 400);
  const missingRole = await withAuth(request(app).get(`${path}?roleId=${randomUUID()}`), candidate.token);
  assert.equal(missingRole.status, 404);

  const populated = await withAuth(request(app).get(`${path}?roleId=${roleId}`), candidate.token);
  assert.equal(populated.status, 200);
  assert.equal(populated.body.role.id, roleId);
  assert.deepEqual(populated.body.components, {
    resume: 80,
    roleFit: 75,
    assessments: 70,
    interviews: 80,
    profile: null,
  });
  assert.equal(populated.body.confidence, 'High');
  assert.equal(populated.body.dataPoints, 4);
  assert.equal(typeof populated.body.probability, 'number');
  assert.equal(typeof populated.body.weightedScore, 'number');
  for (const value of Object.values(populated.body.components)) {
    assert.ok(value === null || typeof value === 'number');
  }

  const privateData = await withAuth(request(app).get(`${path}?roleId=${roleId}`), otherCandidate.token);
  assert.equal(privateData.status, 200);
  assert.equal(privateData.body.dataPoints, 0);
  assert.deepEqual(privateData.body.components, {
    resume: null,
    roleFit: null,
    assessments: null,
    interviews: null,
    profile: null,
  });

  const snapshotCount = await pool.query(
    'SELECT count(*)::integer AS count FROM placement_probability_snapshots WHERE candidate_id = $1',
    [candidate.id],
  );
  const simulatePath = `${path}/simulate?roleId=${roleId}`;
  const outOfRange = await withAuth(request(app).post(simulatePath), candidate.token).send({ assessments: 101 });
  assert.equal(outOfRange.status, 400);
  const unknownKey = await withAuth(request(app).post(simulatePath), candidate.token).send({ unexpected: 50 });
  assert.equal(unknownKey.status, 400);
  const simulation = await withAuth(request(app).post(simulatePath), candidate.token).send({ assessments: 95, profile: 85 });
  assert.equal(simulation.status, 200);
  assert.equal(typeof simulation.body.delta, 'number');
  assert.equal(typeof simulation.body.before.probability, 'number');
  assert.equal(typeof simulation.body.after.probability, 'number');
  assert.equal(typeof simulation.body.before.weightedScore, 'number');
  assert.equal(typeof simulation.body.after.weightedScore, 'number');
  const snapshotCountAfter = await pool.query(
    'SELECT count(*)::integer AS count FROM placement_probability_snapshots WHERE candidate_id = $1',
    [candidate.id],
  );
  assert.equal(snapshotCountAfter.rows[0].count, snapshotCount.rows[0].count);
});

test.after(async () => pool.end());