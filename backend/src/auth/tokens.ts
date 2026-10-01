import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const issuer = 'placeprep-api';

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createAccessToken(userId: string, secret: string, now = Date.now()): string {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: userId,
    iss: issuer,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 15 * 60,
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function verifyAccessToken(token: string, secret: string, now = Date.now()): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts;
  const unsigned = `${headerPart}.${payloadPart}`;
  const expected = createHmac('sha256', secret).update(unsigned).digest();
  let actual: Buffer;
  let header: { alg?: string; typ?: string };
  let payload: { sub?: string; iss?: string; exp?: number };

  try {
    actual = Buffer.from(signaturePart, 'base64url');
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as typeof header;
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as typeof payload;
  } catch {
    return null;
  }

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  if (header.alg !== 'HS256' || header.typ !== 'JWT' || payload.iss !== issuer) return null;
  if (!payload.sub || !payload.exp || payload.exp <= Math.floor(now / 1000)) return null;
  return payload.sub;
}

export function passwordMeetsPolicy(password: string): boolean {
  return password.length >= 8
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}