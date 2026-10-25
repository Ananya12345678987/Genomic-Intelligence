import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const int = (def: number) => z.coerce.number().int().nonnegative().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  // Optional path to the built client (client/dist). In production it is auto-detected next to the server.
  CLIENT_DIST: z.string().optional().default(''),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  AI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default(''),
  AI_TIMEOUT_MS: int(30000),
  AI_ALLOW_SENSITIVE_CONTENT: bool,

  NCBI_API_KEY: z.string().optional().default(''),
  NCBI_TOOL: z.string().default('cancer-genomic-intelligence'),
  NCBI_EMAIL: z.string().optional().default(''),
  NCBI_TIMEOUT_MS: int(15000),
  CIVIC_TIMEOUT_MS: int(20000),
  CLINICALTRIALS_TIMEOUT_MS: int(15000),

  EXTERNAL_MAX_RETRIES: int(2),
  EXTERNAL_RETRY_BASE_MS: int(400),

  CACHE_TTL_CLINVAR_SECONDS: int(86400),
  CACHE_TTL_CIVIC_SECONDS: int(86400),
  CACHE_TTL_PUBMED_SECONDS: int(604800),
  CACHE_TTL_TRIALS_SECONDS: int(21600),

  RATE_LIMIT_WINDOW_MS: int(60000),
  RATE_LIMIT_MAX: int(120),
  AUTH_RATE_LIMIT_MAX: int(10),
});

export type Env = z.infer<typeof schema>;

/**
 * Validate environment variables. Error messages name the offending variables
 * but never print their values, so secrets cannot leak through startup logs.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = result.data;
  if (env.AI_PROVIDER !== 'none') {
    const missing: string[] = [];
    if (!env.AI_API_KEY) missing.push('AI_API_KEY');
    if (!env.AI_MODEL) missing.push('AI_MODEL');
    if (missing.length) {
      throw new Error(
        `Invalid environment configuration:\n  - AI_PROVIDER=${env.AI_PROVIDER} requires: ${missing.join(', ')}`,
      );
    }
  }
  return env;
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Test helper: reset the cached environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
