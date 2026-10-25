import { CATEGORY_LABELS } from '../matching/index.js';
import type { ExportData } from './collect.js';

export const CSV_COLUMNS = [
  'record_type',
  'submitted_gene',
  'submitted_finding',
  'normalization_level',
  'match_category',
  'match_basis',
  'match_rationale',
  'differing_fields',
  'source',
  'source_record_id',
  'record_name',
  'gene',
  'classification',
  'classification_scope',
  'review_status',
  'disease_or_condition',
  'therapies_or_interventions',
  'evidence_level',
  'pmids',
  'trial_status',
  'canonical_url',
  'source_updated_at',
  'retrieved_at',
] as const;

type Row = Partial<Record<(typeof CSV_COLUMNS)[number], string | number | null | undefined>>;

/**
 * Neutralize spreadsheet formula injection: a cell that begins with = + - @ tab or CR is
 * interpreted as a formula by Excel/Sheets/LibreOffice, so it is prefixed with an apostrophe.
 * Then RFC 4180 quoting for commas, quotes and line breaks.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildCsv(data: ExportData): string {
  const rows: Row[] = [];
  const seenPubs = new Set<string>();
  const seenTrials = new Set<string>();

  for (const round of data.rounds) {
    for (const r of round.results) {
      const s = r.submitted;
      const submitted = s.hgvsProtein ?? s.hgvsCoding ?? s.hgvsGenomic ?? s.rsId ?? s.sourceRepresentation;
      const base = { submitted_gene: s.geneSymbol, submitted_finding: submitted, normalization_level: s.normalizationStatus };

      for (const f of r.findings) {
        const ref = f.record.ref;
        const cls = f.record.classifications;
        rows.push({
          ...base,
          record_type: 'variant_record',
          match_category: CATEGORY_LABELS[f.decision.category],
          match_basis: f.decision.basis,
          match_rationale: f.decision.rationale,
          differing_fields: f.decision.differingFields.join('; '),
          source: ref.source,
          source_record_id: ref.sourceRecordId,
          record_name: ref.displayName,
          gene: ref.geneSymbol,
          classification: cls.map((c) => c.label).join(' | '),
          classification_scope: cls.map((c) => c.scope).join(' | '),
          review_status: cls.map((c) => c.reviewStatus ?? 'not stated').join(' | '),
          disease_or_condition: [...new Set(cls.flatMap((c) => c.conditions ?? []))].join('; '),
          canonical_url: ref.canonicalUrl,
          source_updated_at: f.record.sourceUpdatedAt,
          retrieved_at: f.record.retrievedAt,
        });
        for (const e of f.evidence) {
          rows.push({
            ...base,
            record_type: 'evidence_item',
            match_category: CATEGORY_LABELS[f.decision.category],
            match_basis: f.decision.basis,
            source: e.source,
            source_record_id: e.sourceRecordId,
            record_name: e.molecularProfileName,
            gene: e.geneSymbol,
            classification: [e.evidenceType, e.evidenceDirection, e.significance].filter(Boolean).join(' / '),
            classification_scope: 'curated_evidence',
            disease_or_condition: e.disease,
            therapies_or_interventions: e.therapies.join('; '),
            evidence_level: e.evidenceLevel,
            pmids: e.pmids.join('; '),
            canonical_url: e.canonicalUrl,
            source_updated_at: e.sourceUpdatedAt,
            retrieved_at: e.retrievedAt,
          });
        }
      }
      for (const p of r.publications) {
        if (seenPubs.has(p.pmid)) continue;
        seenPubs.add(p.pmid);
        rows.push({
          ...base,
          record_type: 'publication',
          match_category: CATEGORY_LABELS.literature_only,
          source: 'pubmed',
          source_record_id: p.pmid,
          record_name: p.title,
          pmids: p.pmid,
          canonical_url: p.canonicalUrl,
          source_updated_at: p.publicationDate,
          retrieved_at: p.retrievedAt,
        });
      }
      for (const t of r.trials) {
        if (seenTrials.has(t.nctId)) continue;
        seenTrials.add(t.nctId);
        rows.push({
          ...base,
          record_type: 'clinical_trial',
          source: 'clinicaltrials',
          source_record_id: t.nctId,
          record_name: t.title,
          disease_or_condition: t.conditions.join('; '),
          therapies_or_interventions: t.interventions.join('; '),
          trial_status: t.status,
          canonical_url: t.canonicalUrl,
          source_updated_at: t.sourceUpdatedAt,
          retrieved_at: t.retrievedAt,
        });
      }
    }
  }

  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
  // Trailing note row would break machine parsing, so provenance goes in the header comment of the filename/docs instead.
  return `﻿${lines.join('\r\n')}\r\n`;
}
