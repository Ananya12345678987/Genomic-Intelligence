import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import { logger } from './config/logger.js';
import { apiRouter } from './routes/index.js';
import { corsPolicy, securityHeaders, apiRateLimiter } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createDeps, type AppDeps } from './services/deps.js';

/**
 * Where the built client lives, if it should be served by this process. Serving the website and the
 * API from one origin keeps the session cookie first-party (it is SameSite=Lax) and avoids CORS.
 */
export function resolveClientDist(env: Pick<Env, 'NODE_ENV' | 'CLIENT_DIST'>): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url)); // server/src or server/dist
  const dir = env.CLIENT_DIST ? path.resolve(env.CLIENT_DIST) : env.NODE_ENV === 'production' ? path.resolve(here, '../../client/dist') : null;
  return dir && fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

/** Build the Express app. Taking env as a parameter keeps it testable without a database. */
export function createApp(env: Env, overrides: Partial<AppDeps> = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // Needed for secure cookies and correct client IPs behind a TLS-terminating proxy.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(securityHeaders(env));
  app.use(corsPolicy(env));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser(env.SESSION_SECRET));
  app.use('/api', apiRateLimiter(env));

  app.use('/api', apiRouter(env, createDeps(env, overrides)));

  const clientDir = resolveClientDist(env);
  if (clientDir) {
    app.use(
      express.static(clientDir, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, file) => {
          if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    // Single-page app: any GET that is not an API call returns the app shell.
    app.get(/^(?!\/api(\/|$)).*/, (req, res, next) => {
      // A path that names a file (has an extension) but was not found above is a real 404, not the app.
      if (/\.[A-Za-z0-9]+$/.test(req.path)) return next();
      // Never cache the shell, so a redeploy is picked up immediately (assets are content-hashed).
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'), { cacheControl: false });
    });
    logger.info({ clientDir }, 'Serving the built client from this server');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
