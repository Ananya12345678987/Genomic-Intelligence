/** Shared domain types for normalization, matching, source records and results. */

import type { SourceName, SourceResultMeta } from '../adapters/types.js';
export type { SourceName };
export type ReferenceGenome = 'GRCh37' | 'GRCh38';

/**
 * Most specific level of information that was validated *syntactically*.
 * Nothing here is verified against a reference sequence or transcript database.
 */
export type NormalizationStatus =
  | 'genomic_coordinates'
  | 'coding_hgvs'
  | 'protein_change'
  | 'identifier_only'
  | 'gene_only'
  | 'ambiguous'
  | 'unresolved';

export interface ProteinChange {
  kind: 'substitution' | 'codon_level' | 'other';
  /** Three-letter amino-acid codes (e.g. Val, Glu, Ter). Null for non-substitutions. */
  ref: string | null;
  position: number | null;
  alt: string | null;
  raw: string;
}

export interface ParsedVariant {
  sourceRepresentation: string;
  geneSymbol: string | null;
  /** True only when the symbol is in the built-in oncology gene list (not a full HGNC check). */
  geneRecognized: boolean;
  hgvsGenomic: string | null;
  hgvsCoding: string | null;
  hgvsProtein: string | null;
  referenceGenome: ReferenceGenome | null;
  transcriptId: string | null;
  chromosome: string | null;
  position: number | null;
  referenceAllele: string | null;
  alternateAllele: string | null;
  rsId: string | null;
  protein: ProteinChange | null;
  normalizationStatus: NormalizationStatus;
  warnings: string[];
  /** Fields the user could supply to improve reliability. */
  missing: string[];
}

export interface ParseContext {
  geneSymbol?: string | null;
  referenceGenome?: ReferenceGenome | null;
  transcriptId?: string | null;
}

export type MatchCategory =
  | 'exact_normalized'
  | 'equivalent_representation'
  | 'same_position_different_allele'
  | 'same_gene_different_variant'
  | 'related_biomarker'
  | 'literature_only'
  | 'unresolved'
  /** Extension: used when the user searched a gene only, so no variant comparison exists. */
  | 'gene_level_result';

export interface MatchDecision {
  category: MatchCategory;
  rationale: string;
  matchingFields: string[];
  differingFields: string[];
  /** Plain-language note on what level the match was established at. */
  basis: 'identifier' | 'genomic' | 'coding_transcript' | 'protein_notation' | 'protein_position' | 'gene' | 'none';
}

/** A variant as described by a source record, normalized for comparison. */
export interface SourceVariantRef {
  source: SourceName;
  sourceRecordId: string;
  canonicalUrl: string;
  geneSymbol: string | null;
  /** The source's own display name, e.g. "NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)" or "V600E". */
  displayName: string;
  parsed: ParsedVariant | null;
  specificity: 'specific' | 'codon_level' | 'nonspecific';
  identifiers: { clinvarVariationId?: string; clinvarAccession?: string; civicVariantId?: string; civicProfileId?: string; rsId?: string };
}

export interface SourceClassification {
  /** e.g. "Pathogenic", "Likely oncogenic", "Level B / Predictive / Supports". */
  label: string;
  /** What this classification is about; classifications are never interchangeable. */
  scope: 'germline_pathogenicity' | 'somatic_clinical_impact' | 'somatic_oncogenicity' | 'curated_evidence' | 'other';
  scopeNote: string;
  reviewStatus?: string | null;
  lastEvaluated?: string | null;
  conditions?: string[];
}

export interface VariantRecord {
  ref: SourceVariantRef;
  classifications: SourceClassification[];
  sourceUpdatedAt: string | null;
  retrievedAt: string;
  limitations: string[];
}

export interface EvidenceItem {
  source: 'civic';
  sourceRecordId: string;
  canonicalUrl: string;
  geneSymbol: string | null;
  molecularProfileName: string | null;
  molecularProfileId: string | null;
  evidenceType: string | null;
  evidenceLevel: string | null;
  evidenceDirection: string | null;
  significance: string | null;
  /** SOMATIC, RARE_GERMLINE, COMMON_GERMLINE, COMBINED, MIXED, NA or UNKNOWN as reported by CIViC. */
  variantOrigin: string | null;
  disease: string | null;
  therapies: string[];
  claimSummary: string;
  pmids: string[];
  citation: string | null;
  status: string | null;
  sourceUpdatedAt: string | null;
  retrievedAt: string;
}

export interface PublicationRecord {
  source: 'pubmed';
  pmid: string;
  doi: string | null;
  title: string;
  authors: string[];
  journal: string | null;
  publicationDate: string | null;
  abstract: string | null;
  canonicalUrl: string;
  retrievedAt: string;
}

export interface TrialRecord {
  source: 'clinicaltrials';
  nctId: string;
  title: string;
  briefTitle: string | null;
  conditions: string[];
  interventions: string[];
  status: string | null;
  eligibilitySummary: string | null;
  locations: string[];
  sourceUpdatedAt: string | null;
  canonicalUrl: string;
  retrievedAt: string;
}

export interface MatchAssessment {
  matchConfidence: { level: 'identifier' | 'notation' | 'position' | 'gene' | 'none'; explanation: string };
  evidenceStrength: { items: { label: string; scope: SourceClassification['scope'] | 'evidence_level'; note: string }[]; note: string };
  clinicalRelevance: { statements: string[]; note: string };
  evidenceCompleteness: { missing: string[]; note: string };
}

export interface MatchedFinding {
  id: string;
  decision: MatchDecision;
  record: VariantRecord;
  evidence: EvidenceItem[];
  assessment: MatchAssessment;
}

export interface SearchContext {
  cancerType?: string | null;
  referenceGenome?: ReferenceGenome | null;
  transcriptId?: string | null;
}

export interface SearchResult {
  submitted: ParsedVariant;
  context: SearchContext;
  findings: MatchedFinding[];
  /** CIViC evidence found for the gene that could not be tied to a specific variant record. */
  publications: PublicationRecord[];
  trials: TrialRecord[];
  sourceStatuses: SourceResultMeta[];
  /** Records that were retrieved for the gene but belong to a different gene (discarded). */
  discardedCount: number;
  notices: string[];
  retrievedAt: string;
}

export interface SourceIndexEntry {
  /** Citation id used by the AI layer, e.g. "S3". Assigned by the application, never by the model. */
  id: string;
  source: SourceName;
  sourceRecordId: string;
  title: string;
  url: string;
  kind: 'variant' | 'evidence' | 'publication' | 'trial';
  retrievedAt: string;
  /** Text the verifier may check claims against. Never sent anywhere except the summarizer. */
  text: string;
}
