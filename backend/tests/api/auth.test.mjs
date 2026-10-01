import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import supertest from 'supertest';
import { app, pool } from './context.mjs';

test('registration, email verification, login, refresh rotation, password reset, and logout', async (t) => {
  const email = `auth-test-${randomUUID()}@example.test`;
  const agent = supertest.agent(app);
  t.after(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  });

  const invalidPassword = await supertest(app).post('/api/v1/auth/login').send({ email, password: 'unknown-password' });
  assert.equal(invalidPassword.status, 401);

  const weakRegistration = await supertest(app).post('/api/v1/auth/register').send({
    name: 'Test Candidate', email, password: 'weak', role: 'candidate',
  });
  assert.equal(weakRegistration.status, 400);

  const registration = await agent.post('/api/v1/auth/register').send({
    name: 'Test Candidate', email, password: 'CampusReady-2026!', role: 'candidate',
  });
  assert.equal(registration.status, 201);
  assert.ok(registration.body.developmentVerificationToken);

  const duplicate = await supertest(app).post('/api/v1/auth/register').send({
    name: 'Test Candidate', email, password: 'CampusReady-2026!', role: 'candidate',
  });
  assert.equal(duplicate.status, 409);

  const unverifiedLogin = await agent.post('/api/v1/auth/login').send({ email, password: 'CampusReady-2026!' });
  assert.equal(unverifiedLogin.status, 403);
  const verification = await agent.post('/api/v1/auth/verify-email').send({ token: registration.body.developmentVerificationToken });
  assert.equal(verification.status, 200);

  const login = await agent.post('/api/v1/auth/login').send({ email, password: 'CampusReady-2026!', rememberMe: true });
  assert.equal(login.status, 200);
  assert.ok(login.body.accessToken);
  assert.ok(login.headers['set-cookie']?.some((cookie) => cookie.startsWith('placeprep_refresh=')));

  const profile = await supertest(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body.roles, ['candidate']);

  const refreshed = await agent.post('/api/v1/auth/refresh');
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.accessToken);

  const forgot = await agent.post('/api/v1/auth/forgot').send({ email });
  assert.equal(forgot.status, 200);
  assert.ok(forgot.body.developmentResetToken);
  const reset = await agent.post('/api/v1/auth/reset').send({
    token: forgot.body.developmentResetToken,
    password: 'NewCampus-2026!',
  });
  assert.equal(reset.status, 200);

  const relogin = await supertest(app).post('/api/v1/auth/login').send({ email, password: 'NewCampus-2026!' });
  assert.equal(relogin.status, 200);
  const logout = await agent.post('/api/v1/auth/logout');
  assert.equal(logout.status, 204);
  const expiredRefresh = await agent.post('/api/v1/auth/refresh');
  assert.equal(expiredRefresh.status, 401);
});

test.after(async () => pool.end());