import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { verifyAccessToken } from './tokens.js';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
};

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
      requestId?: string;
    }
  }
}

export function requireAuthentication(pool: Pool, secret: string) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const userId = token ? verifyAccessToken(token, secret) : null;

    if (!userId) {
      response.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.', details: null, requestId: request.requestId });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT u.id, u.email, u.name, array_agg(r.slug ORDER BY r.slug) AS roles
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1 AND u.email_verified_at IS NOT NULL
           AND u.suspended_at IS NULL AND u.deleted_at IS NULL
         GROUP BY u.id`,
        [userId],
      );
      if (!result.rowCount) {
        response.status(401).json({ code: 'UNAUTHENTICATED', message: 'Your session is no longer valid.', details: null, requestId: request.requestId });
        return;
      }

      request.authenticatedUser = result.rows[0] as AuthenticatedUser;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRoles(...allowedRoles: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.authenticatedUser) {
      response.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.', details: null, requestId: request.requestId });
      return;
    }
    if (!allowedRoles.some((role) => request.authenticatedUser?.roles.includes(role))) {
      response.status(403).json({ code: 'FORBIDDEN', message: 'You do not have permission to perform this action.', details: null, requestId: request.requestId });
      return;
    }
    next();
  };
}