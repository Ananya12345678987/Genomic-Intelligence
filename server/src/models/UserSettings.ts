import { Schema, model } from 'mongoose';

const settingsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // Explicit, revocable consent to send redacted report-derived text to the configured AI provider.
    aiSensitiveContentConsent: { type: Boolean, default: false },
    aiSensitiveContentConsentAt: { type: Date, default: null },
    sidebarCollapsed: { type: Boolean, default: false },
    defaultReferenceGenome: { type: String, enum: ['GRCh37', 'GRCh38', null], default: null },
    savedSearches: {
      type: [{ label: { type: String, maxlength: 80 }, query: { type: String, maxlength: 500 } }],
      default: [],
    },
  },
  { timestamps: true },
);

export const UserSettings = model('UserSettings', settingsSchema);
