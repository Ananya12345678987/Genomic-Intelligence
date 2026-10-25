import { Schema, model } from 'mongoose';

/** Most specific level validated syntactically. None of these is verified against a reference sequence. */
export const NORMALIZATION_STATUSES = [
  'genomic_coordinates',
  'coding_hgvs',
  'protein_change',
  'identifier_only',
  'gene_only',
  'ambiguous',
  'unresolved',
] as const;

/** Every identifier stays null unless supported by the input or a source. Nothing is guessed. */
const variantSchema = new Schema(
  {
    // Set for variants a user SUBMITTED (private); null for variants derived from public sources (shared).
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    investigationId: { type: Schema.Types.ObjectId, ref: 'Investigation', default: null },
    geneSymbol: { type: String, default: null, trim: true, uppercase: true, maxlength: 40 },
    hgvsGenomic: { type: String, default: null, maxlength: 300 },
    hgvsCoding: { type: String, default: null, maxlength: 300 },
    hgvsProtein: { type: String, default: null, maxlength: 300 },
    referenceGenome: { type: String, enum: ['GRCh37', 'GRCh38', null], default: null },
    transcriptId: { type: String, default: null, maxlength: 40 },
    chromosome: { type: String, default: null, maxlength: 4 },
    position: { type: Number, default: null },
    referenceAllele: { type: String, default: null, maxlength: 200 },
    alternateAllele: { type: String, default: null, maxlength: 200 },
    rsId: { type: String, default: null, maxlength: 20 },
    clinvarVariationId: { type: String, default: null, maxlength: 20 },
    civicVariantId: { type: String, default: null, maxlength: 20 },
    // CIViC groups evidence by molecular profile; that id is what the adapter retrieves.
    civicMolecularProfileId: { type: String, default: null, maxlength: 20 },
    normalizationStatus: { type: String, enum: NORMALIZATION_STATUSES, required: true, default: 'unresolved' },
    sourceRepresentation: { type: String, required: true, maxlength: 400 },
  },
  { timestamps: true },
);
variantSchema.index({ geneSymbol: 1 });
variantSchema.index({ geneSymbol: 1, hgvsProtein: 1 });
variantSchema.index({ hgvsGenomic: 1 });
variantSchema.index({ rsId: 1 });
variantSchema.index({ clinvarVariationId: 1 });
variantSchema.index({ civicVariantId: 1 });
variantSchema.index({ civicMolecularProfileId: 1 });
variantSchema.index({ userId: 1, investigationId: 1 });

export const Variant = model('Variant', variantSchema);
