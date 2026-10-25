import type { SourceResult, TrialsAdapter } from '../types.js';
import type { ParsedVariant, SearchContext, TrialRecord } from '../../types/domain.js';
import { HttpClient } from '../shared/http.js';
import { TtlCache } from '../shared/cache.js';
import { runSource } from '../shared/run.js';
import { toOneLetter } from '../../services/variant-normalization/aminoAcids.js';

/**
 * ClinicalTrials.gov API v2: GET https://clinicaltrials.gov/api/v2/studies
 *
 * Parameters used: query.cond, query.term, filter.overallStatus (comma-separated), pageSize.
 * Field paths used (protocolSection.identificationModule / statusModule / conditionsModule /
 * armsInterventionsModule / eligibilityModule / contactsLocationsModule) follow the API v2
 * study structure. ClinicalTrials.gov blocks automated documentation fetching and this build
 * environment cannot reach the API, so these paths were NOT verified against a live response.
 * Parsing is defensive; a response without the expected shape is reported, not guessed at.
 */

const BASE = 'https://clinicaltrials.gov/api/v2/studies';

/** Statuses searched by default: trials that are open or still running. */
export const DEFAULT_TRIAL_STATUSES = ['RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION', 'ACTIVE_NOT_RECRUITING'];
export const ALL_TRIAL_STATUSES = [
  ...DEFAULT_TRIAL_STATUSES,
  'SUSPENDED', 'TERMINATED', 'COMPLETED', 'WITHDRAWN', 'UNKNOWN',
];

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function buildTrialQuery(v: ParsedVariant, ctx: SearchContext): { cond: string; term: string } | null {
  if (!v.geneSymbol) return null;
  const p = v.protein;
  let term = v.geneSymbol;
  if (p?.kind === 'substitution' && p.ref && p.alt && p.position !== null) {
    term += ` ${toOneLetter(p.ref) ?? ''}${p.position}${p.alt === 'Ter' ? '*' : (toOneLetter(p.alt) ?? '')}`;
  }
  return { cond: ctx.cancerType?.trim() || 'cancer', term };
}

export function toTrialRecord(study: unknown, retrievedAt: string): TrialRecord | null {
  const proto = obj(obj(study).protocolSection);
  const ident = obj(proto.identificationModule);
  const nctId = str(ident.nctId);
  if (!nctId || !/^NCT\d{8}$/.test(nctId)) return null;
  const status = obj(proto.statusModule);
  const interventions = arr(obj(proto.armsInterventionsModule).interventions)
    .map((i) => {
      const io = obj(i);
      const name = str(io.name);
      const type = str(io.type);
      return name ? (type ? `${name} (${type.toLowerCase()})` : name) : null;
    })
    .filter((x): x is string => !!x);
  const criteria = str(obj(proto.eligibilityModule).eligibilityCriteria);
  const locations = arr(obj(proto.contactsLocationsModule).locations)
    .slice(0, 8)
    .map((l) => {
      const lo = obj(l);
      return [str(lo.facility), str(lo.city), str(lo.country)].filter(Boolean).join(', ');
    })
    .filter(Boolean);
  const title = str(ident.officialTitle) ?? str(ident.briefTitle);
  if (!title) return null;
  return {
    source: 'clinicaltrials',
    nctId,
    title,
    briefTitle: str(ident.briefTitle),
    conditions: arr(obj(proto.conditionsModule).conditions).filter((c): c is string => typeof c === 'string'),
    interventions,
    status: str(status.overallStatus),
    eligibilitySummary: criteria ? (criteria.length > 700 ? `${criteria.slice(0, 700)}… (truncated; see the official record)` : criteria) : null,
    locations,
    sourceUpdatedAt: str(obj(status.lastUpdatePostDateStruct).date),
    canonicalUrl: `https://clinicaltrials.gov/study/${nctId}`,
    retrievedAt,
  };
}

export class ClinicalTrialsClient implements TrialsAdapter {
  readonly name = 'clinicaltrials' as const;
  constructor(
    private readonly http: HttpClient,
    private readonly cache: TtlCache<SourceResult<TrialRecord>>,
    private readonly ttlSeconds: number,
  ) {}

  searchTrials(
    submitted: ParsedVariant,
    ctx: SearchContext,
    options: { statuses?: string[]; limit?: number } = {},
  ): Promise<SourceResult<TrialRecord>> {
    const q = buildTrialQuery(submitted, ctx);
    if (!q) {
      return Promise.resolve({
        source: 'clinicaltrials', status: 'skipped', items: [], message: 'A gene symbol is needed to search trials.',
        retrievedAt: new Date().toISOString(), fromCache: false, query: '', limitations: [],
      });
    }
    const limit = Math.min(options.limit ?? 10, 25);
    const statuses = (options.statuses?.length ? options.statuses : DEFAULT_TRIAL_STATUSES).filter((s) => ALL_TRIAL_STATUSES.includes(s));
    const params = new URLSearchParams({
      'query.cond': q.cond,
      'query.term': q.term,
      'filter.overallStatus': statuses.join(','),
      pageSize: String(limit),
      countTotal: 'true',
      format: 'json',
    });
    const queryText = `cond="${q.cond}" term="${q.term}" status=${statuses.join(',')}`;
    return runSource<TrialRecord>(
      {
        source: 'clinicaltrials',
        query: queryText,
        limitations: [
          `Statuses searched: ${statuses.join(', ')}. Trial status changes often; check the official record.`,
          'Trials are found by text search. A shared gene, variant or cancer type does NOT establish that any patient is eligible.',
        ],
        cache: this.cache,
        cacheKey: `trials:${limit}:${queryText}`,
        ttlSeconds: this.ttlSeconds,
      },
      async () => {
        const body = obj(await this.http.requestJson(`${BASE}?${params.toString()}`));
        const retrievedAt = new Date().toISOString();
        const items = arr(body.studies)
          .map((s) => toTrialRecord(s, retrievedAt))
          .filter((t): t is TrialRecord => t !== null);
        return { items, total: Number(body.totalCount ?? items.length) };
      },
    );
  }
}
