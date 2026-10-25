import type { Env } from '../../config/env.js';
import { HttpClient, SourceError } from '../../adapters/shared/http.js';

export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
}

/** Provider-neutral interface. Add another provider by implementing this and registering it below. */
export interface AiProvider {
  readonly name: string;
  complete(req: AiRequest): Promise<string>;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Anthropic Messages API adapter. The key is read from server configuration only. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly http: HttpClient;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    timeoutMs: number,
    fetchImpl?: FetchLike,
  ) {
    this.http = new HttpClient({ timeoutMs, maxRetries: 1, retryBaseMs: 500, minIntervalMs: 0 }, fetchImpl);
  }

  async complete(req: AiRequest): Promise<string> {
    try {
      const body = (await this.http.requestJson('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          temperature: 0,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      })) as { content?: { type?: string; text?: string }[] };
      const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      if (!text) throw new AiUnavailableError('The AI provider returned an empty response.');
      return text;
    } catch (err) {
      if (err instanceof AiUnavailableError) throw err;
      // Never include the provider's response body or request headers.
      const detail = err instanceof SourceError ? err.message : 'The AI provider could not be reached.';
      throw new AiUnavailableError(detail);
    }
  }
}

/** Returns null when no provider is configured; callers then use the deterministic summary. */
export function createAiProvider(env: Env, fetchImpl?: FetchLike): AiProvider | null {
  if (env.AI_PROVIDER === 'anthropic') {
    return new AnthropicProvider(env.AI_API_KEY, env.AI_MODEL, env.AI_TIMEOUT_MS, fetchImpl);
  }
  return null;
}
