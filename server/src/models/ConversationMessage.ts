import { Schema, model } from 'mongoose';

const citationSchema = new Schema(
  {
    refId: { type: String, required: true }, // internal id, e.g. "S3"
    source: { type: String, required: true },
    sourceRecordId: { type: String, required: true },
    canonicalUrl: { type: String, required: true },
    verified: { type: Boolean, default: false },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    investigationId: { type: Schema.Types.ObjectId, ref: 'Investigation', required: true },
    // "notice" = application-generated status text, never model output.
    role: { type: String, enum: ['user', 'assistant', 'notice'], required: true },
    content: { type: String, required: true, maxlength: 20000 },
    // Structured, already-verified result payload for rendering evidence panels.
    payload: { type: Schema.Types.Mixed, default: null },
    citationReferences: { type: [citationSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ investigationId: 1, createdAt: 1 });

export const ConversationMessage = model('ConversationMessage', messageSchema);
