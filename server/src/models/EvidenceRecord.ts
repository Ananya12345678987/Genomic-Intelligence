import { Schema, model } from 'mongoose';

export const EVIDENCE_SOURCES = ['clinvar', 'civic', 'pubmed', 'clinicaltrials'] as const;

/** Shared public-source record. Contains no user data, so it is safe to share across users. */
const evidenceSchema = new Schema(
  {
    source: { type: String, enum: EVIDENCE_SOURCES, required: true },
    sourceRecordId: { type: String, required: true },
    canonicalUrl: { type: String, required: true },
    geneSymbol: { type: String, default: null, uppercase: true },
    variantIdentifiers: {
      hgvsProtein: { type: String, default: null },
      hgvsCoding: { type: String, default: null },
      hgvsGenomic: { type: String, default: null },
      rsId: { type: String, default: null },
      clinvarVariationId: { type: String, default: null },
      civicVariantId: { type: String, default: null },
      variantName: { type: String, default: null },
    },
    diseaseContext: { type: [String], default: [] },
    evidenceType: { type: String, default: null },
    sourceClassification: { type: String, default: null },
    sourceEvidenceLevel: { type: String, default: null },
    claimSummary: { type: String, default: null, maxlength: 4000 },
    publicationIds: { type: [String], default: [] },
    sourceUpdatedAt: { type: Date, default: null },
    retrievedAt: { type: Date, required: true },
    // Small, source-specific fields only. Large or restricted payloads are not stored.
    rawSourceMetadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);
evidenceSchema.index({ source: 1, sourceRecordId: 1 }, { unique: true });
evidenceSchema.index({ geneSymbol: 1 });
evidenceSchema.index({ 'variantIdentifiers.rsId': 1 });
evidenceSchema.index({ 'variantIdentifiers.clinvarVariationId': 1 });

export const EvidenceRecord = model('EvidenceRecord', evidenceSchema);
