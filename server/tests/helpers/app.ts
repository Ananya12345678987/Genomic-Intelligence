import request from 'supertest';
import { createApp } from '../../src/app.js';
import { parseEnv } from '../../src/config/env.js';
import { TEST_MONGODB_URI } from './db.js';

export const testEnv = parseEnv({
  NODE_ENV: 'test',
  MONGODB_URI: TEST_MONGODB_URI,
  SESSION_SECRET: 's'.repeat(48),
  AUTH_RATE_LIMIT_MAX: '1000',
  RATE_LIMIT_MAX: '100000',
} as NodeJS.ProcessEnv);

export const app = createApp(testEnv);

export const PASSWORD = 'correct-horse-battery-staple';

/** A logged-in agent with its CSRF token, for exercising authenticated routes. */
export async function registerAgent(email: string, name = 'Test User', role: 'researcher' | 'clinician' = 'researcher') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ name, email, password: PASSWORD, role });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf: string = res.body.csrfToken;
  return {
    agent,
    csrf,
    userId: res.body.user.id as string,
    post: (url: string) => agent.post(url).set('X-CSRF-Token', csrf),
    patch: (url: string) => agent.patch(url).set('X-CSRF-Token', csrf),
    del: (url: string) => agent.delete(url).set('X-CSRF-Token', csrf),
    get: (url: string) => agent.get(url),
  };
}
