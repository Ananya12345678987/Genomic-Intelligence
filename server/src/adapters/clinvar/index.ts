import type { ClinVarAdapter, SourceResult } from '../types.js';
import type { ParsedVariant, SearchContext, SourceClassification, VariantRecord } from '../../types/domain.js';
import { HttpClient, SourceError } from '../shared/http.js';
import { TtlCache } from '../shared/cache.js';
import { runSource } from '../shared/run.js';
import { assemblyFromAccession, parseRecordName } from '../../services/variant-normalization/index.js';
import { toOneLetter } from '../../services/variant-normalization/aminoAcids.js';

/**
 * ClinVar via NCBI E-utilities (esearch + esummary, JSON).
 *
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25497/ (usage policy and utilities).
 * Key paths in esummary (accession, title, genes, variation_set, germline_classification,
 * clinical_impact_classification, oncogenicity_classification) were cross-checked against
 * secondary sources, NOT against a live response (NCBI blocks automated doc fetching and this
 * build environment cannot reach NCBI). Parsing is therefore defensive, and a response that
 * does not fit is reported as `unexpected_response` instead of being guessed at.
 */

export interface NcbiIdentity {
  apiKey?: string;
  tool: string;
  email?: string;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export function ncbiParams(id: NcbiIdentity, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, tool: id.tool });
  if (id.email) q.set('email', id.email);
  if (id.apiKey) q.set('api_key', id.apiKey);
  return q.toString();
}

/** Build the ClinVar search term from what was actually submitted. */
export function buildClinVarTerm(v: ParsedVariant): string | null {
  if (!v.geneSymbol && !v.rsId) return null;
  const parts: string[] = [];
  if (v.geneSymbol) parts.push(`${v.geneSymbol}[gene]`);
  const p = v.protein;
  if (p?.kind === 'substitution' && p.ref && p.alt && p.position !== null) {
    const one = `${toOneLetter(p.ref) ?? ''}${p.position}${p.alt === 'Ter' ? '*' : (toOneLetter(p.alt) ?? '')}`;
    parts.push(`(${one} OR ${p.ref}${p.position}${p.alt})`);
  } else if (v.hgvsCoding && v.transcriptId) {
    parts.push(`"${v.transcriptId}:${v.hgvsCoding}"`);
  } else if (v.rsId) {
    parts.push(v.rsId);
  }
  return parts.join(' AND ');
}

function classification(
  raw: unknown,
  scope: SourceClassification['scope'],
  scopeNote: string,
): SourceClassification | null {
  const o = obj(raw);
  const label = str(o.description);
  if (!label) return null;
  const traits = arr(o.trait_set)
    .map((t) => str(obj(t).trait_name))
    .filter((t): t is string => !!t);
  return {
    label,
    scope,
    scopeNote,
    reviewStatus: str(o.review_status),
    lastEvaluated: str(o.last_evaluated),
    conditions: traits,
  };
}

