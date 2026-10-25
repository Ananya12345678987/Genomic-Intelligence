// Fixtures for the UI smoke test. SYNTHETIC DATA shaped like the server's payloads.
// None of this is a real database record; it exists only to exercise rendering.
const now = '2026-10-24T12:00:00.000Z';

const submitted = {
  sourceRepresentation: 'BRAF p.Val600Glu', geneSymbol: 'BRAF', geneRecognized: true,
  hgvsGenomic: null, hgvsCoding: null, hgvsProtein: 'p.Val600Glu', referenceGenome: null, transcriptId: null,
  chromosome: null, position: null, referenceAllele: null, alternateAllele: null, rsId: null,
  normalizationStatus: 'protein_change', warnings: ['Protein-level notation can correspond to more than one genomic change.'],
  missing: ['reference genome', 'transcript accession'],
};
const assessment = (lvl) => ({
  matchConfidence: { level: lvl, explanation: 'Matched on gene and protein change as submitted; no genomic coordinates were available to compare.' },
  evidenceStrength: { items: [{ label: 'Example classification', scope: 'somatic_clinical_impact', note: 'Scope: this source label only.' }], note: 'Evidence strength is the source\'s own classification and is not combined with match confidence.' },
  clinicalRelevance: { statements: ['Source lists a disease context of Melanoma.'], note: 'Not a recommendation for any individual.' },
  evidenceCompleteness: { missing: ['No transcript supplied'], note: 'Completeness reflects submitted information, not the biology.' },
});
const finding = (id, cat, name, src, rationale, extra = {}) => ({
  id,
  decision: { category: cat, rationale, matchingFields: ['gene', 'hgvsProtein'], differingFields: cat === 'exact_normalized' ? [] : ['hgvsProtein'], basis: 'protein_notation' },
  record: {
    ref: { source: src, sourceRecordId: id, canonicalUrl: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/0000/', geneSymbol: 'BRAF', displayName: name, identifiers: { clinvarVariationId: '0000' } },
    classifications: [{ label: 'Example label (synthetic)', scope: 'germline_pathogenicity', scopeNote: 'Describes pathogenicity for the source\'s submitted conditions, not treatment actionability.', reviewStatus: 'criteria provided, single submitter', lastEvaluated: '2024-03-01', conditions: ['Example condition'] }],
    sourceUpdatedAt: '2025-01-10', retrievedAt: now, limitations: ['Synthetic fixture for UI testing.'],
  },
  evidence: extra.evidence ?? [],
  assessment: assessment('moderate'),
});

const results = [{
  submitted, context: { cancerType: 'melanoma' },
  findings: [
    finding('f1', 'exact_normalized', 'BRAF p.Val600Glu (synthetic)', 'clinvar', 'Shares the same gene and protein change as the submitted finding.'),
    finding('f2', 'same_position_different_allele', 'BRAF p.Val600Lys (synthetic)', 'clinvar', 'Same residue, different amino acid: a different variant.'),
    finding('f3', 'same_gene_different_variant', 'BRAF p.Gly469Ala (synthetic)', 'civic', 'Same gene only.', {
      evidence: [{ source: 'civic', sourceRecordId: 'EID0', canonicalUrl: 'https://civicdb.org/evidence/0', molecularProfileName: 'BRAF G469A', evidenceType: 'Predictive', evidenceLevel: 'D', evidenceDirection: 'Supports', significance: 'Sensitivity', variantOrigin: 'Somatic', disease: 'Melanoma', therapies: ['ExampleDrug'], claimSummary: 'Synthetic evidence statement for layout testing.', pmids: ['00000001'], citation: null, sourceUpdatedAt: '2025-02-01', retrievedAt: now }],
    }),
  ],
  publications: [{ pmid: '00000001', doi: null, title: 'Synthetic publication title used for layout testing', authors: ['Author A', 'Author B', 'Author C', 'Author D'], journal: 'Example Journal', publicationDate: '2020-05-01', abstract: 'Synthetic abstract text for layout testing.', canonicalUrl: 'https://pubmed.ncbi.nlm.nih.gov/00000001/', retrievedAt: now }],
  trials: [{ nctId: 'NCT00000000', title: 'A Synthetic Official Trial Title', briefTitle: 'Synthetic trial', conditions: ['Melanoma'], interventions: ['ExampleDrug'], status: 'RECRUITING', eligibilitySummary: 'Synthetic eligibility text.', locations: ['Example City, Country'], sourceUpdatedAt: '2026-09-01', canonicalUrl: 'https://clinicaltrials.gov/study/NCT00000000', retrievedAt: now }],
  sourceStatuses: [
    { source: 'clinvar', status: 'ok', retrievedAt: now, fromCache: false, query: 'q', limitations: [], total: 2 },
    { source: 'civic', status: 'unavailable', message: 'CIViC did not respond in time. No CIViC records are shown.', retrievedAt: now, fromCache: false, query: 'q', limitations: [] },
    { source: 'pubmed', status: 'ok', retrievedAt: now, fromCache: true, cacheExpiresAt: '2026-10-31', query: 'q', limitations: [], total: 1 },
    { source: 'clinicaltrials', status: 'no_results', retrievedAt: now, fromCache: false, query: 'q', limitations: [] },
  ],
  notices: [], retrievedAt: now,
}];

const messages = [
  { id: 'm1', role: 'user', content: 'Investigate BRAF V600E in melanoma.', payload: null, createdAt: now },
  { id: 'm2', role: 'assistant', content: 'Results', createdAt: now, payload: {
    kind: 'results', results, index: [],
    safetyNotice: 'Research support only. This is not a diagnosis or a treatment recommendation.',
    answer: { mode: 'deterministic', provider: null, removedCount: 0, removedReasons: [], notice: 'AI summarization is not configured on this server, so this summary is generated from retrieved records by fixed rules, not by a model.', markdown: '### Retrieved evidence\n\n- **1** exact normalized match in ClinVar.\n- **2** related records that are *not* the submitted variant.' } } },
  { id: 'm3', role: 'user', content: '[PDF report uploaded: 2 pages. The file was processed and not stored.]', payload: null, createdAt: now },
  { id: 'm4', role: 'assistant', content: 'Extracted 2 candidate findings for your review.', createdAt: now, payload: {
    kind: 'extraction_review', reportId: 'rep1', pageCount: 2, context: {},
    notice: 'Found 2 candidate findings in 2 pages by text pattern matching. Review, correct and select the ones to investigate. The PDF and its text were not stored.',
    candidates: [
      { id: 'c1', text: 'EGFR p.Leu858Arg', status: 'recognized', warnings: [], selected: true, geneSymbol: 'EGFR', hgvsProtein: 'p.Leu858Arg', hgvsCoding: null, hgvsGenomic: null, transcriptId: null, referenceGenome: null, rsId: null, normalizationStatus: 'protein_change' },
      { id: 'c2', text: 'KRAS G12', status: 'needs_review', warnings: ['Incomplete change: no substituted amino acid was found.'], selected: false, geneSymbol: 'KRAS', hgvsProtein: null, hgvsCoding: null, hgvsGenomic: null, transcriptId: null, referenceGenome: null, rsId: null, normalizationStatus: 'ambiguous' },
    ] } },
];

module.exports = { messages, now };
