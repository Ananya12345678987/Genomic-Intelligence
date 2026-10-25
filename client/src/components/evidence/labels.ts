import type { MatchCategory, SourceClassification, SourceMeta } from '../../types/research';

export const CATEGORY_LABEL: Record<MatchCategory, string> = {
  exact_normalized: 'Exact normalized match',
  equivalent_representation: 'Equivalent representation',
  same_position_different_allele: 'Same position, different allele',
  same_gene_different_variant: 'Same gene, different variant',
  related_biomarker: 'Related biomarker',
  literature_only: 'Literature-only association',
  unresolved: 'Unresolved or ambiguous',
  gene_level_result: 'Gene-level result',
};

/** One-line plain-language meaning, shown under the label so categories are never mistaken for each other. */
export const CATEGORY_HELP: Record<MatchCategory, string> = {
  exact_normalized: 'Matched by a shared identifier or identical normalized coordinates.',
  equivalent_representation: 'Same change written differently; check the basis before treating it as identical.',
  same_position_different_allele: 'Same location, but a different change. A different variant.',
  same_gene_different_variant: 'Same gene only. Says nothing about your specific variant.',
  related_biomarker: 'A related alteration or biomarker, not the submitted variant.',
  literature_only: 'Appears in publications only; no matching database record.',
  unresolved: 'Could not be compared reliably.',
  gene_level_result: 'You searched a gene only, so there is no variant to compare.',
};

export const SCOPE_LABEL: Record<SourceClassification['scope'], string> = {
  germline_pathogenicity: 'Germline pathogenicity',
  somatic_clinical_impact: 'Somatic clinical impact',
  somatic_oncogenicity: 'Oncogenicity',
  curated_evidence: 'Curated evidence',
  other: 'Classification',
};

export const SOURCE_LABEL: Record<string, string> = {
  clinvar: 'ClinVar',
  civic: 'CIViC',
  pubmed: 'PubMed',
  clinicaltrials: 'ClinicalTrials.gov',
};

export const STATUS_LABEL: Record<SourceMeta['status'], string> = {
  ok: 'Searched',
  no_results: 'No results',
  unavailable: 'Unavailable',
  rate_limited: 'Rate limited',
  unexpected_response: 'Unexpected response',
  skipped: 'Not searched',
};

export const NORMALIZATION_LABEL: Record<string, string> = {
  genomic_coordinates: 'Genomic coordinates',
  coding_hgvs: 'Coding HGVS',
  protein_change: 'Protein change only',
  identifier_only: 'Identifier only',
  gene_only: 'Gene only',
  ambiguous: 'Ambiguous',
  unresolved: 'Unresolved',
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'not stated';
  const d = new Date(iso.includes('/') ? iso.replace(/\//g, '-') : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Only http(s) URLs from retrieved records are ever rendered as links. */
export const safeUrl = (u: string | null | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);
