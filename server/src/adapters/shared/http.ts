import type { SourceStatus } from '../types.js';

export interface HttpPolicy {
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  /** Minimum spacing between requests to this host (client-side rate limiting). */
  minIntervalMs: number;
}

/** A failure that maps cleanly onto a SourceStatus. Never contains response bodies or secrets. */
export class SourceError extends Error {
  constructor(
    public readonly status: Exclude<SourceStatus, 'ok' | 'no_results' | 'skipped'>,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRY_AFTER_MS = 10_000;

const RETRYABLE = new Set([500, 502, 503, 504]);

/**
 * HTTP client for public APIs: per-request timeout, bounded retries with
 * exponential backoff + jitter (honouring Retry-After), and client-side
 * spacing between requests so we stay inside each provider's published limit.
 */
export class HttpClient {
  private nextSlot = 0;

  constructor(
    private readonly policy: HttpPolicy,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly sleep: Sleep = defaultSleep,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  private async gate(): Promise<void> {
    const { minIntervalMs } = this.policy;
    if (minIntervalMs <= 0) return;
    const t = this.now();
    const slot = Math.max(t, this.nextSlot);
    this.nextSlot = slot + minIntervalMs;
    const wait = slot - t;
    if (wait > 0) await this.sleep(wait);
  }

  private backoffMs(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
    }
    const base = this.policy.retryBaseMs * 2 ** attempt;
    return Math.min(base + Math.floor(this.random() * this.policy.retryBaseMs), MAX_RETRY_AFTER_MS);
  }

  async requestText(url: string, init: RequestInit = {}): Promise<string> {
    const attempts = this.policy.maxRetries + 1;
    let lastError: SourceError | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.gate();
      let retryAfter: string | null = null;
      try {
        const res = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(this.policy.timeoutMs),
          headers: {
            'User-Agent': 'cancer-genomic-intelligence/0.1 (research prototype)',
            ...((init.headers as Record<string, string>) ?? {}),
          },
        });
        if (res.ok) return await res.text();

        retryAfter = res.headers.get('retry-after');
        if (res.status === 429) {
          lastError = new SourceError('rate_limited', 'The source rate-limited this request.', 429);
        } else if (RETRYABLE.has(res.status)) {
          lastError = new SourceError('unavailable', `The source returned HTTP ${res.status}.`, res.status);
        } else {
          // Other 4xx: our request was not accepted; retrying will not help.
          throw new SourceError('unexpected_response', `The source rejected the request (HTTP ${res.status}).`, res.status);
        }
      } catch (err) {
        if (err instanceof SourceError && err.status === 'unexpected_response') throw err;
        if (!(err instanceof SourceError)) {
          const name = (err as Error)?.name;
          lastError = new SourceError(
            'unavailable',
            name === 'TimeoutError' || name === 'AbortError' ? 'The source timed out.' : 'The source could not be reached.',
          );
        }
      }

      if (attempt < attempts - 1) await this.sleep(this.backoffMs(attempt, retryAfter));
    }
    throw lastError ?? new SourceError('unavailable', 'The source could not be reached.');
  }

  async requestJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const text = await this.requestText(url, {
      ...init,
      headers: { Accept: 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
    });
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SourceError('unexpected_response', 'The source returned a response that was not valid JSON.');
    }
  }
}
