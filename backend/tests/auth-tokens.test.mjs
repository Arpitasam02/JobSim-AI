import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAccessToken,
  passwordMeetsPolicy,
  verifyAccessToken,
} from '../dist/auth/tokens.js';

const secret = 'test-secret-with-sufficient-length-123456';

test('password policy requires length, mixed case, a digit, and a symbol', () => {
  assert.equal(passwordMeetsPolicy('Strong-pass9'), true);
  assert.equal(passwordMeetsPolicy('lowercase9!'), false);
  assert.equal(passwordMeetsPolicy('NoDigits!!'), false);
  assert.equal(passwordMeetsPolicy('Short1!'), false);
});

test('access token round-trips the subject until expiration', () => {
  const now = Date.UTC(2026, 8, 30);
  const token = createAccessToken('candidate-123', secret, now);

  assert.equal(verifyAccessToken(token, secret, now), 'candidate-123');
  assert.equal(verifyAccessToken(token, secret, now + 16 * 60 * 1000), null);
});

test('access token rejects a modified signature and a different secret', () => {
  const token = createAccessToken('candidate-123', secret);
  const [header, payload, signature] = token.split('.');
  const replacement = signature[0] === 'a' ? 'b' : 'a';

  assert.equal(verifyAccessToken(`${header}.${payload}.${replacement}${signature.slice(1)}`, secret), null);
  assert.equal(verifyAccessToken(token, 'another-test-secret-with-sufficient-length'), null);
});