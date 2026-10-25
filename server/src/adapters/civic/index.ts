import type { CivicAdapter, SourceResult } from '../types.js';
import type { EvidenceItem, ParsedVariant, SearchContext } from '../../types/domain.js';
import { HttpClient, SourceError } from '../shared/http.js';
import { TtlCache } from '../shared/cache.js';
import { runSource } from '../shared/run.js';
import { toOneLetter } from '../../services/variant-normalization/aminoAcids.js';

/**
 * CIViC via its GraphQL API (v2). The old REST API is retired.
 *
 * Endpoint: https://civicdb.org/api/graphql. Field and argument names below were checked
 * against the CIViC server schema (griffithlab/civic-v2, server.model.graphql, commit 1f9c4b9,
 * 2026-10-17): evidenceItems(molecularProfileName, status: EvidenceStatusFilter, first) and
 * EvidenceItem { id name status evidenceLevel evidenceType evidenceDirection significance
 * variantOrigin description disease{name} therapies{name} source{...} molecularProfile{id name}
 * lastAcceptedRevisionEvent{createdAt} }. They were NOT exercised against the live endpoint
 * from this build environment.
 *
 * Licence: CIViC content is CC0. CIViC states its content is intended for research use only.
 * Anonymous access is rate-limited (documented as 3 requests/second); an API key is optional.
 */

const ENDPOINT = 'https://civicdb.org/api/graphql';

const QUERY = `
query CgiEvidence($name: String, $first: Int, $status: EvidenceStatusFilter) {
  evidenceItems(molecularProfileName: $name, status: $status, first: $first) {
    totalCount
    nodes {
      id
      name
      status
      evidenceLevel
      evidenceType
      evidenceDirection
      significance
      variantOrigin
      description
      disease { name }
      therapies { name }
      source { citation citationId sourceType }
      molecularProfile { id name }
      lastAcceptedRevisionEvent { createdAt }
    }
  }
}`;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/** Profile-name queries sent to CIViC for a submission: codon-level first, then gene-level. */
export function buildCivicQueries(v: ParsedVariant): string[] {
  if (!v.geneSymbol) return [];
  const queries: string[] = [];
  const p = v.protein;
  if (p?.kind === 'substitution' && p.ref && p.position !== null) {
    const refOne = toOneLetter(p.ref);
    if (refOne) queries.push(`${v.geneSymbol} ${refOne}${p.position}`);
  }
  queries.push(v.geneSymbol);
  return queries;
}

export function toEvidenceItem(node: unknown, retrievedAt: string): EvidenceItem | null {
  const n = obj(node);
  const id = str(n.id);
  if (!id) return null;
  const mp = obj(n.molecularProfile);
  const profileName = str(mp.name);
  const source = obj(n.source);
  const sourceType = str(source.sourceType);
  const citationId = str(source.citationId);
  const description = str(n.description) ?? '';
  return {
    source: 'civic',
    sourceRecordId: str(n.name) ?? `EID${id}`,
    canonicalUrl: `https://civicdb.org/evidence/${id}`,
    geneSymbol: profileName ? (profileName.split(/\s+/)[0]?.toUpperCase() ?? null) : null,
    molecularProfileName: profileName,
    molecularProfileId: str(mp.id),
    evidenceType: str(n.evidenceType),
    evidenceLevel: str(n.evidenceLevel),
    evidenceDirection: str(n.evidenceDirection),
    significance: str(n.significance),
    variantOrigin: str(n.variantOrigin),
    disease: str(obj(n.disease).name),
    therapies: arr(n.therapies).map((t) => str(obj(t).name)).filter((t): t is string => !!t),
    claimSummary: description.length > 1500 ? `${description.slice(0, 1500)}…` : description,
    pmids: sourceType === 'PUBMED' && citationId ? [citationId] : [],
    citation: str(source.citation),
    status: str(n.status),
    sourceUpdatedAt: str(obj(n.lastAcceptedRevisionEvent).createdAt),
    retrievedAt,
  };
}

export class CivicClient implements CivicAdapter {
  readonly name = 'civic' as const;
  constructor(
    private readonly http: HttpClient,
    private readonly cache: TtlCache<SourceResult<EvidenceItem>>,
    private readonly ttlSeconds: number,
    private readonly apiKey?: string,
  ) {}

  async searchEvidence(submitted: ParsedVariant, _ctx: SearchContext, limit = 40): Promise<SourceResult<EvidenceItem>> {
    const queries = buildCivicQueries(submitted);
    if (!queries.length) {
      return {
        source: 'civic', status: 'skipped', items: [], message: 'A gene symbol is needed to search CIViC.',
        retrievedAt: new Date().toISOString(), fromCache: false, query: '', limitations: [],
      };
    }
    const label = queries.join(' | ');
    return runSource<EvidenceItem>(
      {
        source: 'civic',
        query: `evidenceItems(molecularProfileName in [${label}], status: ACCEPTED)`,
        limitations: [
          'Only accepted CIViC evidence items are retrieved. Submitted or rejected items are excluded.',
          'CIViC evidence describes curated statements from publications. It is not a treatment recommendation for any individual patient.',
          'CIViC states that its content is intended for research use only.',
        ],
        cache: this.cache,
        cacheKey: `civic:${limit}:${label}`,
        ttlSeconds: this.ttlSeconds,
      },
      async () => {
        const seen = new Map<string, EvidenceItem>();
        let total = 0;
        const retrievedAt = new Date().toISOString();
        for (const name of queries) {
          const body = obj(
            await this.http.requestJson(ENDPOINT, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
              },
              body: JSON.stringify({ query: QUERY, variables: { name, first: limit, status: 'ACCEPTED' } }),
            }),
          );
          const errors = arr(body.errors);
          if (errors.length) {
            // GraphQL errors usually mean the schema changed; do not guess at a partial answer.
            throw new SourceError('unexpected_response', 'CIViC rejected the query (its schema may have changed).');
          }
          const conn = obj(obj(body.data).evidenceItems);
          total = Math.max(total, Number(conn.totalCount ?? 0));
          for (const node of arr(conn.nodes)) {
            const item = toEvidenceItem(node, retrievedAt);
            if (!item) continue;
            // Keep only items whose profile actually involves the submitted gene.
            if (submitted.geneSymbol && item.molecularProfileName) {
              const tokens = item.molecularProfileName.toUpperCase().split(/[\s,()]+/);
              if (!tokens.includes(submitted.geneSymbol)) continue;
            }
            seen.set(item.sourceRecordId, item);
          }
        }
        return { items: [...seen.values()], total };
      },
    );
  }
}
