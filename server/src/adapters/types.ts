import type {
  EvidenceItem,
  ParsedVariant,
  PublicationRecord,
  SearchContext,
  TrialRecord,
  VariantRecord,
} from '../types/domain.js';

export type SourceName = 'clinvar' | 'civic' | 'pubmed' | 'clinicaltrials';

/**
 * Outcome of one source call. Failure is data, not an exception: one unavailable source
 * must never take down an investigation, and a failure is never replaced by invented results.
 */
export type SourceStatus = 'ok' | 'no_results' | 'unavailable' | 'rate_limited' | 'unexpected_response' | 'skipped';

export interface SourceResult<T> {
  source: SourceName;
  status: SourceStatus;
  items: T[];
  /** Total matches reported by the source (may exceed items.length). */
  total?: number;
  /** Safe, user-facing explanation for non-ok statuses. */
  message?: string;
  retrievedAt: string;
  fromCache: boolean;
  cacheExpiresAt?: string;
  /** The query actually sent, so a user can reproduce it at the source. */
  query: string;
  /** Source-specific caveats that must travel with the results. */
  limitations: string[];
}

/** SourceResult without its items; what is stored on a search result and shown in the UI. */
export type SourceResultMeta = Omit<SourceResult<unknown>, 'items'>;

export interface ClinVarAdapter {
  readonly name: 'clinvar';
  searchVariants(submitted: ParsedVariant, ctx: SearchContext, limit?: number): Promise<SourceResult<VariantRecord>>;
}

export interface CivicAdapter {
  readonly name: 'civic';
  /** Evidence items for a gene/variant. Each item names the molecular profile it belongs to. */
  searchEvidence(submitted: ParsedVariant, ctx: SearchContext, limit?: number): Promise<SourceResult<EvidenceItem>>;
}

export interface PubMedAdapter {
  readonly name: 'pubmed';
  searchPublications(submitted: ParsedVariant, ctx: SearchContext, limit?: number): Promise<SourceResult<PublicationRecord>>;
  searchByText(query: string, limit?: number): Promise<SourceResult<PublicationRecord>>;
}

export interface TrialsAdapter {
  readonly name: 'clinicaltrials';
  searchTrials(
    submitted: ParsedVariant,
    ctx: SearchContext,
    options?: { statuses?: string[]; limit?: number },
  ): Promise<SourceResult<TrialRecord>>;
}

/** Everything the orchestrator needs; swap any member (or inject fakes in tests) without other changes. */
export interface SourceBundle {
  clinvar: ClinVarAdapter;
  civic: CivicAdapter;
  pubmed: PubMedAdapter;
  trials: TrialsAdapter;
}
