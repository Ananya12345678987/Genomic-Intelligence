import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { tryConnectTestDb, resetTestDb, closeTestDb } from './helpers/db.js';
import { app, registerAgent, PASSWORD } from './helpers/app.js';
import { User, Investigation, ConversationMessage, Session } from '../src/models/index.js';

const dbUp = await tryConnectTestDb();

describe.skipIf(!dbUp)('auth and investigations (requires a MongoDB-compatible database)', () => {
  beforeAll(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  describe('registration and login', () => {
    it('registers, sets an HttpOnly cookie, and never returns or stores a plaintext password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Ada', email: 'Ada@Example.com', password: PASSWORD });
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ name: 'Ada', email: 'ada@example.com', role: 'researcher' });
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
      expect(res.body.user.passwordHash).toBeUndefined();

      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('cgi_sid='));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);

      const stored = await User.findOne({ email: 'ada@example.com' }).select('+passwordHash').lean();
      expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored?.passwordHash).not.toContain(PASSWORD);
    });

    it('stores only a hash of the session token', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Hash Check', email: 'hash@example.com', password: PASSWORD });
      const raw = (res.headers['set-cookie'] as unknown as string[])[0]!;
      const tokenPart = decodeURIComponent(raw.split(';')[0]!.split('=')[1]!); // "s:<token>.<sig>"
      const token = tokenPart.slice(2, tokenPart.lastIndexOf('.'));
      const sessions = await Session.find().lean();
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.some((s) => s.tokenHash === token)).toBe(false);
    });

    it('rejects duplicate emails with a non-specific error', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Ada 2', email: 'ada@example.com', password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REGISTRATION_FAILED');
    });

    it('rejects short passwords and malformed emails', async () => {
      const short = await request(app).post('/api/auth/register').send({ name: 'X', email: 'x@example.com', password: 'short' });
      expect(short.status).toBe(400);
      const bad = await request(app).post('/api/auth/register').send({ name: 'X', email: 'not-an-email', password: PASSWORD });
      expect(bad.status).toBe(400);
    });

    it('gives the same error for a wrong password and an unknown account', async () => {
      const wrong = await request(app).post('/api/auth/login').send({ email: 'ada@example.com', password: 'wrong-password-123' });
      const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password-123' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error).toEqual(unknown.body.error);
    });

    it('logs in with correct credentials and reports the session via /me', async () => {
      const agent = request.agent(app);
      const login = await agent.post('/api/auth/login').send({ email: 'ada@example.com', password: PASSWORD });
      expect(login.status).toBe(200);
      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe('ada@example.com');
      expect(me.body.csrfToken).toBe(login.body.csrfToken);
    });

    it('requires a session for /me', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects a tampered session cookie', async () => {
      const res = await request(app).get('/api/auth/me').set('Cookie', 'cgi_sid=s%3Aforged.token');
      expect(res.status).toBe(401);
    });

    it('invalidates the session on logout', async () => {
      const u = await registerAgent('logout@example.com');
      expect((await u.get('/api/auth/me')).status).toBe(200);
      expect((await u.post('/api/auth/logout')).status).toBe(204);
      expect((await u.get('/api/auth/me')).status).toBe(401);
    });
  });

  describe('NoSQL injection resistance', () => {
    it('rejects operator objects in login fields', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
      expect(res.status).toBe(400);
    });

    it('rejects operator objects in query parameters', async () => {
      const u = await registerAgent('inject@example.com');
      const res = await u.get('/api/investigations?q[$ne]=zzz');
      expect(res.status).toBe(400);
    });

    it('rejects non-ObjectId identifiers', async () => {
      const u = await registerAgent('badid@example.com');
      const res = await u.get('/api/investigations/%7B%22%24ne%22%3Anull%7D');
      expect(res.status).toBe(400);
    });
  });

  describe('CSRF', () => {
    it('blocks state-changing requests that lack the CSRF header', async () => {
      const u = await registerAgent('csrf@example.com');
      const res = await u.agent.post('/api/investigations').send({ title: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    });

    it('blocks a wrong CSRF token', async () => {
      const u = await registerAgent('csrf2@example.com');
      const res = await u.agent.post('/api/investigations').set('X-CSRF-Token', 'nope').send({ title: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('investigation CRUD and ownership', () => {
    it('creates, lists, renames and deletes an investigation', async () => {
      const u = await registerAgent('owner@example.com');
      const created = await u.post('/api/investigations').send({ title: 'BRAF melanoma review' });
      expect(created.status).toBe(201);
      const id = created.body.investigation.id as string;

      const list = await u.get('/api/investigations');
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].title).toBe('BRAF melanoma review');

      const renamed = await u.patch(`/api/investigations/${id}`).send({ title: 'Renamed' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.investigation.title).toBe('Renamed');

      expect((await u.del(`/api/investigations/${id}`)).status).toBe(204);
      expect((await u.get(`/api/investigations/${id}`)).status).toBe(404);
    });

    it('defaults the title and validates metadata', async () => {
      const u = await registerAgent('meta@example.com');
      const ok = await u.post('/api/investigations').send({});
      expect(ok.body.investigation.title).toBe('Untitled investigation');
      const bad = await u.post('/api/investigations').send({ inputMetadata: { referenceGenome: 'hg19-ish' } });
      expect(bad.status).toBe(400);
      const extra = await u.post('/api/investigations').send({ inputMetadata: { userId: 'x' } });
      expect(extra.status).toBe(400);
    });

    it('stores reference genome and cancer context without guessing missing fields', async () => {
      const u = await registerAgent('ctx@example.com');
      const res = await u
        .post('/api/investigations')
        .send({ title: 'ctx', inputMetadata: { cancerType: 'Melanoma', referenceGenome: 'GRCh38' } });
      expect(res.body.investigation.inputMetadata).toMatchObject({
        cancerType: 'Melanoma',
        referenceGenome: 'GRCh38',
        transcriptId: null,
        specimenContext: null,
      });
    });

    it('searches titles safely, including regex metacharacters', async () => {
      const u = await registerAgent('search@example.com');
      await u.post('/api/investigations').send({ title: 'EGFR (L858R) lung' });
      await u.post('/api/investigations').send({ title: 'KRAS G12C' });
      const hit = await u.get('/api/investigations?q=egfr');
      expect(hit.body.items.map((i: { title: string }) => i.title)).toEqual(['EGFR (L858R) lung']);
      const meta = await u.get('/api/investigations').query({ q: '(L858R' });
      expect(meta.status).toBe(200);
      expect(meta.body.total).toBe(1);
      const wildcard = await u.get('/api/investigations').query({ q: '.*' });
      expect(wildcard.body.total).toBe(0);
    });

    it("never exposes another user's investigations or messages", async () => {
      const alice = await registerAgent('alice@example.com');
      const bob = await registerAgent('bob@example.com');
      const created = await alice.post('/api/investigations').send({ title: 'Alice private' });
      const id = created.body.investigation.id as string;
      await ConversationMessage.create({ investigationId: id, role: 'user', content: 'secret query' });

      expect((await bob.get(`/api/investigations/${id}`)).status).toBe(404);
      expect((await bob.get(`/api/investigations/${id}/messages`)).status).toBe(404);
      expect((await bob.patch(`/api/investigations/${id}`).send({ title: 'hijack' })).status).toBe(404);
      expect((await bob.del(`/api/investigations/${id}`)).status).toBe(404);
      expect((await bob.get('/api/investigations')).body.total).toBe(0);

      const still = await alice.get(`/api/investigations/${id}`);
      expect(still.body.investigation.title).toBe('Alice private');
      const msgs = await alice.get(`/api/investigations/${id}/messages`);
      expect(msgs.body.items).toHaveLength(1);
    });

    it('requires authentication for every investigation route', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      expect((await request(app).get('/api/investigations')).status).toBe(401);
      expect((await request(app).get(`/api/investigations/${id}`)).status).toBe(401);
      expect((await request(app).post('/api/investigations').send({})).status).toBe(401);
    });

    it('deletes messages together with their investigation', async () => {
      const u = await registerAgent('cascade@example.com');
      const created = await u.post('/api/investigations').send({ title: 'to delete' });
      const id = created.body.investigation.id as string;
      await ConversationMessage.create({ investigationId: id, role: 'user', content: 'q' });
      await u.del(`/api/investigations/${id}`);
      expect(await ConversationMessage.countDocuments({ investigationId: id })).toBe(0);
    });
  });

  describe('account deletion', () => {
    it('requires the correct password', async () => {
      const u = await registerAgent('keep@example.com');
      const res = await u.del('/api/auth/me').send({ password: 'definitely-wrong-1' });
      expect(res.status).toBe(401);
      expect(await User.exists({ email: 'keep@example.com' })).toBeTruthy();
    });

    it('removes the user, sessions and owned data', async () => {
      const u = await registerAgent('gone@example.com');
      const inv = await u.post('/api/investigations').send({ title: 'mine' });
      await ConversationMessage.create({ investigationId: inv.body.investigation.id, role: 'user', content: 'q' });
      const res = await u.del('/api/auth/me').send({ password: PASSWORD });
      expect(res.status).toBe(204);
      expect(await User.exists({ email: 'gone@example.com' })).toBeNull();
      expect(await Investigation.countDocuments({ userId: u.userId })).toBe(0);
      expect(await ConversationMessage.countDocuments({ investigationId: inv.body.investigation.id })).toBe(0);
      expect(await Session.countDocuments({ userId: u.userId })).toBe(0);
      expect((await u.get('/api/auth/me')).status).toBe(401);
    });
  });
});

if (!dbUp) {
  describe('integration tests', () => {
    it.skip('SKIPPED: no MongoDB-compatible database reachable (set MONGODB_URI_TEST)', () => undefined);
  });
}
