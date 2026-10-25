import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Types } from 'mongoose';
import { Session } from '../../models/index.js';

export const SESSION_COOKIE = 'cgi_sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export async function createSession(userId: Types.ObjectId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  await Session.create({
    userId,
    tokenHash: sha256(token),
    csrfToken,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { token, csrfToken };
}

export async function findValidSession(token: string) {
  const session = await Session.findOne({ tokenHash: sha256(token) }).lean();
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }
  return session;
}

export async function destroySession(token: string): Promise<void> {
  await Session.deleteOne({ tokenHash: sha256(token) });
}

export async function destroyAllSessionsForUser(userId: Types.ObjectId | string): Promise<void> {
  await Session.deleteMany({ userId });
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
