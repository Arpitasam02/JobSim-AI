import assert from 'node:assert/strict';
import test from 'node:test';
import supertest from 'supertest';
import { createApp } from '../src/app.ts';

test('500 errors log sanitized diagnostics and return a generic client response', async () => {
  const error = new Error('connection failed postgres://db-user:db-password@db.example.test/placeprep password=hidden-password Bearer hidden-token');
  Object.assign(error, { code: 'XX123' });
  error.stack = `${error.message}\n    at test (token=hidden-stack-token)`;
  const pool = { query: async () => { throw error; } };
  const app = createApp(pool as never, 'test-access-secret-with-sufficient-length');
  const originalConsoleError = console.error;
  const loggedArguments: unknown[][] = [];
  console.error = (...args: unknown[]) => loggedArguments.push(args);

  try {
    const response = await supertest(app).get('/api/v1/roles').set('x-request-id', 'test-request-500');
    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'An unexpected error occurred.');
    assert.equal(response.body.requestId, 'test-request-500');
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(loggedArguments.length, 1);
  assert.equal(loggedArguments[0][0], 'Unhandled API error');
  const details = loggedArguments[0][1] as Record<string, unknown>;
  assert.equal(details.requestId, 'test-request-500');
  assert.equal(details.status, 500);
  assert.equal(details.errorCode, 'XX123');
  assert.match(String(details.message), /connection failed/);
  assert.match(String(details.stack), /at test/);
  const loggedText = JSON.stringify(details);
  for (const secret of ['db-password', 'hidden-password', 'hidden-token', 'hidden-stack-token']) {
    assert.equal(loggedText.includes(secret), false, `server log must redact ${secret}`);
  }
  assert.match(loggedText, /REDACTED/);
});