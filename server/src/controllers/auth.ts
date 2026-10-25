import type { Request, Response } from 'express';
import { trusted, type Types } from 'mongoose';
import { User, Investigation, ConversationMessage, MatchResult, UserSettings, Variant } from '../models/index.js';
import { HttpError } from '../utils/httpError.js';
import { hashPassword, verifyPassword, verifyDummy } from '../services/auth/password.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  destroySession,
  destroyAllSessionsForUser,
} from '../services/auth/sessions.js';
import { authOf } from '../middleware/auth.js';
import { registerSchema, loginSchema, deleteAccountSchema } from '../validators/auth.js';
import type { Env } from '../config/env.js';

const publicUser = (u: { _id: Types.ObjectId; name: string; email: string; role: string }) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
});

export function authController(env: Env) {
  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    signed: true,
    path: '/',
    maxAge: SESSION_TTL_MS,
  };

  async function startSession(res: Response, userId: Types.ObjectId) {
    const { token, csrfToken } = await createSession(userId);
    res.cookie(SESSION_COOKIE, token, cookieOptions);
    return csrfToken;
  }

  return {
    async register(req: Request, res: Response) {
      const input = registerSchema.parse(req.body);
      const existing = await User.exists({ email: input.email });
      if (existing) {
        // Deliberately vague: does not confirm which part conflicted.
        throw new HttpError(409, 'REGISTRATION_FAILED', 'Unable to register with these details');
      }
      const user = await User.create({
        name: input.name,
        email: input.email,
        role: input.role,
        passwordHash: await hashPassword(input.password),
      });
      const csrfToken = await startSession(res, user._id);
      res.status(201).json({ user: publicUser(user), csrfToken });
    },

    async login(req: Request, res: Response) {
      const input = loginSchema.parse(req.body);
      const user = await User.findOne({ email: input.email }).select('+passwordHash');
      if (!user) {
        await verifyDummy(input.password);
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }
      if (!(await verifyPassword(user.passwordHash, input.password))) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }
      const csrfToken = await startSession(res, user._id);
      res.json({ user: publicUser(user), csrfToken });
    },

    async logout(req: Request, res: Response) {
      await destroySession(authOf(req).sessionToken);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.status(204).end();
    },

    async me(req: Request, res: Response) {
      const auth = authOf(req);
      const user = await User.findById(auth.userId).lean();
      if (!user) throw HttpError.unauthorized();
      res.json({ user: publicUser(user), csrfToken: auth.csrfToken });
    },

    /** Permanent deletion of the account and everything it owns. Requires the password. */
    async deleteAccount(req: Request, res: Response) {
      const auth = authOf(req);
      const { password } = deleteAccountSchema.parse(req.body);
      const user = await User.findById(auth.userId).select('+passwordHash');
      if (!user || !(await verifyPassword(user.passwordHash, password))) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid password');
      }
      const owned = await Investigation.find({ userId: user._id }).select('_id').lean();
      const ids = owned.map((i) => i._id);
      // sanitizeFilter is on globally, so operators built by our own code must be marked trusted.
      await ConversationMessage.deleteMany({ investigationId: trusted({ $in: ids }) });
      await MatchResult.deleteMany({ investigationId: trusted({ $in: ids }) });
      await Variant.deleteMany({ userId: user._id });
      await Investigation.deleteMany({ userId: user._id });
      await UserSettings.deleteMany({ userId: user._id });
      await destroyAllSessionsForUser(user._id);
      await User.deleteOne({ _id: user._id });
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.status(204).end();
    },
  };
}
