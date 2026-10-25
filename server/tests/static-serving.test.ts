import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

const base = { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/test', SESSION_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv;
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgi-client-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>APP-SHELL</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'console.log(1)');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('serving the built client from the API server', () => {
  it('returns the app shell for the root and for client-side routes', async () => {
    const app = createApp(parseEnv({ ...base, CLIENT_DIST: dir }));
    for (const url of ['/', '/login', '/i/64b7f0c2a1b2c3d4e5f60718']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).toContain('APP-SHELL');
    }
  });

  it('serves static assets and does not shadow the API or its JSON 404s', async () => {
    const app = createApp(parseEnv({ ...base, CLIENT_DIST: dir }));
    expect((await request(app).get('/assets/a.js')).text).toContain('console.log(1)');
    expect((await request(app).get('/api/health')).body.status).toBeDefined();
    const missing = await request(app).get('/api/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('returns a real 404 for a missing file instead of the app shell', async () => {
    const res = await request(createApp(parseEnv({ ...base, CLIENT_DIST: dir }))).get('/assets/missing-abc123.js');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('APP-SHELL');
  });

  it('allows the page to call its own API (connect-src self) and never caches the shell', async () => {
    const app = createApp(parseEnv({ ...base, CLIENT_DIST: dir }));
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves nothing extra when no client build is configured', async () => {
    const res = await request(createApp(parseEnv(base))).get('/');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
