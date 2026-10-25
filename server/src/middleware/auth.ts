import type { NextFunction, Request, Response } from 'express';
import type { Types } from 'mongoose';
import { User, type UserRole } from '../models/index.js';
import { HttpError } from '../utils/httpError.js';
import { SESSION_COOKIE, findValidSession, safeEqual } from '../services/auth/sessions.js';

export interface AuthContext {
  userId: Types.ObjectId;
  role: UserRole;
  csrfToken: string;
  sessionToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Requires a valid session cookie. For state-changing methods it also requires
 * an X-CSRF-Token header matching the session's token (a header a cross-site
 * form cannot set). CORS is restricted to one origin and cookies are SameSite.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.signedCookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) throw HttpError.unauthorized();

    const session = await findValidSession(token);
    if (!session) throw HttpError.unauthorized();

    if (MUTATING.has(req.method)) {
      const header = req.get('x-csrf-token');
      if (!header || !safeEqual(header, session.csrfToken)) {
        throw new HttpError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token');
      }
    }

    const user = await User.findById(session.userId).select('role').lean();
    if (!user) throw HttpError.unauthorized();

    req.auth = { userId: session.userId, role: user.role, csrfToken: session.csrfToken, sessionToken: token };
    next();
  } catch (err) {
    next(err);
  }
}

/** Typed accessor used inside controllers that sit behind requireAuth. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw HttpError.unauthorized();
  return req.auth;
}
