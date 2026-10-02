import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { postgresDatabaseTarget, testPostgresConnectionOptions } from '../src/postgres-connection.mjs';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../.env.test', import.meta.url)), override: true });
const connection = testPostgresConnectionOptions(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
console.info('Test API database target:', postgresDatabaseTarget(process.env.DATABASE_URL_TEST));
process.env.DATABASE_URL = connection.connectionString;
process.env.NODE_ENV = 'development';
process.env.DB_POOL_MAX ??= '5';
process.env.API_PORT = process.env.E2E_API_PORT ?? '4001';
await import('../dist/server.js');