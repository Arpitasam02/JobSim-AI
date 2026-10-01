import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const compilerPath = path.resolve(backendDirectory, '..', 'node_modules/typescript/bin/tsc');
const build = spawnSync(process.execPath, [compilerPath, '-p', 'tsconfig.json'], {
  cwd: backendDirectory,
  stdio: 'inherit',
  env: process.env,
});

if (build.error || build.status !== 0) {
  console.error(`[api-failures] Backend build failed${build.error ? `: ${build.error.message}` : '.'}`);
  process.exit(1);
}

const pattern = 'PUT /api/v1/auth/me as candidate|GET /api/v1/tests as (candidate|recruiter|placement_officer|super_admin)|GET /api/v1/auth/me/export as candidate';
const result = spawnSync(process.execPath, [
  '--test',
  `--test-name-pattern=${pattern}`,
  'tests/api/rbac-matrix.test.mjs',
], {
  cwd: backendDirectory,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`[api-failures] Test runner error: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);