/** Convert one esummary document into a VariantRecord. Returns null if it lacks a usable identity. */
export function toVariantRecord(uid: string, doc: unknown, retrievedAt: string): VariantRecord | null {
  const d = obj(doc);
  const title = str(d.title);
  if (!title) return null;
  const accession = str(d.accession);
  const gene = str(obj(arr(d.genes)[0]).symbol)?.toUpperCase() ?? null;

  const { parsed, specificity } = parseRecordName(title, gene);

  const varSet = obj(arr(d.variation_set)[0]);
  let rsId: string | null = null;
  for (const x of arr(varSet.variation_xrefs)) {
    const xo = obj(x);
    if (str(xo.db_source)?.toLowerCase() === 'dbsnp' && str(xo.db_id)) rsId = `rs${str(xo.db_id)}`;
  }
  if (rsId) parsed.rsId = rsId;

  // SPDI (0-based) such as "NC_000007.14:140753335:T:A" gives exact genomic coordinates when present.
  const spdi = /^NC_(\d{6})\.(\d+):(\d+):([ACGT]):([ACGT])$/.exec(str(varSet.canonical_spdi) ?? '');
  if (spdi) {
    const asm = assemblyFromAccession(Number(spdi[1]), Number(spdi[2]));
    if (asm) {
      parsed.chromosome = asm.chromosome;
      parsed.referenceGenome = asm.assembly;
      parsed.position = Number(spdi[3]) + 1;
      parsed.referenceAllele = spdi[4]!;
      parsed.alternateAllele = spdi[5]!;
      parsed.hgvsGenomic = `NC_${spdi[1]}.${spdi[2]}:g.${parsed.position}${spdi[4]}>${spdi[5]}`;
    }
  }

  const classifications: SourceClassification[] = [
    classification(
      d.germline_classification ?? d.clinical_significance,
      'germline_pathogenicity',
      'Germline classification: describes pathogenicity for inherited conditions. It is not a statement about tumor behaviour or cancer treatment.',
    ),
    classification(
      d.clinical_impact_classification,
      'somatic_clinical_impact',
      'Somatic clinical-impact classification: describes clinical significance of a somatic variant in a specific tumor context. It is not a germline pathogenicity classification.',
    ),
    classification(
      d.oncogenicity_classification,
      'somatic_oncogenicity',
      'Oncogenicity classification: describes whether the variant is considered oncogenic. It is not a treatment-actionability statement.',
    ),
  ].filter((c): c is SourceClassification => c !== null);

  const url = `https://www.ncbi.nlm.nih.gov/clinvar/variation/${uid}/`;
  return {
    ref: {
      source: 'clinvar',
      sourceRecordId: accession ?? `VarID:${uid}`,
      canonicalUrl: url,
      geneSymbol: gene,
      displayName: title,
      parsed,
      specificity,
      identifiers: {
        clinvarVariationId: uid,
        ...(accession ? { clinvarAccession: accession } : {}),
        ...(rsId ? { rsId } : {}),
      },
    },
    classifications,
    sourceUpdatedAt: null,
    retrievedAt,
    limitations: [
      'ClinVar aggregates submitted interpretations. Review status varies, and not every classification is expert-reviewed.',
      'A classification applies to the condition and context stated by the submitters, not to every cancer type.',
    ],
  };
}

export class ClinVarClient implements ClinVarAdapter {
  readonly name = 'clinvar' as const;
  constructor(
    private readonly http: HttpClient,
    private readonly id: NcbiIdentity,
    private readonly cache: TtlCache<SourceResult<VariantRecord>>,
    private readonly ttlSeconds: number,
  ) {}

  async searchVariants(submitted: ParsedVariant, _ctx: SearchContext, limit = 20): Promise<SourceResult<VariantRecord>> {
    const term = buildClinVarTerm(submitted);
    if (!term) {
      return {
        source: 'clinvar', status: 'skipped', items: [], message: 'A gene or rsID is needed to search ClinVar.',
        retrievedAt: new Date().toISOString(), fromCache: false, query: '', limitations: [],
      };
    }
    return runSource<VariantRecord>(
      {
        source: 'clinvar',
        query: term,
        limitations: ['Only the first results returned by ClinVar are shown; the database may contain more matching records.'],
        cache: this.cache,
        cacheKey: `clinvar:${limit}:${term}`,
        ttlSeconds: this.ttlSeconds,
      },
      async () => {
        const search = obj(
          await this.http.requestJson(
            `${BASE}/esearch.fcgi?${ncbiParams(this.id, { db: 'clinvar', term, retmode: 'json', retmax: String(limit) })}`,
          ),
        );
        const result = obj(search.esearchresult);
        const ids = arr(result.idlist).map(String);
        const total = Number(result.count ?? ids.length);
        if (!ids.length) return { items: [], total: 0 };

        const summary = obj(
          await this.http.requestJson(
            `${BASE}/esummary.fcgi?${ncbiParams(this.id, { db: 'clinvar', id: ids.join(','), retmode: 'json' })}`,
          ),
        );
        const res = obj(summary.result);
        if (!Object.keys(res).length) throw new SourceError('unexpected_response', 'ClinVar returned an unrecognized summary format.');
        const retrievedAt = new Date().toISOString();
        const items = ids
          .map((uid) => toVariantRecord(uid, res[uid], retrievedAt))
          .filter((r): r is VariantRecord => r !== null);
        return { items, total };
      },
    );
  }
}
