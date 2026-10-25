import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { Env } from '../config/env.js';

export function securityHeaders(env: Pick<Env, 'NODE_ENV'>): RequestHandler {
  return helmet({
    // Strict CSP. The same-origin single-page app needs script/style/font/img from 'self' (helmet
    // defaults) and connect-src 'self' for its own /api calls.
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'none'"],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        // Upgrading http subresources breaks a production build tried over plain http on localhost.
        ...(env.NODE_ENV === 'production' ? {} : { 'upgrade-insecure-requests': null }),
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}

/** Restrictive CORS: a single configured origin, credentials allowed for cookie sessions. */
export function corsPolicy(env: Env): RequestHandler {
  return cors({
    origin: env.CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600,
  });
}

export function apiRateLimiter(env: Env): RequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
  });
}

/** Stricter limiter for authentication endpoints (used from Phase 2). */
export function authRateLimiter(env: Env): RequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS * 15,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
  });
}

/**
 * Searches fan out to several external services, so they get a tighter per-user limit than
 * ordinary API calls. Keyed by the authenticated user (these routes sit behind requireAuth).
 */
export function expensiveRateLimiter(env: Env): RequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.NODE_ENV === 'test' ? 10_000 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => String((req as { auth?: { userId?: unknown } }).auth?.userId ?? 'anonymous'),
    message: { error: { code: 'RATE_LIMITED', message: 'Too many searches in a short time. Please wait a moment.' } },
  });
}
