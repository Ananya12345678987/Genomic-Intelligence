/** Client-side mirror of the server's result payloads. Only fields the UI reads. */

export type MatchCategory =
  | 'exact_normalized'
  | 'equivalent_representation'
  | 'same_position_different_allele'
  | 'same_gene_different_variant'
  | 'related_biomarker'
  | 'literature_only'
  | 'unresolved'
  | 'gene_level_result';

export interface ParsedVariant {
  sourceRepresentation: string;
  geneSymbol: string | null;
  geneRecognized: boolean;
  hgvsGenomic: string | null;
  hgvsCoding: string | null;
  hgvsProtein: string | null;
  referenceGenome: 'GRCh37' | 'GRCh38' | null;
  transcriptId: string | null;
  chromosome: string | null;
  position: number | null;
  referenceAllele: string | null;
  alternateAllele: string | null;
  rsId: string | null;
  normalizationStatus: string;
  warnings: string[];
  missing: string[];
}

export interface SourceClassification {
  label: string;
  scope: 'germline_pathogenicity' | 'somatic_clinical_impact' | 'somatic_oncogenicity' | 'curated_evidence' | 'other';
  scopeNote: string;
  reviewStatus?: string | null;
  lastEvaluated?: string | null;
  conditions?: string[];
}

export interface EvidenceItem {
  source: 'civic';
  sourceRecordId: string;
  canonicalUrl: string;
  molecularProfileName: string | null;
  evidenceType: string | null;
  evidenceLevel: string | null;
  evidenceDirection: string | null;
  significance: string | null;
  variantOrigin: string | null;
  disease: string | null;
  therapies: string[];
  claimSummary: string;
  pmids: string[];
  citation: string | null;
  sourceUpdatedAt: string | null;
  retrievedAt: string;
}

export interface MatchAssessment {
  matchConfidence: { level: string; explanation: string };
  evidenceStrength: { items: { label: string; scope: string; note: string }[]; note: string };
  clinicalRelevance: { statements: string[]; note: string };
  evidenceCompleteness: { missing: string[]; note: string };
}

export interface MatchedFinding {
  id: string;
  decision: { category: MatchCategory; rationale: string; matchingFields: string[]; differingFields: string[]; basis: string };
  record: {
    ref: {
      source: 'clinvar' | 'civic';
      sourceRecordId: string;
      canonicalUrl: string;
      geneSymbol: string | null;
      displayName: string;
      identifiers: { clinvarVariationId?: string; clinvarAccession?: string; civicVariantId?: string; civicProfileId?: string; rsId?: string };
    };
    classifications: SourceClassification[];
    sourceUpdatedAt: string | null;
    retrievedAt: string;
    limitations: string[];
  };
  evidence: EvidenceItem[];
  assessment: MatchAssessment;
}

export interface PublicationRecord {
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

export interface SourceMeta {
  source: 'clinvar' | 'civic' | 'pubmed' | 'clinicaltrials';
  status: 'ok' | 'no_results' | 'unavailable' | 'rate_limited' | 'unexpected_response' | 'skipped';
  message?: string;
  retrievedAt: string;
  fromCache: boolean;
  cacheExpiresAt?: string;
  query: string;
  limitations: string[];
  total?: number;
}

export interface SearchResult {
  submitted: ParsedVariant;
  context: { cancerType?: string | null; referenceGenome?: string | null; transcriptId?: string | null };
  findings: MatchedFinding[];
  publications: PublicationRecord[];
  trials: TrialRecord[];
  sourceStatuses: SourceMeta[];
  notices: string[];
  retrievedAt: string;
}

export interface IndexEntry {
  id: string;
  source: string;
  sourceRecordId: string;
  title: string;
  url: string;
  kind: 'variant' | 'evidence' | 'publication' | 'trial';
  retrievedAt: string;
}

export interface AnswerBlock {
  mode: 'ai' | 'deterministic';
  provider: string | null;
  markdown: string;
  removedCount: number;
  removedReasons: string[];
  notice: string | null;
}

export interface ReviewCandidate {
  id: string;
  text: string;
  status: 'recognized' | 'needs_review';
  warnings: string[];
  selected: boolean;
  geneSymbol: string | null;
  hgvsProtein: string | null;
  hgvsCoding: string | null;
  hgvsGenomic: string | null;
  transcriptId: string | null;
  referenceGenome: string | null;
  rsId: string | null;
  normalizationStatus: string;
}

export type AssistantPayload =
  | { kind: 'results'; results: SearchResult[]; answer: AnswerBlock; index: IndexEntry[]; safetyNotice: string }
  | { kind: 'extraction_review'; reportId: string | null; candidates: ReviewCandidate[]; context: { cancerType?: string | null; referenceGenome?: string | null }; pageCount: number | null; notice: string };

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  content: string;
  payload: AssistantPayload | null;
  createdAt: string;
}

export interface ChatContext {
  cancerType?: string | null;
  referenceGenome?: 'GRCh37' | 'GRCh38' | null;
  transcriptId?: string | null;
}

export interface Settings {
  aiSensitiveContentConsent: boolean;
  ai: { configured: boolean; sensitiveContentAllowedByOperator: boolean };
}
