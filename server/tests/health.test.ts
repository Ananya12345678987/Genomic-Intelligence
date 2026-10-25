import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

const baseEnv = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
  SESSION_SECRET: 'x'.repeat(40),
} as NodeJS.ProcessEnv;

describe('environment validation', () => {
  it('accepts a minimal valid configuration', () => {
    const env = parseEnv(baseEnv);
    expect(env.AI_PROVIDER).toBe('none');
    expect(env.AI_ALLOW_SENSITIVE_CONTENT).toBe(false);
  });

  it('rejects a short session secret without echoing its value', () => {
    expect(() => parseEnv({ ...baseEnv, SESSION_SECRET: 'short-secret' })).toThrowError(/SESSION_SECRET/);
    try {
      parseEnv({ ...baseEnv, SESSION_SECRET: 'short-secret' });
    } catch (e) {
      expect((e as Error).message).not.toContain('short-secret');
    }
  });

  it('requires a key and model when an AI provider is selected', () => {
    expect(() => parseEnv({ ...baseEnv, AI_PROVIDER: 'anthropic' })).toThrowError(/AI_API_KEY/);
  });
});

describe('GET /api/health', () => {
  const app = createApp(parseEnv(baseEnv));

  it('reports status without exposing secrets', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(res.body.ai).toEqual({ configured: false, provider: 'none', sensitiveContentAllowed: false });
    expect(JSON.stringify(res.body)).not.toContain('x'.repeat(40));
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects oversized JSON bodies safely', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ a: 'y'.repeat(300_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
