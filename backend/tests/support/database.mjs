import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { testPostgresConnectionOptions } from '../../src/postgres-connection.mjs';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { Pool } = pg;
const primaryDatabaseUrl = process.env.DATABASE_URL;
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const connection = testPostgresConnectionOptions(primaryDatabaseUrl, testDatabaseUrl);

process.env.DATABASE_URL ??= testDatabaseUrl;
process.env.NODE_ENV = 'development';

export function createTestPool() {
  return new Pool({ ...connection, max: Number(process.env.DB_POOL_MAX ?? 5) });
}