import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalTestDatabase, postgresConnectionOptions, testPostgresConnectionOptions } from '../src/postgres-connection.mjs';

test('PostgreSQL connection enables TLS for sslmode=require', () => {
  const options = postgresConnectionOptions('postgresql://user:pass@example.test/app?sslmode=require');
  assert.deepEqual(options.ssl, { rejectUnauthorized: false });
});

test('PostgreSQL connection leaves TLS unset when sslmode is absent', () => {
  const options = postgresConnectionOptions('postgresql://user:pass@localhost/app');
  assert.equal('ssl' in options, false);
});

test('missing database URLs fail with actionable configuration guidance', () => {
  assert.throws(
    () => postgresConnectionOptions(undefined, 'DATABASE_URL_TEST'),
    /DATABASE_URL_TEST is required.*backend\/\.env/,
  );
});

test('invalid database URLs fail clearly', () => {
  assert.throws(
    () => postgresConnectionOptions('not-a-url'),
    /DATABASE_URL must be a valid PostgreSQL connection URL/,
  );
});

test('test database connection rejects an identical primary URL', () => {
  const url = 'postgresql://user:pass@example.test/app?sslmode=require';
  assert.throws(
    () => testPostgresConnectionOptions(url, url),
    /DATABASE_URL_TEST must point to a separate database/,
  );
});

test('test database connection rejects equivalent URLs with different formatting', () => {
  const primaryUrl = 'postgres://user:primary-password@DB.EXAMPLE.TEST/app?sslmode=require';
  const testUrl = 'postgresql://other:other-password@db.example.test:5432/app?sslmode=verify-full';
  assert.throws(
    () => testPostgresConnectionOptions(primaryUrl, testUrl),
    /DATABASE_URL_TEST must point to a separate database/,
  );
});

test('test database connection requires DATABASE_URL_TEST', () => {
  assert.throws(
    () => testPostgresConnectionOptions('postgresql://user:pass@example.test/app', undefined),
    /DATABASE_URL_TEST is required/,
  );
});

test('test database refuses remote hosts unless explicitly allowed', () => {
  assert.throws(
    () => assertLocalTestDatabase('postgresql://user:pass@db.example.test:5432/placeprep_test'),
    /must use localhost or 127\.0\.0\.1/,
  );
  assert.equal(
    assertLocalTestDatabase('postgresql://user:pass@db.example.test:5432/placeprep_test', true).host,
    'db.example.test',
  );
  assert.equal(
    assertLocalTestDatabase('postgresql://user:pass@127.0.0.1:5433/placeprep_test').host,
    '127.0.0.1',
  );
});