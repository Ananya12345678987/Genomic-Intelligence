import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from '../src/adapters/shared/http.js';
import { TtlCache } from '../src/adapters/shared/cache.js';
import { ClinVarClient, buildClinVarTerm } from '../src/adapters/clinvar/index.js';
import { CivicClient, buildCivicQueries } from '../src/adapters/civic/index.js';
import { PubMedClient, parsePubmedXml, buildPubMedTerm } from '../src/adapters/pubmed/index.js';
import { ClinicalTrialsClient, toTrialRecord } from '../src/adapters/clinical-trials/index.js';
import { parseVariantInput } from '../src/services/variant-normalization/index.js';
import {
  CIVIC_RESPONSE, CLINVAR_ESEARCH, CLINVAR_ESUMMARY, PUBMED_ESEARCH, PUBMED_XML, TRIALS_RESPONSE, jsonResponse,
} from './fixtures/sources.js';

const noSleep = async () => undefined;
const policy = { timeoutMs: 1000, maxRetries: 2, retryBaseMs: 1, minIntervalMs: 0 };
const mkHttp = (fetchImpl: (u: string, i?: RequestInit) => Promise<Response>) => new HttpClient(policy, fetchImpl, noSleep);
const id = { tool: 'cgi-test' };
const braf = parseVariantInput('BRAF p.Val600Glu');

function clinvarFetch() {
  return vi.fn(async (url: string) =>
    url.includes('esearch.fcgi') ? jsonResponse(CLINVAR_ESEARCH) : jsonResponse(CLINVAR_ESUMMARY),
  );
}

describe('ClinVar adapter', () => {
  it('builds a gene+change query without inventing fields', () => {
    expect(buildClinVarTerm(braf)).toBe('BRAF[gene] AND (V600E OR Val600Glu)');
    expect(buildClinVarTerm(parseVariantInput('BRAF'))).toBe('BRAF[gene]');
    expect(buildClinVarTerm(parseVariantInput('V600E'))).toBeNull();
  });

  it('parses variant records and keeps each classification in its own scope', async () => {
    const f = clinvarFetch();
    const c = new ClinVarClient(mkHttp(f), id, new TtlCache(), 60);
    const r = await c.searchVariants(braf, {});
    expect(r.status).toBe('ok');
    expect(r.items).toHaveLength(2);
    const v = r.items[0]!;
    expect(v.ref.canonicalUrl).toBe('https://www.ncbi.nlm.nih.gov/clinvar/variation/13961/');
    expect(v.ref.identifiers).toMatchObject({ clinvarVariationId: '13961', clinvarAccession: 'VCV000013961', rsId: 'rs113488022' });
    const scopes = v.classifications.map((c) => c.scope);
    expect(scopes).toEqual(['germline_pathogenicity', 'somatic_oncogenicity']);
    expect(v.classifications[0]).toMatchObject({ label: 'Pathogenic', reviewStatus: 'reviewed by expert panel', lastEvaluated: '2023/05/01 00:00' });
    // SPDI gave genomic coordinates on a known assembly.
    expect(v.ref.parsed).toMatchObject({ referenceGenome: 'GRCh38', chromosome: '7', position: 140753336, referenceAllele: 'A', alternateAllele: 'T' });
    expect(v.limitations.join(' ')).toMatch(/not every classification is expert-reviewed/);
  });

  it('caches successful responses with an expiry and reports fromCache', async () => {
    const f = clinvarFetch();
    const c = new ClinVarClient(mkHttp(f), id, new TtlCache(), 60);
    await c.searchVariants(braf, {});
    const calls = f.mock.calls.length;
    const again = await c.searchVariants(braf, {});
    expect(again.fromCache).toBe(true);
    expect(again.cacheExpiresAt).toBeDefined();
    expect(f.mock.calls.length).toBe(calls);
  });

  it('retries 503 then reports unavailable, and does not cache the failure', async () => {
    const f = vi.fn(async () => new Response('down', { status: 503 }));
    const c = new ClinVarClient(mkHttp(f), id, new TtlCache(), 60);
    const r = await c.searchVariants(braf, {});
    expect(r.status).toBe('unavailable');
    expect(r.items).toEqual([]);
    expect(f).toHaveBeenCalledTimes(3); // 1 try + 2 retries
    await c.searchVariants(braf, {});
    expect(f).toHaveBeenCalledTimes(6); // failure was not served from cache
  });

  it('reports rate limiting distinctly', async () => {
    const f = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }));
    const r = await new ClinVarClient(mkHttp(f), id, new TtlCache(), 60).searchVariants(braf, {});
    expect(r.status).toBe('rate_limited');
  });

  it('reports malformed responses instead of guessing', async () => {
    const f = vi.fn(async () => new Response('<html>oops</html>', { status: 200 }));
    const r = await new ClinVarClient(mkHttp(f), id, new TtlCache(), 60).searchVariants(braf, {});
    expect(r.status).toBe('unexpected_response');
  });

  it('returns no_results (not an error) for an empty search', async () => {
    const f = vi.fn(async () => jsonResponse({ esearchresult: { count: '0', idlist: [] } }));
    const r = await new ClinVarClient(mkHttp(f), id, new TtlCache(), 60).searchVariants(braf, {});
    expect(r.status).toBe('no_results');
  });

  it('never puts the NCBI API key in an error message', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    const r = await new ClinVarClient(mkHttp(f), { tool: 't', apiKey: 'SECRETKEY123' }, new TtlCache(), 60).searchVariants(braf, {});
    expect(JSON.stringify(r)).not.toContain('SECRETKEY123');
  });
});

