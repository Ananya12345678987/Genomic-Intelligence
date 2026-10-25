import { randomUUID } from 'node:crypto';
import type { SourceBundle, SourceResult, SourceResultMeta } from '../../adapters/types.js';
import type {
  EvidenceItem,
  MatchedFinding,
  ParsedVariant,
  PublicationRecord,
  SearchContext,
  SearchResult,
  SourceVariantRef,
  TrialRecord,
  VariantRecord,
} from '../../types/domain.js';
import { parseRecordName } from '../variant-normalization/index.js';
import { CATEGORY_ORDER, assessFinding, classifyMatch } from '../matching/index.js';

export interface SearchOptions {
  includeTrials?: boolean;
  includePublications?: boolean;
  trialStatuses?: string[];
}

function meta<T>(r: SourceResult<T>): SourceResultMeta {
  const { items: _items, ...rest } = r;
  return rest;
}

/** A source adapter that throws unexpectedly is reported as unavailable; it never breaks the search. */
async function safely<T>(source: SourceResult<T>['source'], query: string, run: () => Promise<SourceResult<T>>): Promise<SourceResult<T>> {
  try {
    return await run();
  } catch {
    return {
      source,
      status: 'unavailable',
      items: [],
      message: 'This source could not be queried.',
      retrievedAt: new Date().toISOString(),
      fromCache: false,
      query,
      limitations: [],
    };
  }
}

const COMPLEX_PROFILE = /\b(AND|OR)\b|\+/;

/** Build a comparable variant ref + record from a CIViC molecular profile and its evidence. */
export function civicProfileToRecord(profileId: string, profileName: string, items: EvidenceItem[]): VariantRecord {
  const gene = (profileName.split(/\s+/)[0] ?? '').toUpperCase() || null;
  const variantName = profileName.split(/\s+/).slice(1).join(' ') || profileName;
  const { parsed, specificity } = parseRecordName(variantName, gene);
  const complex = COMPLEX_PROFILE.test(profileName);
  const first = items[0]!;
  return {
    ref: {
      source: 'civic',
      sourceRecordId: `MP${profileId}`,
      canonicalUrl: `https://civicdb.org/molecular-profiles/${profileId}`,
      geneSymbol: gene,
      displayName: profileName,
      parsed,
      specificity: complex ? 'nonspecific' : specificity,
      identifiers: { civicProfileId: profileId },
    },
    classifications: [],
    sourceUpdatedAt: items.map((i) => i.sourceUpdatedAt).filter((d): d is string => !!d).sort().pop() ?? null,
    retrievedAt: first.retrievedAt,
    limitations: [
      'CIViC groups evidence by molecular profile. Each evidence item is a curated statement from one publication.',
      ...(complex ? ['This is a combination (complex) profile; its evidence concerns the combination, not any single component alone.'] : []),
    ],
  };
}

function rankKey(f: MatchedFinding): [number, number, string] {
  return [CATEGORY_ORDER[f.decision.category], -(f.record.classifications.length + f.evidence.length), f.record.ref.source];
}

/**
 * Structured retrieval first: query the sources in parallel, then compare every returned record
 * to the submission with the deterministic classifier. Retrieval imprecision is therefore harmless:
 * a record that does not truly match is classified as a weaker category or discarded.
 */
