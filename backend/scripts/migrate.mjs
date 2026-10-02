import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  assertLocalTestDatabase,
  postgresConnectionOptions,
  postgresDatabaseTarget,
  testPostgresConnectionOptions,
} from '../src/postgres-connection.mjs';

const { Client } = pg;
const useTestDatabase = process.argv.includes('--test');
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
if (useTestDatabase) {
  dotenv.config({ path: fileURLToPath(new URL('../.env.test', import.meta.url)), override: true });
}
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
let client;

try {
  const connection = useTestDatabase
    ? testPostgresConnectionOptions(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST)
    : postgresConnectionOptions(process.env.DATABASE_URL);
  if (useTestDatabase) {
    const target = assertLocalTestDatabase(process.env.DATABASE_URL_TEST, process.env.ALLOW_REMOTE_TEST_DB === 'true');
    console.info('Test database target:', target);
  }
  client = new Client(connection);
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const applied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename],
    );
    if (applied.rowCount) continue;

    const migration = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(migration);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.info(`Applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  console.error('Database migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}