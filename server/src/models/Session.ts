import { Schema, model, type Types } from 'mongoose';

/**
 * Server-side session. Only a SHA-256 hash of the session token is stored, so a
 * database leak does not expose usable cookies.
 */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    csrfToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
// Expired sessions are also rejected in code, so correctness never depends on the TTL monitor.
// CGI_DISABLE_TTL_INDEX is a TEST-ONLY switch for MongoDB-compatible servers that lack TTL
// indexes (e.g. FerretDB). Never set it against a real MongoDB deployment.
if (process.env.CGI_DISABLE_TTL_INDEX !== '1') {
  sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
}
export const Session = model('Session', sessionSchema);
