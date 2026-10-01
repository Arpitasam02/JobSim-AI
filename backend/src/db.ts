import pg from 'pg';
import { environment } from './config.js';
import { postgresConnectionOptions } from './postgres-connection.mjs';

const { Pool } = pg;

export const TRANSIENT_DB_CONNECT_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
]);

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

export function classifyDatabaseConnectionError(error: unknown): string {
  const code = getErrorCode(error);
  if (code === 'ENOTFOUND' || /ENOTFOUND/i.test(String((error as { message?: string } | null)?.message ?? ''))) {
    return 'DNS_RESOLUTION_FAILED';
  }
  if (code === 'EAI_AGAIN' || /EAI_AGAIN/i.test(String((error as { message?: string } | null)?.message ?? ''))) {
    return 'DNS_RESOLUTION_FAILED';
  }
  if (code === 'ETIMEDOUT' || /ETIMEDOUT/i.test(String((error as { message?: string } | null)?.message ?? ''))) {
    return 'CONNECTION_TIMEOUT';
  }
  if (code === 'ECONNRESET' || /ECONNRESET/i.test(String((error as { message?: string } | null)?.message ?? ''))) {
    return 'CONNECTION_RESET';
  }
  if (error instanceof AggregateError || (typeof error === 'object' && error !== null && 'errors' in error && Array.isArray((error as { errors?: unknown[] }).errors))) {
    return 'MULTIPLE_HOSTS_FAILED';
  }
  if (/auth|password|login|role/i.test(String((error as { message?: string } | null)?.message ?? ''))) {
    return 'AUTH_FAILED';
  }
  if (/ssl|certificate|tls/i.test(String((error as { message?: string } | null)?.message ?? ''))) {
    return 'SSL_ERROR';
  }
  return 'UNKNOWN';
}

export function isTransientConnectionError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && TRANSIENT_DB_CONNECT_ERROR_CODES.has(code)) return true;
  if (error instanceof AggregateError) return true;
  const message = String((error as { message?: string } | null)?.message ?? '');
  return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/i.test(message);
}

function sanitizeDatabaseErrorMessage(message: string): string {
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, '[REDACTED_CONNECTION_STRING]')
    .replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)(\s*[:=]\s*|\s+)[^\s,;"'`]+/gi, '$1$2[REDACTED]');
}

export async function withTransientDbRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientConnectionError(error) || attempt >= 3) throw error;
      const reason = classifyDatabaseConnectionError(error);
      console.warn('Retrying transient DB connection error', {
        operationName,
        attempt,
        reason,
        code: getErrorCode(error),
      });
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw lastError;
}

export const database = new Pool({
  ...postgresConnectionOptions(environment.DATABASE_URL),
  max: environment.DB_POOL_MAX ?? (environment.NODE_ENV === 'test' ? 5 : 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  ssl: environment.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

database.on('error', (error: Error & { code?: string }) => {
  console.error('Unexpected idle database client error', {
    code: typeof error.code === 'string' ? error.code : null,
    message: sanitizeDatabaseErrorMessage(error.message),
  });
});