describe('CIViC adapter', () => {
  const civicFetch = (body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => jsonResponse(body));

  it('queries codon-level first, then gene-level', () => {
    expect(buildCivicQueries(braf)).toEqual(['BRAF V600', 'BRAF']);
    expect(buildCivicQueries(parseVariantInput('V600E'))).toEqual([]);
  });

  it('parses evidence items, preserves classification fields, and drops other genes', async () => {
    const c = new CivicClient(mkHttp(civicFetch(CIVIC_RESPONSE)), new TtlCache(), 60);
    const r = await c.searchEvidence(braf, {});
    expect(r.status).toBe('ok');
    const ids = r.items.map((i) => i.sourceRecordId).sort();
    expect(ids).toEqual(['EID1409', 'EID2001']); // KRAS item discarded
    const e = r.items.find((i) => i.sourceRecordId === 'EID1409')!;
    expect(e).toMatchObject({
      evidenceLevel: 'A', evidenceType: 'PREDICTIVE', evidenceDirection: 'SUPPORTS', significance: 'SENSITIVITYRESPONSE',
      variantOrigin: 'SOMATIC', disease: 'Melanoma', therapies: ['Example-tinib'], pmids: ['22222222'],
      canonicalUrl: 'https://civicdb.org/evidence/1409', sourceUpdatedAt: '2024-02-03T10:00:00Z',
    });
    expect(r.limitations.join(' ')).toMatch(/not a treatment recommendation/);
  });

  it('treats GraphQL errors as an unexpected response, not as empty results', async () => {
    const c = new CivicClient(mkHttp(civicFetch({ errors: [{ message: 'Field does not exist' }] })), new TtlCache(), 60);
    const r = await c.searchEvidence(braf, {});
    expect(r.status).toBe('unexpected_response');
    expect(r.items).toEqual([]);
  });

  it('sends only the documented query variables and no secrets when no key is set', async () => {
    const f = civicFetch(CIVIC_RESPONSE);
    await new CivicClient(mkHttp(f), new TtlCache(), 60).searchEvidence(braf, {});
    const init = f.mock.calls[0]![1] as unknown as RequestInit;
    expect(JSON.parse(String(init.body)).variables).toMatchObject({ first: 40, status: 'ACCEPTED' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('PubMed adapter', () => {
  it('parses titles, authors, journal, date, DOI and structured abstracts', () => {
    const pubs = parsePubmedXml(PUBMED_XML, '2026-10-24T00:00:00Z');
    expect(pubs.map((p) => p.pmid)).toEqual(['22222222', '11111111']);
    const p = pubs[0]!;
    expect(p).toMatchObject({
      doi: '10.1000/test.2', journal: 'Journal of Test Oncology', publicationDate: '2020 Mar',
      canonicalUrl: 'https://pubmed.ncbi.nlm.nih.gov/22222222/',
    });
    expect(p.authors).toEqual(['Rivera A', 'Test Consortium']);
    expect(p.title).toContain('BRAF');
    expect(p.abstract).toContain('BACKGROUND: BRAF V600E is a hotspot.');
  });

  it('records a missing abstract as null instead of inventing one', () => {
    const p = parsePubmedXml(PUBMED_XML, 'x').find((x) => x.pmid === '11111111')!;
    expect(p.abstract).toBeNull();
    expect(p.doi).toBeNull();
    expect(p.publicationDate).toBe('2019 Jan-Feb');
  });

  it('builds a query from the submission and cancer context', () => {
    expect(buildPubMedTerm(braf, { cancerType: 'melanoma' })).toContain('BRAF[tiab] AND (V600E[tiab]');
    expect(buildPubMedTerm(braf, { cancerType: 'melanoma' })).toContain('"melanoma"[tiab]');
  });

  it('fetches and orders results by search relevance', async () => {
    const f = vi.fn(async (url: string) =>
      url.includes('esearch') ? jsonResponse(PUBMED_ESEARCH) : new Response(PUBMED_XML, { status: 200 }),
    );
    const r = await new PubMedClient(mkHttp(f), id, new TtlCache(), 60).searchPublications(braf, { cancerType: 'melanoma' });
    expect(r.status).toBe('ok');
    expect(r.items.map((p) => p.pmid)).toEqual(['11111111', '22222222']);
    expect(r.limitations.join(' ')).toMatch(/full articles were not reviewed/);
  });
});

describe('ClinicalTrials.gov adapter', () => {
  it('parses trial records and rejects entries without a valid NCT id', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => jsonResponse(TRIALS_RESPONSE));
    const r = await new ClinicalTrialsClient(mkHttp(f), new TtlCache(), 60).searchTrials(braf, { cancerType: 'melanoma' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      nctId: 'NCT01234567', status: 'RECRUITING', sourceUpdatedAt: '2026-09-01',
      canonicalUrl: 'https://clinicaltrials.gov/study/NCT01234567', interventions: ['Example-tinib (drug)'],
      locations: ['Test Hospital, Pune, India'],
    });
    expect(r.total).toBe(2);
    expect(r.limitations.join(' ')).toMatch(/does NOT establish that any patient is eligible/);
  });

  it('searches open and ongoing statuses by default and sends the condition filter', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => jsonResponse(TRIALS_RESPONSE));
    await new ClinicalTrialsClient(mkHttp(f), new TtlCache(), 60).searchTrials(braf, { cancerType: 'melanoma' });
    const url = new URL(String(f.mock.calls[0]![0]));
    expect(url.searchParams.get('query.cond')).toBe('melanoma');
    expect(url.searchParams.get('query.term')).toBe('BRAF V600E');
    expect(url.searchParams.get('filter.overallStatus')).toBe('RECRUITING,NOT_YET_RECRUITING,ENROLLING_BY_INVITATION,ACTIVE_NOT_RECRUITING');
  });

  it('ignores unknown status filters supplied by a caller', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => jsonResponse(TRIALS_RESPONSE));
    await new ClinicalTrialsClient(mkHttp(f), new TtlCache(), 60).searchTrials(braf, {}, { statuses: ['COMPLETED', 'DROP_TABLE'] });
    expect(new URL(String(f.mock.calls[0]![0])).searchParams.get('filter.overallStatus')).toBe('COMPLETED');
  });

  it('returns null for a study missing a title', () => {
    expect(toTrialRecord({ protocolSection: { identificationModule: { nctId: 'NCT00000001' } } }, 'x')).toBeNull();
  });
});

describe('HttpClient policy', () => {
  it('does not retry non-retryable 4xx responses', async () => {
    const f = vi.fn(async () => new Response('no', { status: 400 }));
    await expect(mkHttp(f).requestText('https://example.invalid')).rejects.toMatchObject({ status: 'unexpected_response' });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('recovers when a retry succeeds', async () => {
    let n = 0;
    const f = vi.fn(async () => (++n < 2 ? new Response('x', { status: 503 }) : new Response('ok', { status: 200 })));
    expect(await mkHttp(f).requestText('https://example.invalid')).toBe('ok');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('turns a network failure into an unavailable status', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(mkHttp(f).requestText('https://example.invalid')).rejects.toMatchObject({ status: 'unavailable' });
  });
});
