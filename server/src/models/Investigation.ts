import { Schema, model } from 'mongoose';

export const INPUT_TYPES = ['gene', 'variant', 'report_text', 'report_pdf', 'mixed'] as const;
export const INVESTIGATION_STATUSES = ['draft', 'awaiting_confirmation', 'searching', 'complete', 'failed'] as const;

/**
 * Raw genetic report contents are deliberately NOT stored here. Only
 * non-identifying search context is kept in inputMetadata.
 */
const investigationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 160, default: 'Untitled investigation' },
    inputType: { type: String, enum: INPUT_TYPES, default: 'mixed' },
    inputMetadata: {
      cancerType: { type: String, trim: true, maxlength: 120, default: null },
      specimenContext: { type: String, trim: true, maxlength: 120, default: null },
      referenceGenome: { type: String, enum: ['GRCh37', 'GRCh38', null], default: null },
      transcriptId: { type: String, trim: true, maxlength: 40, default: null },
    },
    selectedCancerContext: { type: String, trim: true, maxlength: 120, default: null },
    status: { type: String, enum: INVESTIGATION_STATUSES, default: 'draft' },
  },
  { timestamps: true },
);
investigationSchema.index({ userId: 1, updatedAt: -1 });

export const Investigation = model('Investigation', investigationSchema);
