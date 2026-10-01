import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checkerPath = fileURLToPath(new URL('../scripts/check-env.mjs', import.meta.url));

test('check-env reports configuration presence without revealing variable values', () => {
  const secrets = {
    DATABASE_URL: 'postgresql://primary-secret@example.test/placeprep?sslmode=require',
    DATABASE_URL_TEST: 'postgresql://test-secret@example.test/placeprep_test?sslmode=require',
    JWT_ACCESS_SECRET: 'a-test-signing-secret-that-must-not-appear-in-output',
    NODE_ENV: 'test',
  };
  const result = spawnSync(process.execPath, [checkerPath], {
    encoding: 'utf8',
    env: { ...process.env, ...secrets },
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /backend\/\.env: (found|not found)/);
  assert.match(output, /Missing required variables: none/);
  for (const value of Object.values(secrets)) assert.equal(output.includes(value), false);
});

test('check-env identifies a shared primary and test database without printing either URL', () => {
  const sameUrl = 'postgresql://same-secret@example.test/placeprep?sslmode=require';
  const result = spawnSync(process.execPath, [checkerPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: sameUrl,
      DATABASE_URL_TEST: sameUrl,
      JWT_ACCESS_SECRET: 'a-test-signing-secret-that-must-not-appear-in-output',
      NODE_ENV: 'test',
    },
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /DATABASE_URL_TEST must point to a separate database/);
  assert.equal(output.includes(sameUrl), false);
});