import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { app, createRoleUser, deleteUsers, pool, request, roleSlugs, withAuth } from './context.mjs';

const id = '00000000-0000-0000-0000-000000000000';
const allRoles = roleSlugs;
const candidate = ['candidate'];
const assessmentReaders = ['candidate', 'recruiter', 'placement_officer', 'super_admin'];
const assessmentCreators = ['recruiter', 'placement_officer', 'super_admin'];
const disposableEmails = [];

const protectedEndpoints = [
  { method: 'get', path: '/api/v1/health', roles: allRoles, allowed: [200] },
  { method: 'get', path: '/api/v1/roles', roles: allRoles, allowed: [200] },
  {
    method: 'post', path: '/api/v1/auth/register', roles: allRoles, allowed: [201],
    bodyForRole(role) {
      const email = `matrix-${role}-${randomUUID()}@example.test`;
      disposableEmails.push(email);
      return { name: `Matrix ${role}`, email, password: 'Matrix-Checks-2026!', role: 'candidate' };
    },
  },
  { method: 'post', path: '/api/v1/auth/verify-email', roles: allRoles, body: { token: `invalid-${'x'.repeat(32)}` }, allowed: [400] },
  { method: 'post', path: '/api/v1/auth/login', roles: allRoles, body: { email: 'missing-matrix-user@example.test', password: 'Missing-2026!' }, allowed: [401] },
  { method: 'post', path: '/api/v1/auth/refresh', roles: allRoles, allowed: [401] },
  { method: 'post', path: '/api/v1/auth/logout', roles: allRoles, allowed: [204] },
  { method: 'post', path: '/api/v1/auth/forgot', roles: allRoles, body: { email: `forgot-${randomUUID()}@example.test` }, allowed: [200] },
  { method: 'post', path: '/api/v1/auth/reset', roles: allRoles, body: { token: `invalid-${'x'.repeat(32)}`, password: 'Matrix-Checks-2026!' }, allowed: [400] },
  { method: 'get', path: '/api/v1/auth/me', roles: allRoles, allowed: [200] },
  { method: 'put', path: '/api/v1/auth/me', roles: allRoles, body: {}, allowed: [200] },
  { method: 'get', path: '/api/v1/auth/me/consents', roles: allRoles, allowed: [200] },
  { method: 'put', path: '/api/v1/auth/me/consents', roles: allRoles, body: {}, allowed: [400] },
  { method: 'get', path: '/api/v1/auth/me/export', roles: allRoles, allowed: [200] },
  { method: 'delete', path: '/api/v1/auth/me', roles: allRoles, allowed: [204], disposable: true },
  { method: 'post', path: '/api/v1/resumes', roles: candidate, emptyFile: true, allowed: [400] },
  { method: 'get', path: '/api/v1/resumes', roles: candidate, allowed: [200] },
  { method: 'get', path: `/api/v1/resumes/${id}`, roles: candidate, allowed: [404] },
  { method: 'post', path: `/api/v1/resumes/${id}/analyze`, roles: candidate, body: {}, allowed: [404] },
  { method: 'get', path: `/api/v1/resumes/${id}/analysis`, roles: candidate, allowed: [404] },
  { method: 'get', path: '/api/v1/me/role-fit', roles: candidate, allowed: [200] },
  { method: 'get', path: '/api/v1/me/skill-gap', roles: candidate, allowed: [400] },
  { method: 'get', path: '/api/v1/me/roadmap', roles: candidate, allowed: [200] },
  { method: 'post', path: '/api/v1/me/roadmap', roles: candidate, body: {}, allowed: [400] },
  { method: 'patch', path: `/api/v1/me/roadmap/tasks/${id}`, roles: candidate, body: {}, allowed: [400] },
  { method: 'get', path: '/api/v1/tests', roles: assessmentReaders, allowed: [200] },
  { method: 'post', path: '/api/v1/tests', roles: assessmentCreators, body: {}, allowed: [400] },
  { method: 'post', path: `/api/v1/tests/${id}/start`, roles: candidate, allowed: [404] },
  { method: 'get', path: `/api/v1/tests/attempts/${id}`, roles: candidate, allowed: [404] },
  { method: 'put', path: `/api/v1/tests/attempts/${id}/answers`, roles: candidate, body: {}, allowed: [400] },
  { method: 'post', path: `/api/v1/tests/attempts/${id}/submit`, roles: candidate, allowed: [404] },
  { method: 'get', path: `/api/v1/tests/attempts/${id}/report`, roles: candidate, allowed: [404] },
  { method: 'post', path: `/api/v1/tests/attempts/${id}/proctor-events`, roles: candidate, body: {}, allowed: [400] },
  { method: 'get', path: '/api/v1/interviews', roles: candidate, allowed: [200] },
  { method: 'post', path: '/api/v1/interviews', roles: candidate, body: {}, allowed: [400] },
  { method: 'get', path: `/api/v1/interviews/${id}`, roles: candidate, allowed: [404] },
  { method: 'post', path: `/api/v1/interviews/${id}/answer`, roles: candidate, body: {}, allowed: [400] },
  { method: 'post', path: `/api/v1/interviews/${id}/finish`, roles: candidate, allowed: [404] },
  { method: 'get', path: `/api/v1/interviews/${id}/report`, roles: candidate, allowed: [404] },
];

test('every protected endpoint enforces the role matrix for all five roles', async (t) => {
  const identities = [];
  try {
    for (const role of roleSlugs) identities.push(await createRoleUser(role));
    const identityByRole = new Map(identities.map((identity) => [identity.role, identity]));

    for (const endpoint of protectedEndpoints) {
      for (const role of roleSlugs) {
        await t.test(`${endpoint.method.toUpperCase()} ${endpoint.path} as ${role}`, async () => {
          const identity = endpoint.disposable ? await createRoleUser(role) : identityByRole.get(role);
          if (endpoint.disposable) identities.push(identity);
          let call = withAuth(request(app)[endpoint.method](endpoint.path), identity.token);
          if (endpoint.emptyFile) {
            call = call.set('Content-Type', 'application/octet-stream').send(Buffer.alloc(0));
          } else if (endpoint.body !== undefined) {
            call = call.send(endpoint.body);
          } else if (endpoint.bodyForRole) {
            call = call.send(endpoint.bodyForRole(role));
          }
          const response = await call;
          if (endpoint.roles.includes(role)) {
            assert.ok(endpoint.allowed.includes(response.status), `Expected ${endpoint.allowed.join(' or ')}, received ${response.status}`);
          } else {
            assert.equal(response.status, 403, `Expected 403, received ${response.status}: ${response.text}`);
            assert.equal(response.body.code, 'FORBIDDEN');
            assert.equal(Object.hasOwn(response.body, 'data'), false, 'forbidden response must not include protected data');
          }
        });
      }
    }
  } finally {
    await deleteUsers(identities);
    if (disposableEmails.length) await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [disposableEmails]);
  }
});

test.after(async () => pool.end());