import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const compilerPath = path.resolve(rootDirectory, '..', 'node_modules/typescript/bin/tsc');
const build = spawnSync(process.execPath, [compilerPath, '-p', 'tsconfig.json'], {
  cwd: rootDirectory,
  stdio: 'inherit',
  env: process.env,
});

if (build.error || build.status !== 0) {
  console.error(`[api-tests] Backend build failed${build.error ? `: ${build.error.message}` : '.'}`);
  process.exit(1);
}

const testFiles = [
  'tests/api/auth.test.mjs',
  'tests/api/rbac-matrix.test.mjs',
  'tests/api/interviews.test.mjs',
  'tests/api/placement-probability.test.mjs',
];

let passed = 0;
let failed = 0;
let skipped = 0;

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, ['--test', testFile], {
    cwd: rootDirectory,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(`API test runner error for ${testFile}: ${result.error.message}`);
    failed += 1;
    continue;
  }

  if (result.status === 0) {
    passed += 1;
  } else if (result.status === 1) {
    failed += 1;
  } else {
    skipped += 1;
  }
}

console.log(`\n[api-tests] Final summary: Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);
process.exit(failed > 0 ? 1 : 0);
