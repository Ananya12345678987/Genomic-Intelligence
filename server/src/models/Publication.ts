import { Schema, model } from 'mongoose';

const publicationSchema = new Schema(
  {
    source: { type: String, default: 'pubmed' },
    pmid: { type: String, required: true }, // all publications originate from PubMed
    doi: { type: String, default: null },
    title: { type: String, required: true, maxlength: 1000 },
    authors: { type: [String], default: [] },
    journal: { type: String, default: null },
    publicationDate: { type: String, default: null }, // as reported; partial dates are common
    abstract: { type: String, default: null, maxlength: 20000 },
    canonicalUrl: { type: String, required: true },
    retrievedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
publicationSchema.index({ pmid: 1 }, { unique: true });
publicationSchema.index({ doi: 1 });

export const Publication = model('Publication', publicationSchema);
