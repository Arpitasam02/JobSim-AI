import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { app, createRoleUser, deleteUsers, pool, request, withAuth } from './context.mjs';

test('jobs enforce role and company ownership, candidate applications, and blind screening', async (t) => {
  const users = [];
  const companies = [];
  async function user(role) {
    const created = await createRoleUser(role);
    users.push(created);
    return created;
  }
  async function company(name, recruiter) {
    const result = await pool.query('INSERT INTO company_profiles (name) VALUES ($1) RETURNING id', [name]);
    const id = result.rows[0].id;
    companies.push(id);
    await pool.query(
      "INSERT INTO company_members (user_id, company_id, member_role) VALUES ($1, $2, 'admin')",
      [recruiter.id, id],
    );
    return id;
  }
  async function job(companyId, recruiter, { title, blindScreening = false, status = 'open' }) {
    const result = await pool.query(
      `INSERT INTO jobs (company_id, created_by, title, description, status, blind_screening)
       VALUES ($1, $2, $3, 'API test job description', $4, $5) RETURNING id`,
      [companyId, recruiter.id, title, status, blindScreening],
    );
    return result.rows[0].id;
  }
  async function resume(candidate, title) {
    const created = await pool.query(
      'INSERT INTO resumes (candidate_id, title, is_primary) VALUES ($1, $2, true) RETURNING id',
      [candidate.id, title],
    );
    await pool.query(
      `INSERT INTO resume_versions (resume_id, version_number, storage_key, original_filename, mime_type,
        file_size_bytes, sha256, parse_status)
       VALUES ($1, 1, $2, $3, 'application/pdf', 1, $4, 'complete')`,
      [created.rows[0].id, `${randomUUID()}.pdf`, `${title}.pdf`, randomUUID().replaceAll('-', '').padEnd(64, '0')],
    );
    return created.rows[0].id;
  }

  t.after(async () => {
    if (companies.length) await pool.query('DELETE FROM company_profiles WHERE id = ANY($1::uuid[])', [companies]);
    await deleteUsers(users);
  });

  const recruiter = await user('recruiter');
  const otherRecruiter = await user('recruiter');
  const officer = await user('placement_officer');
  const candidate = await user('candidate');
  const otherCandidate = await user('candidate');
  const companyId = await company(`Jobs API ${randomUUID()}`, recruiter);
  const otherCompanyId = await company(`Jobs API ${randomUUID()}`, otherRecruiter);
  const jobId = await job(companyId, recruiter, { title: `Open role ${randomUUID()}`, blindScreening: true });
  const otherJobId = await job(otherCompanyId, otherRecruiter, { title: `Private role ${randomUUID()}` });

  assert.equal((await request(app).get('/api/v1/jobs')).status, 401);
  assert.equal((await request(app).get('/api/v1/recruiter/jobs')).status, 401);
  assert.equal((await withAuth(request(app).get('/api/v1/jobs'), officer.token)).status, 403);
  assert.equal((await withAuth(request(app).get('/api/v1/recruiter/jobs'), candidate.token)).status, 403);
  assert.equal((await withAuth(request(app).post('/api/v1/recruiter/jobs'), officer.token).send({})).status, 403);

  const recruiterJobs = await withAuth(request(app).get('/api/v1/recruiter/jobs'), recruiter.token);
  assert.equal(recruiterJobs.status, 200);
  assert.ok(recruiterJobs.body.jobs.some((item) => item.id === jobId));
  assert.equal(recruiterJobs.body.jobs.some((item) => item.id === otherJobId), false);
  const created = await withAuth(request(app).post('/api/v1/recruiter/jobs'), recruiter.token).send({
    companyId,
    title: `Created role ${randomUUID()}`,
    description: 'A valid role created through the recruiter API.',
    requiredSkills: ['SQL'],
    minimumCgpa: 6.5,
    packageMin: 100000,
    packageMax: 200000,
    status: 'open',
  });
  assert.equal(created.status, 201);
  for (const field of ['minimum_cgpa', 'package_min', 'package_max']) {
    assert.equal(typeof created.body.job[field], 'number');
  }
  assert.equal((await withAuth(request(app).get(`/api/v1/recruiter/jobs/${created.body.job.id}`), recruiter.token)).status, 200);
  const ownEdit = await withAuth(request(app).patch(`/api/v1/recruiter/jobs/${created.body.job.id}`), recruiter.token)
    .send({ title: 'Updated role title' });
  assert.equal(ownEdit.status, 200);
  assert.equal(ownEdit.body.job.title, 'Updated role title');
  assert.equal((await withAuth(request(app).get(`/api/v1/recruiter/jobs/${otherJobId}`), recruiter.token)).status, 404);
  assert.equal((await withAuth(request(app).patch(`/api/v1/recruiter/jobs/${otherJobId}`), recruiter.token).send({ title: 'Stolen edit' })).status, 404);
  assert.equal((await withAuth(request(app).get(`/api/v1/recruiter/jobs/${otherJobId}/applicants`), recruiter.token)).status, 404);

  const otherResumeId = await resume(otherCandidate, `Other candidate ${randomUUID()}`);
  const ownResumeId = await resume(candidate, `Candidate ${randomUUID()}`);
  const rejectedResume = await withAuth(request(app).post(`/api/v1/jobs/${jobId}/apply`), candidate.token).send({ resumeId: otherResumeId });
  assert.equal(rejectedResume.status, 404);

  const publicJobs = await withAuth(request(app).get('/api/v1/jobs?page=1&pageSize=20'), candidate.token);
  assert.equal(publicJobs.status, 200);
  const publicJob = publicJobs.body.jobs.find((item) => item.id === jobId);
  assert.ok(publicJob);
  assert.equal(publicJob.fit_score, null);
  for (const field of ['minimum_cgpa', 'package_min', 'package_max', 'fit_score']) {
    assert.ok(publicJob[field] === null || typeof publicJob[field] === 'number');
  }

  const applied = await withAuth(request(app).post(`/api/v1/jobs/${jobId}/apply`), candidate.token).send({ resumeId: ownResumeId });
  assert.equal(applied.status, 201);
  const duplicate = await withAuth(request(app).post(`/api/v1/jobs/${jobId}/apply`), candidate.token).send({ resumeId: ownResumeId });
  assert.equal(duplicate.status, 409);

  const closedJobId = await job(companyId, recruiter, { title: `Closed role ${randomUUID()}`, status: 'closed' });
  const closedApply = await withAuth(request(app).post(`/api/v1/jobs/${closedJobId}/apply`), candidate.token).send({ resumeId: ownResumeId });
  assert.equal(closedApply.status, 409);

  const applicants = await withAuth(request(app).get(`/api/v1/recruiter/jobs/${jobId}/applicants`), recruiter.token);
  assert.equal(applicants.status, 200);
  const blindApplicant = applicants.body.applicants.find((item) => item.applicationId === applied.body.application.id);
  assert.ok(blindApplicant);
  for (const field of ['name', 'email', 'institution']) assert.equal(Object.hasOwn(blindApplicant, field), false);
  assert.equal(Object.hasOwn(blindApplicant, 'placementProbability'), false);
  assert.equal(JSON.stringify(applicants.body).toLowerCase().includes('probability'), false);
  assert.equal(typeof applicants.body.pagination.total, 'number');

  const outsiderDecision = await withAuth(request(app).post(`/api/v1/applications/${applied.body.application.id}/decision`), otherRecruiter.token)
    .send({ decision: 'shortlist' });
  assert.equal(outsiderDecision.status, 404);
  const decision = await withAuth(request(app).post(`/api/v1/applications/${applied.body.application.id}/decision`), recruiter.token)
    .send({ decision: 'shortlist' });
  assert.equal(decision.status, 200);
  const shortlisted = await withAuth(request(app).get(`/api/v1/recruiter/jobs/${jobId}/applicants`), recruiter.token);
  const identifiedApplicant = shortlisted.body.applicants.find((item) => item.applicationId === applied.body.application.id);
  assert.equal(typeof identifiedApplicant.name, 'string');
  assert.equal(typeof identifiedApplicant.email, 'string');
});

test.after(async () => pool.end());