import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../services/auth/password.js';
import { USER_ROLES } from '../models/User.js';

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(128),
  role: z.enum(USER_ROLES).default('researcher'),
});

export const loginSchema = z.object({
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
});
