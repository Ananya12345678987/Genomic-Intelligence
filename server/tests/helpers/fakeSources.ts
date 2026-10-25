import { HttpClient } from '../../src/adapters/shared/http.js';
import { TtlCache } from '../../src/adapters/shared/cache.js';
import { ClinVarClient } from '../../src/adapters/clinvar/index.js';
import { CivicClient } from '../../src/adapters/civic/index.js';
import { PubMedClient } from '../../src/adapters/pubmed/index.js';
import { ClinicalTrialsClient } from '../../src/adapters/clinical-trials/index.js';
import type { SourceBundle } from '../../src/adapters/types.js';
import { CIVIC_RESPONSE, CLINVAR_ESEARCH, CLINVAR_ESUMMARY, PUBMED_ESEARCH, PUBMED_XML, TRIALS_RESPONSE, jsonResponse } from '../fixtures/sources.js';

export type Host = 'ncbi' | 'civic' | 'trials';

/**
 * Real adapters (real parsing, caching, retry and failure handling) over a fake network that replays
 * the hand-written fixtures. Pass `down` to make a host fail like an outage.
 */
export function fakeSources(opts: { down?: Host[] } = {}) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, _init?: RequestInit): Promise<Response> => {
    calls.push(url);
    const host: Host = url.includes('clinicaltrials.gov') ? 'trials' : url.includes('civicdb.org') ? 'civic' : 'ncbi';
    if (opts.down?.includes(host)) throw new TypeError('fetch failed');
    if (host === 'trials') return jsonResponse(TRIALS_RESPONSE);
    if (host === 'civic') return jsonResponse(CIVIC_RESPONSE);
    if (url.includes('db=pubmed')) return url.includes('esearch') ? jsonResponse(PUBMED_ESEARCH) : new Response(PUBMED_XML, { status: 200 });
    return url.includes('esearch') ? jsonResponse(CLINVAR_ESEARCH) : jsonResponse(CLINVAR_ESUMMARY);
  };
  const policy = { timeoutMs: 1000, maxRetries: 0, retryBaseMs: 1, minIntervalMs: 0 };
  const noSleep = async () => undefined;
  const http = () => new HttpClient(policy, fetchImpl, noSleep);
  const id = { tool: 'cgi-test' };
  const sources: SourceBundle = {
    clinvar: new ClinVarClient(http(), id, new TtlCache(), 60),
    civic: new CivicClient(http(), new TtlCache(), 60),
    pubmed: new PubMedClient(http(), id, new TtlCache(), 60),
    trials: new ClinicalTrialsClient(http(), new TtlCache(), 60),
  };
  return { sources, calls };
}
