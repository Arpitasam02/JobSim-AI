import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import supertest from 'supertest';
import { createTestPool } from '../support/database.mjs';
import { createAccessToken } from '../../dist/auth/tokens.js';

export const pool = createTestPool();
export const accessSecret = process.env.JWT_ACCESS_SECRET ?? 'placeprep-integration-test-secret';
const { createApp } = await import('../../dist/app.js');
export const app = createApp(pool, accessSecret);
export const request = supertest;

export const roleSlugs = ['candidate', 'recruiter', 'placement_officer', 'mentor', 'super_admin'];

const transientNetworkCodes = new Set(['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);
const retryDelays = [100, 250, 500];

async function queryWithTransientRetry(query, values) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await pool.query(query, values);
    } catch (error) {
      if (!transientNetworkCodes.has(error?.code) || attempt >= retryDelays.length) throw error;
      await delay(retryDelays[attempt]);
    }
  }
}

export async function createRoleUser(role) {
  const roleResult = await queryWithTransientRetry('SELECT id FROM roles WHERE slug = $1', [role]);
  if (!roleResult.rowCount) throw new Error(`Seeded role is missing: ${role}`);
  const email = `api-test-${role}-${randomUUID()}@example.test`;
  const passwordHash = `unused-test-hash-${randomUUID()}`;
  const name = `API test ${role}`;
  const userResult = await queryWithTransientRetry(
    `INSERT INTO users (email, password_hash, name, email_verified_at)
     VALUES ($1, $2, $3, now()) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [email, passwordHash, name],
  );
  const id = userResult.rows[0].id;
  await queryWithTransientRetry(
    'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [id, roleResult.rows[0].id],
  );
  if (role === 'candidate') {
    await queryWithTransientRetry('INSERT INTO candidate_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [id]);
  }
  return { id, email, role, token: createAccessToken(id, accessSecret) };
}

export async function deleteUsers(users) {
  const ids = users.map((user) => typeof user === 'string' ? user : user.id).filter(Boolean);
  if (ids.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
}

export function withAuth(testRequest, token) {
  return testRequest.set('Authorization', `Bearer ${token}`);
}