export async function searchEvidence(
  sources: SourceBundle,
  submitted: ParsedVariant,
  ctx: SearchContext,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const retrievedAt = new Date().toISOString();
  const skip = <T>(source: SourceResult<T>['source'], message: string): Promise<SourceResult<T>> =>
    Promise.resolve({ source, status: 'skipped', items: [], message, retrievedAt, fromCache: false, query: '', limitations: [] });

  const [clinvar, civic, pubmed, trials] = await Promise.all([
    safely('clinvar', '', () => sources.clinvar.searchVariants(submitted, ctx)),
    safely('civic', '', () => sources.civic.searchEvidence(submitted, ctx)),
    options.includePublications === false
      ? skip<PublicationRecord>('pubmed', 'Publication search was not requested.')
      : safely('pubmed', '', () => sources.pubmed.searchPublications(submitted, ctx)),
    options.includeTrials === false
      ? skip<TrialRecord>('clinicaltrials', 'Clinical-trial search was not requested.')
      : safely('clinicaltrials', '', () => sources.trials.searchTrials(submitted, ctx, { statuses: options.trialStatuses })),
  ]);

  // Candidate variant records: ClinVar records directly, CIViC grouped by molecular profile.
  const byProfile = new Map<string, { name: string; items: EvidenceItem[] }>();
  for (const e of civic.items) {
    if (!e.molecularProfileId || !e.molecularProfileName) continue;
    const g = byProfile.get(e.molecularProfileId) ?? { name: e.molecularProfileName, items: [] };
    g.items.push(e);
    byProfile.set(e.molecularProfileId, g);
  }
  const candidates: { record: VariantRecord; evidence: EvidenceItem[] }[] = [
    ...clinvar.items.map((record) => ({ record, evidence: [] as EvidenceItem[] })),
    ...[...byProfile.entries()].map(([id, g]) => ({ record: civicProfileToRecord(id, g.name, g.items), evidence: g.items })),
  ];

  let discarded = 0;
  const findings: MatchedFinding[] = [];
  for (const c of candidates) {
    const decision = classifyMatch(submitted, c.record.ref as SourceVariantRef);
    if (!decision) {
      discarded++;
      continue;
    }
    findings.push({
      id: `${c.record.ref.source}:${c.record.ref.sourceRecordId}`,
      decision,
      record: c.record,
      evidence: c.evidence,
      assessment: assessFinding(submitted, decision, c.record, c.evidence),
    });
  }
  findings.sort((a, b) => {
    const ka = rankKey(a);
    const kb = rankKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });

  // Publications: unique by PMID.
  const seen = new Set<string>();
  const publications = pubmed.items.filter((p) => (seen.has(p.pmid) ? false : (seen.add(p.pmid), true)));

  const statuses = [meta(clinvar), meta(civic), meta(pubmed), meta(trials)];
  const notices = buildNotices(submitted, findings, statuses);

  return {
    submitted,
    context: ctx,
    findings,
    publications,
    trials: trials.items,
    sourceStatuses: statuses,
    discardedCount: discarded,
    notices,
    retrievedAt,
  };
}

function buildNotices(submitted: ParsedVariant, findings: MatchedFinding[], statuses: SourceResultMeta[]): string[] {
  const notices: string[] = [];
  const exact = findings.some((f) => f.decision.category === 'exact_normalized');
  const anyVariantLevel = submitted.normalizationStatus !== 'gene_only';

  if (anyVariantLevel && !exact) {
    const hints: string[] = [];
    if (!submitted.transcriptId) hints.push('a transcript accession with version (e.g. NM_004333.6)');
    if (!submitted.referenceGenome) hints.push('the reference genome (GRCh37 or GRCh38)');
    if (submitted.position === null) hints.push('genomic coordinates with alleles');
    notices.push(
      findings.length
        ? 'No exact normalized match was found in the sources queried. The results below are weaker matches and are labelled by how they differ from your submission.'
        : 'No matching records were found in the sources queried. This does not mean none exist in other sources or newer data.',
    );
    if (hints.length) notices.push(`Providing ${hints.join(', ')} could improve matching.`);
  }
  if (submitted.normalizationStatus === 'unresolved' || submitted.normalizationStatus === 'ambiguous') {
    notices.push('The submitted finding could not be normalized to a comparable level, so variant-level comparison was not possible.');
  }
  for (const s of statuses) {
    if (s.status === 'unavailable' || s.status === 'rate_limited' || s.status === 'unexpected_response') {
      notices.push(`${sourceLabel(s.source)} could not be searched (${s.status.replace('_', ' ')}): ${s.message ?? 'no details'}. Results from this source are missing, not empty.`);
    }
  }
  notices.push(
    'The somatic or germline origin of the submitted finding is not known. A finding in tumor tissue alone does not establish inherited risk.',
  );
  return notices;
}

export const sourceLabel = (s: string) =>
  ({ clinvar: 'ClinVar', civic: 'CIViC', pubmed: 'PubMed', clinicaltrials: 'ClinicalTrials.gov' })[s] ?? s;

export const newResultId = () => randomUUID();
