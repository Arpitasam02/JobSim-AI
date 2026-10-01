import assert from 'node:assert/strict';
import test from 'node:test';
import { requireRoles } from '../dist/auth/middleware.js';

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('RBAC returns 401 when authentication is missing', () => {
  const response = responseDouble();
  let continued = false;

  requireRoles('candidate')({ requestId: 'test-request' }, response, () => { continued = true; });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'UNAUTHENTICATED');
  assert.equal(continued, false);
});

test('RBAC returns 403 when authenticated user has the wrong role', () => {
  const response = responseDouble();
  let continued = false;

  requireRoles('candidate')({
    requestId: 'test-request',
    authenticatedUser: { id: 'user-1', email: 'recruiter@example.test', name: 'Recruiter', roles: ['recruiter'] },
  }, response, () => { continued = true; });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'FORBIDDEN');
  assert.equal(continued, false);
});

test('RBAC continues for an allowed role', () => {
  const response = responseDouble();
  let continued = false;

  requireRoles('candidate', 'recruiter')({
    requestId: 'test-request',
    authenticatedUser: { id: 'user-1', email: 'candidate@example.test', name: 'Candidate', roles: ['candidate'] },
  }, response, () => { continued = true; });

  assert.equal(response.statusCode, 200);
  assert.equal(continued, true);
});