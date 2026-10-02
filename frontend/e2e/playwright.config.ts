import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresDatabaseTarget } from '../../backend/src/postgres-connection.mjs';

const rootDirectory = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
dotenv.config({ path: path.join(rootDirectory, 'backend', '.env') });
dotenv.config({ path: path.join(rootDirectory, 'backend', '.env.test'), override: true });
if (process.env.DATABASE_URL_TEST) {
  console.info('[e2e] Test database target:', postgresDatabaseTarget(process.env.DATABASE_URL_TEST));
}
const nodeCommand = `"${process.execPath}"`;

export default defineConfig({
  testDir: '.',
  testMatch: 'candidate-happy-path.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: `${nodeCommand} backend/scripts/start-test-api.mjs`,
      cwd: rootDirectory,
      url: 'http://127.0.0.1:4001/api/v1/health',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { ...process.env, API_PORT: '4001', E2E_API_PORT: '4001', NODE_ENV: 'development' },
    },
    {
      command: `${nodeCommand} node_modules/vite/bin/vite.js frontend --config frontend/vite.config.ts --host 127.0.0.1 --port 5174 --strictPort`,
      cwd: rootDirectory,
      url: 'http://127.0.0.1:5174/',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...process.env, API_PROXY_TARGET: 'http://127.0.0.1:4001' },
    },
  ],
});