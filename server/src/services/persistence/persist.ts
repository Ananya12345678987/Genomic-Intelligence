import { trusted, type Types } from 'mongoose';
import { Variant, EvidenceRecord, MatchResult, Publication, ClinicalTrial } from '../../models/index.js';
import type { ParsedVariant, SearchResult, VariantRecord } from '../../types/domain.js';

const toDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v.includes('/') ? v.replace(/\//g, '-') : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Fields copied only when the parser actually established them; everything else stays null. */
export function variantFieldsFrom(p: ParsedVariant) {
  return {
    geneSymbol: p.geneSymbol,
    hgvsGenomic: p.hgvsGenomic,
    hgvsCoding: p.hgvsCoding,
    hgvsProtein: p.hgvsProtein,
    referenceGenome: p.referenceGenome,
    transcriptId: p.transcriptId,
    chromosome: p.chromosome,
    position: p.position,
    referenceAllele: p.referenceAllele,
    alternateAllele: p.alternateAllele,
    rsId: p.rsId,
    normalizationStatus: p.normalizationStatus,
    sourceRepresentation: p.sourceRepresentation.slice(0, 400),
  };
}

async function upsertMatchedVariant(rec: VariantRecord): Promise<Types.ObjectId | null> {
  const ref = rec.ref;
  const key =
    ref.identifiers.clinvarVariationId
      ? { clinvarVariationId: ref.identifiers.clinvarVariationId }
      : ref.identifiers.civicProfileId
        ? { civicMolecularProfileId: ref.identifiers.civicProfileId }
        : null;
  if (!key) return null;
  const fields = ref.parsed ? variantFieldsFrom(ref.parsed) : { geneSymbol: ref.geneSymbol, normalizationStatus: 'unresolved' as const, sourceRepresentation: ref.displayName.slice(0, 400) };
  const doc = await Variant.findOneAndUpdate(
    { userId: null, ...key },
    { $set: { ...fields, ...key, rsId: ref.identifiers.rsId ?? (fields as { rsId?: string | null }).rsId ?? null, civicVariantId: ref.identifiers.civicVariantId ?? null, sourceRepresentation: ref.displayName.slice(0, 400) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
    .select('_id')
    .lean();
  return (doc?._id as Types.ObjectId | undefined) ?? null;
}

/**
 * Save one search for an investigation: the user's submitted variant (private), the shared public
 * source records (no user data), and a MatchResult linking them. Called best-effort by controllers:
 * a persistence failure must not hide results that were successfully retrieved.
 */
export async function persistSearch(opts: { userId: Types.ObjectId; investigationId: Types.ObjectId; results: SearchResult[] }): Promise<void> {
  for (const r of opts.results) {
    const submittedDoc = await Variant.create({ ...variantFieldsFrom(r.submitted), userId: opts.userId, investigationId: opts.investigationId });

    const evidenceOps: Parameters<typeof EvidenceRecord.bulkWrite>[0] = [];
    const ids: string[] = [];
    for (const f of r.findings) {
      const ref = f.record.ref;
      ids.push(ref.sourceRecordId);
      evidenceOps.push({
        updateOne: {
          filter: { source: ref.source, sourceRecordId: ref.sourceRecordId },
          update: {
            $set: {
              canonicalUrl: ref.canonicalUrl,
              geneSymbol: ref.geneSymbol,
              variantIdentifiers: {
                hgvsProtein: ref.parsed?.hgvsProtein ?? null,
                hgvsCoding: ref.parsed?.hgvsCoding ?? null,
                hgvsGenomic: ref.parsed?.hgvsGenomic ?? null,
                rsId: ref.identifiers.rsId ?? null,
                clinvarVariationId: ref.identifiers.clinvarVariationId ?? null,
                civicVariantId: ref.identifiers.civicVariantId ?? null,
                variantName: ref.displayName,
              },
              diseaseContext: [...new Set(f.record.classifications.flatMap((c) => c.conditions ?? []))],
              evidenceType: 'variant_record',
              sourceClassification: f.record.classifications.map((c) => `${c.label} [${c.scope}]`).join(' | ') || null,
              sourceEvidenceLevel: null,
              claimSummary: null,
              sourceUpdatedAt: toDate(f.record.sourceUpdatedAt),
              retrievedAt: toDate(f.record.retrievedAt) ?? new Date(),
              rawSourceMetadata: { classifications: f.record.classifications, limitations: f.record.limitations },
            },
          },
          upsert: true,
        },
      });
      for (const e of f.evidence) {
        ids.push(e.sourceRecordId);
        evidenceOps.push({
          updateOne: {
            filter: { source: 'civic', sourceRecordId: e.sourceRecordId },
            update: {
              $set: {
                canonicalUrl: e.canonicalUrl,
                geneSymbol: e.geneSymbol,
                variantIdentifiers: { variantName: e.molecularProfileName },
                diseaseContext: e.disease ? [e.disease] : [],
                evidenceType: e.evidenceType,
                sourceClassification: [e.evidenceDirection, e.significance].filter(Boolean).join(' / ') || null,
                sourceEvidenceLevel: e.evidenceLevel,
                claimSummary: e.claimSummary.slice(0, 4000),
                publicationIds: e.pmids,
                sourceUpdatedAt: toDate(e.sourceUpdatedAt),
                retrievedAt: toDate(e.retrievedAt) ?? new Date(),
                rawSourceMetadata: { therapies: e.therapies, variantOrigin: e.variantOrigin, status: e.status, molecularProfileId: e.molecularProfileId },
              },
            },
            upsert: true,
          },
        });
      }
    }
    if (evidenceOps.length) await EvidenceRecord.bulkWrite(evidenceOps, { ordered: false });
    const stored = ids.length
      ? await EvidenceRecord.find({ sourceRecordId: trusted({ $in: ids }) }).select('_id source sourceRecordId').lean()
      : [];
    const idByKey = new Map(stored.map((s) => [`${s.source}:${s.sourceRecordId}`, s._id as Types.ObjectId]));

    for (const f of r.findings) {
      const matchedVariantId = await upsertMatchedVariant(f.record);
      const recIds = [f.record.ref.source + ':' + f.record.ref.sourceRecordId, ...f.evidence.map((e) => 'civic:' + e.sourceRecordId)]
        .map((k) => idByKey.get(k))
        .filter((x): x is Types.ObjectId => !!x);
      await MatchResult.create({
        investigationId: opts.investigationId,
        submittedVariantId: submittedDoc._id,
        matchedVariantId,
        matchCategory: f.decision.category,
        matchRationale: f.decision.rationale.slice(0, 2000),
        matchingFields: f.decision.matchingFields,
        differingFields: f.decision.differingFields,
        sourceRecordIds: recIds,
        matchBasis: f.decision.basis,
        retrievedAt: toDate(f.record.retrievedAt) ?? new Date(),
      });
    }

    if (r.publications.length) {
      await Publication.bulkWrite(
        r.publications.map((p) => ({
          updateOne: {
            filter: { pmid: p.pmid },
            update: {
              $set: {
                source: 'pubmed', doi: p.doi, title: p.title.slice(0, 1000), authors: p.authors, journal: p.journal,
                publicationDate: p.publicationDate, abstract: p.abstract ? p.abstract.slice(0, 20000) : null,
                canonicalUrl: p.canonicalUrl, retrievedAt: toDate(p.retrievedAt) ?? new Date(),
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
    if (r.trials.length) {
      await ClinicalTrial.bulkWrite(
        r.trials.map((t) => ({
          updateOne: {
            filter: { nctId: t.nctId },
            update: {
              $set: {
                title: t.title.slice(0, 1000), conditions: t.conditions, interventions: t.interventions, status: t.status,
                eligibilitySummary: t.eligibilitySummary ? t.eligibilitySummary.slice(0, 6000) : null, locations: t.locations.slice(0, 50),
                sourceUpdatedAt: toDate(t.sourceUpdatedAt), canonicalUrl: t.canonicalUrl, retrievedAt: toDate(t.retrievedAt) ?? new Date(),
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
  }
}
