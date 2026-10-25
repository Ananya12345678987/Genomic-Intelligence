import { Schema, model } from 'mongoose';

export const MATCH_CATEGORIES = [
  'exact_normalized',
  'equivalent_representation',
  'same_position_different_allele',
  'same_gene_different_variant',
  'related_biomarker',
  'literature_only',
  'unresolved',
  // Extension: the user searched a gene only, so no variant comparison exists.
  'gene_level_result',
] as const;
export type MatchCategory = (typeof MATCH_CATEGORIES)[number];

/** Intentionally has no generic "confidence %" field. */
const matchSchema = new Schema(
  {
    investigationId: { type: Schema.Types.ObjectId, ref: 'Investigation', required: true },
    submittedVariantId: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
    matchedVariantId: { type: Schema.Types.ObjectId, ref: 'Variant', default: null },
    matchCategory: { type: String, enum: MATCH_CATEGORIES, required: true },
    matchRationale: { type: String, required: true, maxlength: 2000 },
    matchingFields: { type: [String], default: [] },
    differingFields: { type: [String], default: [] },
    sourceRecordIds: { type: [Schema.Types.ObjectId], ref: 'EvidenceRecord', default: [] },
    // How the match was established (identifier, genomic, coding_transcript, protein_notation, ...).
    matchBasis: { type: String, default: null },
    retrievedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
matchSchema.index({ investigationId: 1 });
matchSchema.index({ submittedVariantId: 1 });

export const MatchResult = model('MatchResult', matchSchema);
