import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: path.resolve(fileURLToPath(new URL('../.env', import.meta.url))) });

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error('DATABASE_URL is required. Set it in backend/.env before starting the API.');
}

const environmentSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  DB_POOL_MAX: z.coerce.number().int().positive().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().optional(),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  JWT_ACCESS_SECRET: z.string().min(32).default('local-access-secret-change-before-deploying-01'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
});

export const environment = environmentSchema.parse(process.env);

if (environment.REDIS_URL) {
  console.info('Redis configured: cache, rate-limit, and queue features are enabled.');
} else {
  console.warn('REDIS_URL is not set. Redis-backed cache, rate-limit, and queue features are disabled; the app will continue without them.');
}

if (environment.NODE_ENV === 'production' && environment.JWT_ACCESS_SECRET.startsWith('local-')) {
  throw new Error('JWT_ACCESS_SECRET must be set to a secure production value.');
}