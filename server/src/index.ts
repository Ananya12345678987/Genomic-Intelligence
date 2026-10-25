import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';

async function main() {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    // Message lists variable names only, never values.
    console.error((err as Error).message);
    process.exit(1);
  }

  const app = createApp(env);
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server listening');
  });

  // Start the HTTP server first so /api/health can report "degraded" while the
  // database is unreachable, instead of the process crashing.
  connectDb(env.MONGODB_URI).catch((err) => {
    logger.error({ message: (err as Error).message }, 'MongoDB connection failed; running degraded');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await disconnectDb().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
