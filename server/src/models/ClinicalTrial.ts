import { Schema, model } from 'mongoose';

const trialSchema = new Schema(
  {
    nctId: { type: String, required: true, unique: true },
    title: { type: String, required: true, maxlength: 1000 },
    conditions: { type: [String], default: [] },
    interventions: { type: [String], default: [] },
    status: { type: String, default: null }, // as reported by the source
    eligibilitySummary: { type: String, default: null, maxlength: 6000 },
    locations: { type: [String], default: [] },
    sourceUpdatedAt: { type: Date, default: null },
    canonicalUrl: { type: String, required: true },
    retrievedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const ClinicalTrial = model('ClinicalTrial', trialSchema);
