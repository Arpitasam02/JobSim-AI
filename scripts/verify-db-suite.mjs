import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testPostgresConnectionOptions } from '../backend/src/postgres-connection.mjs';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
dotenv.config({ path: path.join(rootDirectory, 'backend', '.env') });

try {
  testPostgresConnectionOptions(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database test configuration is invalid.');
  process.exit(1);
}

console.info('Separate DATABASE_URL_TEST verified; connection values are hidden.');
const env = { ...process.env, NODE_ENV: 'development', E2E_API_PORT: '4001' };
const commands = [
  {
    label: 'Build backend for Supertest',
    cwd: rootDirectory,
    args: ['node_modules/typescript/bin/tsc', '-p', 'backend/tsconfig.json'],
  },
  {
    label: 'Supertest auth, RBAC, and interview suites',
    cwd: path.join(rootDirectory, 'backend'),
    args: ['--test', 'tests/api/auth.test.mjs', 'tests/api/rbac-matrix.test.mjs', 'tests/api/interviews.test.mjs'],
  },
  {
    label: 'Playwright candidate happy path',
    cwd: rootDirectory,
    args: ['node_modules/@playwright/test/cli.js', 'test', '--config', 'frontend/e2e/playwright.config.ts'],
  },
];

const summary = { passed: 0, failed: 0, skipped: 0 };

for (const command of commands) {
  console.info(`\n[verify:db] ${command.label}`);
  const result = spawnSync(process.execPath, command.args, { cwd: command.cwd, env, stdio: 'inherit' });
  if (result.error) {
    console.error(`[verify:db] Could not start ${command.label}: ${result.error.message}`);
    summary.failed += 1;
    process.exitCode = 1;
    break;
  }
  if (result.status === 0) {
    summary.passed += 1;
    continue;
  }

  if (result.status === 130 || result.status === 1) {
    summary.failed += 1;
  } else {
    summary.skipped += 1;
  }

  process.exitCode = result.status ?? 1;
  break;
}

console.info('\n[verify:db] Final summary');
console.info(`Passed: ${summary.passed} | Failed: ${summary.failed} | Skipped: ${summary.skipped}`);
