import type { Env } from '../config/env.js';
import { createSources } from '../adapters/index.js';
import type { SourceBundle } from '../adapters/types.js';
import { createAiProvider, type AiProvider } from './ai/provider.js';
import { ReportStore } from './reports/store.js';

/** Everything with side effects on the outside world, injectable so tests can replace it. */
export interface AppDeps {
  sources: SourceBundle;
  ai: AiProvider | null;
  reports: ReportStore;
}

export function createDeps(env: Env, overrides: Partial<AppDeps> = {}): AppDeps {
  const reports = overrides.reports ?? new ReportStore();
  if (env.NODE_ENV !== 'test') reports.start();
  return {
    sources: overrides.sources ?? createSources(env),
    // `ai: null` in overrides means "no provider", so check for the key rather than for undefined.
    ai: 'ai' in overrides ? (overrides.ai ?? null) : createAiProvider(env),
    reports,
  };
}
