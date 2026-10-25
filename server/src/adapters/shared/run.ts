import type { SourceName, SourceResult, SourceStatus } from '../types.js';
import { SourceError } from './http.js';
import { TtlCache } from './cache.js';

export interface RunContext<T> {
  source: SourceName;
  query: string;
  limitations: string[];
  cache: TtlCache<SourceResult<T>>;
  cacheKey: string;
  ttlSeconds: number;
  now?: () => number;
}

/**
 * Runs an adapter operation with caching and uniform failure handling.
 * - Successful and empty results are cached with an expiry; failures never are.
 * - A failure becomes a SourceResult with an honest status instead of throwing,
 *   so one unavailable source can never take the whole investigation down.
 */
export async function runSource<T>(
  ctx: RunContext<T>,
  produce: () => Promise<{ items: T[]; total?: number }>,
): Promise<SourceResult<T>> {
  const now = ctx.now ?? Date.now;

  if (ctx.ttlSeconds > 0) {
    const hit = ctx.cache.get(ctx.cacheKey);
    if (hit) {
      return { ...hit.value, fromCache: true, cacheExpiresAt: new Date(hit.expiresAt).toISOString() };
    }
  }

  const base = { source: ctx.source, query: ctx.query, limitations: ctx.limitations, fromCache: false };
  try {
    const { items, total } = await produce();
    const retrievedAt = new Date(now()).toISOString();
    const result: SourceResult<T> = {
      ...base,
      status: items.length ? 'ok' : 'no_results',
      items,
      total: total ?? items.length,
      retrievedAt,
    };
    if (ctx.ttlSeconds > 0) {
      const entry = ctx.cache.set(ctx.cacheKey, result, ctx.ttlSeconds * 1000);
      result.cacheExpiresAt = new Date(entry.expiresAt).toISOString();
    }
    return result;
  } catch (err) {
    const status: SourceStatus = err instanceof SourceError ? err.status : 'unexpected_response';
    const message =
      err instanceof SourceError ? err.message : 'The source response could not be processed.';
    return { ...base, status, items: [], message, retrievedAt: new Date(now()).toISOString() };
  }
}

export function skipped<T>(source: SourceName, query: string, message: string): SourceResult<T> {
  return {
    source,
    status: 'skipped',
    items: [],
    message,
    retrievedAt: new Date().toISOString(),
    fromCache: false,
    query,
    limitations: [],
  };
}
