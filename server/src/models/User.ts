import { Schema, model, type InferSchemaType } from 'mongoose';

export const USER_ROLES = ['researcher', 'clinician'] as const;
export type UserRole = (typeof USER_ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // Argon2id PHC string. Excluded from queries unless explicitly selected.
    passwordHash: { type: String, required: true, select: false },
    // Self-declared at registration. This is NOT proof of clinical authorization.
    role: { type: String, enum: USER_ROLES, required: true, default: 'researcher' },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
