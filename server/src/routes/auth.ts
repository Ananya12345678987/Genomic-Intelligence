import { Router } from 'express';
import type { Env } from '../config/env.js';
import { authController } from '../controllers/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/security.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export function authRouter(env: Env): Router {
  const router = Router();
  const c = authController(env);
  const limiter = authRateLimiter(env);

  router.post('/register', limiter, asyncHandler(c.register));
  router.post('/login', limiter, asyncHandler(c.login));
  router.post('/logout', requireAuth, asyncHandler(c.logout));
  router.get('/me', requireAuth, asyncHandler(c.me));
  router.delete('/me', requireAuth, asyncHandler(c.deleteAccount));

  return router;
}
