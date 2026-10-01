import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const cliPath = path.join(rootDirectory, 'node_modules', '@playwright', 'test', 'cli.js');

const result = spawnSync(process.execPath, [cliPath, 'test', '--config', 'frontend/e2e/playwright.config.ts'], {
  cwd: rootDirectory,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`Playwright start error: ${result.error.message}`);
  console.log('\n[e2e] Final summary: Passed: 0 | Failed: 1 | Skipped: 0');
  process.exit(1);
}

const passed = result.status === 0 ? 1 : 0;
const failed = result.status === 0 ? 0 : 1;
console.log(`\n[e2e] Final summary: Passed: ${passed} | Failed: ${failed} | Skipped: 0`);
process.exit(result.status === 0 ? 0 : result.status ?? 1);
