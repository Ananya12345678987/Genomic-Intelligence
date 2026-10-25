import { Router } from 'express';
import type { Env } from '../config/env.js';
import { dbStatus } from '../config/db.js';

export function healthRouter(env: Env): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const database = dbStatus();
    // Report capability flags, never secrets. The client uses these to show
    // honest "AI summarization unavailable" states.
    res.json({
      status: database === 'connected' ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      database,
      ai: {
        configured: env.AI_PROVIDER !== 'none',
        provider: env.AI_PROVIDER,
        // Whether the operator permits report-derived content to reach the provider at all.
        sensitiveContentAllowed: env.AI_ALLOW_SENSITIVE_CONTENT,
      },
      sources: {
        // Adapters are enabled; availability is reported per search, not guessed here.
        clinvar: 'enabled',
        civic: 'enabled',
        pubmed: 'enabled',
        clinicalTrials: 'enabled',
      },
    });
  });

  return router;
}
