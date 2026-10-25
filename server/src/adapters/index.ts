import type { Env } from '../config/env.js';
import type { SourceBundle } from './types.js';
import { HttpClient } from './shared/http.js';
import { TtlCache } from './shared/cache.js';
import { ClinVarClient } from './clinvar/index.js';
import { CivicClient } from './civic/index.js';
import { PubMedClient } from './pubmed/index.js';
import { ClinicalTrialsClient } from './clinical-trials/index.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Wire the real adapters from configuration. Pass `fetchImpl` in tests to replay recorded
 * responses; production uses the global fetch.
 *
 * ClinVar and PubMed share ONE client because NCBI limits requests per IP across E-utilities
 * (3/s without an API key, 10/s with one), so their calls must be spaced together.
 */
export function createSources(env: Env, fetchImpl?: FetchLike): SourceBundle {
  const ncbiHttp = new HttpClient(
    {
      timeoutMs: env.NCBI_TIMEOUT_MS,
      maxRetries: env.EXTERNAL_MAX_RETRIES,
      retryBaseMs: env.EXTERNAL_RETRY_BASE_MS,
      minIntervalMs: env.NCBI_API_KEY ? 110 : 350,
    },
    fetchImpl,
  );
  const civicHttp = new HttpClient(
    { timeoutMs: env.CIVIC_TIMEOUT_MS, maxRetries: env.EXTERNAL_MAX_RETRIES, retryBaseMs: env.EXTERNAL_RETRY_BASE_MS, minIntervalMs: 400 },
    fetchImpl,
  );
  const trialsHttp = new HttpClient(
    { timeoutMs: env.CLINICALTRIALS_TIMEOUT_MS, maxRetries: env.EXTERNAL_MAX_RETRIES, retryBaseMs: env.EXTERNAL_RETRY_BASE_MS, minIntervalMs: 150 },
    fetchImpl,
  );
  const ncbiId = { apiKey: env.NCBI_API_KEY || undefined, tool: env.NCBI_TOOL, email: env.NCBI_EMAIL || undefined };

  return {
    clinvar: new ClinVarClient(ncbiHttp, ncbiId, new TtlCache(), env.CACHE_TTL_CLINVAR_SECONDS),
    civic: new CivicClient(civicHttp, new TtlCache(), env.CACHE_TTL_CIVIC_SECONDS),
    pubmed: new PubMedClient(ncbiHttp, ncbiId, new TtlCache(), env.CACHE_TTL_PUBMED_SECONDS),
    trials: new ClinicalTrialsClient(trialsHttp, new TtlCache(), env.CACHE_TTL_TRIALS_SECONDS),
  };
}

export type { SourceBundle } from './types.js';
