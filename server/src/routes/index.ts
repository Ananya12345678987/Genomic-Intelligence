import { Router } from 'express';
import type { Env } from '../config/env.js';
import type { AppDeps } from '../services/deps.js';
import { healthRouter } from './health.js';
import { authRouter } from './auth.js';
import { investigationsRouter } from './investigations.js';
import { researchRouter } from './research.js';

export function apiRouter(env: Env, deps: AppDeps): Router {
  const router = Router();
  router.use('/health', healthRouter(env));
  router.use('/auth', authRouter(env));
  router.use('/investigations', investigationsRouter());
  // Mounted last and at the root: it applies requireAuth only to the paths it defines.
  router.use('/', researchRouter(env, deps));
  return router;
}
