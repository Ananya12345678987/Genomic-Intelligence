import { hash, verify, type Options } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

// Argon2id (algorithm 2), parameters following OWASP's minimum recommendation (19 MiB, t=2, p=1).
const OPTIONS: Options = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Verify against a throwaway hash when the account does not exist, so response
 * time does not reveal whether an email is registered.
 */
export async function verifyDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, plain);
}
