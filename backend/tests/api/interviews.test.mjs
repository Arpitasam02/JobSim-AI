import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { app, createRoleUser, deleteUsers, pool, request, withAuth } from './context.mjs';

test('candidate can create, answer, finish, and read a text interview report', async (t) => {
  const candidate = await createRoleUser('candidate');
  const outsider = await createRoleUser('candidate');
  t.after(async () => {
    await deleteUsers([candidate, outsider]);
  });

  const role = await pool.query("SELECT id FROM role_catalog WHERE slug = 'software-engineer' AND active = true");
  assert.equal(role.rowCount, 1, 'seed the role catalog before running API integration tests');

  const unsupportedMode = await withAuth(request(app).post('/api/v1/interviews'), candidate.token).send({
    type: 'technical', mode: 'voice', roleId: role.rows[0].id,
  });
  assert.equal(unsupportedMode.status, 501);

  const created = await withAuth(request(app).post('/api/v1/interviews'), candidate.token).send({
    type: 'technical', mode: 'text', difficulty: 'medium', roleId: role.rows[0].id,
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.questionCount > 0);

  const sessionPath = `/api/v1/interviews/${created.body.sessionId}`;
  let snapshot = await withAuth(request(app).get(sessionPath), candidate.token);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.session.status, 'in_progress');
  assert.ok(snapshot.body.currentQuestion?.question);

  const wrongOrder = await withAuth(request(app).post(`${sessionPath}/answer`), candidate.token).send({
    questionId: randomUUID(), answer: 'I designed and tested a practical solution.'
  });
  assert.equal(wrongOrder.status, 409);
  assert.equal(wrongOrder.body.code, 'OUT_OF_ORDER');

  for (let count = 0; snapshot.body.currentQuestion && count < 6; count += 1) {
    const answer = await withAuth(request(app).post(`${sessionPath}/answer`), candidate.token).send({
      questionId: snapshot.body.currentQuestion.id,
      answer: 'The situation required a reliable solution. I designed, implemented, and tested the change. It improved the workflow, and I verified the result with focused checks.',
    });
    assert.equal(answer.status, 201);
    snapshot = await withAuth(request(app).get(sessionPath), candidate.token);
  }
  assert.equal(snapshot.body.currentQuestion, null);
  assert.equal(snapshot.body.answers.length, created.body.questionCount);

  const finished = await withAuth(request(app).post(`${sessionPath}/finish`), candidate.token);
  assert.equal(finished.status, 200);
  assert.ok(finished.body.overallScore >= 1 && finished.body.overallScore <= 10);

  const report = await withAuth(request(app).get(`${sessionPath}/report`), candidate.token);
  assert.equal(report.status, 200);
  assert.equal(report.body.report.evaluation_type, 'rule_based');
  assert.equal(typeof report.body.report.overall_score, 'number');
  assert.equal(report.body.report.rubric.questions.length, created.body.questionCount);
  assert.ok(report.body.report.rubric.questions[0].question);

  const privateReport = await withAuth(request(app).get(`${sessionPath}/report`), outsider.token);
  assert.equal(privateReport.status, 404);
});

test.after(async () => pool.end());