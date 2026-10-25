import type { MatchedFinding, PublicationRecord, SearchResult, SourceIndexEntry, TrialRecord } from '../../types/domain.js';
import { CATEGORY_LABELS } from '../matching/index.js';

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : '');

function findingText(f: MatchedFinding): string {
  const cls = f.record.classifications
    .map((c) => `${c.label} (${c.scope}; review status: ${c.reviewStatus ?? 'not stated'}; conditions: ${c.conditions?.join('; ') || 'not stated'})`)
    .join(' | ');
  return `${f.record.ref.source} variant record ${f.record.ref.displayName}. Gene ${f.record.ref.geneSymbol ?? 'unknown'}. Match category: ${CATEGORY_LABELS[f.decision.category]}. ${cls}`;
}

function publicationText(p: PublicationRecord): string {
  return `PubMed ${p.pmid}. ${p.title}. ${p.journal ?? ''} ${p.publicationDate ?? ''}. ${clip(p.abstract, 1500)}`;
}

function trialText(t: TrialRecord): string {
  return `ClinicalTrials.gov ${t.nctId}. ${t.title}. Status ${t.status ?? 'unknown'}. Conditions: ${t.conditions.join('; ')}. Interventions: ${t.interventions.join('; ')}. Last updated ${t.sourceUpdatedAt ?? 'unknown'}.`;
}

/**
 * Assign citation ids (S1, S2, ...) to every retrieved record. Ids and URLs come from the
 * application, never from a model. The `text` of each entry is what citations are verified against.
 */
export function buildSourceIndex(results: SearchResult[]): SourceIndexEntry[] {
  const entries: SourceIndexEntry[] = [];
  const seen = new Set<string>();
  const add = (e: Omit<SourceIndexEntry, 'id'>) => {
    const key = `${e.source}:${e.sourceRecordId}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ ...e, id: `S${entries.length + 1}` });
  };

  for (const r of results) {
    for (const f of r.findings) {
      add({
        source: f.record.ref.source,
        sourceRecordId: f.record.ref.sourceRecordId,
        title: f.record.ref.displayName,
        url: f.record.ref.canonicalUrl,
        kind: 'variant',
        retrievedAt: f.record.retrievedAt,
        text: findingText(f),
      });
      for (const e of f.evidence) {
        add({
          source: 'civic',
          sourceRecordId: e.sourceRecordId,
          title: `${e.sourceRecordId}: ${e.molecularProfileName ?? ''}`,
          url: e.canonicalUrl,
          kind: 'evidence',
          retrievedAt: e.retrievedAt,
          text: `CIViC evidence ${e.sourceRecordId} for ${e.molecularProfileName ?? 'unknown profile'}. Evidence type ${e.evidenceType}, level ${e.evidenceLevel}, direction ${e.evidenceDirection}, significance ${e.significance}, variant origin ${e.variantOrigin}. Disease ${e.disease ?? 'not stated'}. Therapies ${e.therapies.join(', ') || 'none stated'}. ${e.claimSummary} ${e.citation ?? ''}`,
        });
      }
    }
    for (const p of r.publications) {
      add({
        source: 'pubmed', sourceRecordId: p.pmid, title: p.title, url: p.canonicalUrl, kind: 'publication',
        retrievedAt: p.retrievedAt, text: publicationText(p),
      });
    }
    for (const t of r.trials) {
      add({
        source: 'clinicaltrials', sourceRecordId: t.nctId, title: t.briefTitle ?? t.title, url: t.canonicalUrl, kind: 'trial',
        retrievedAt: t.retrievedAt, text: trialText(t),
      });
    }
  }
  return entries;
}

export function indexLookup(index: SourceIndexEntry[]) {
  const byKey = new Map(index.map((e) => [`${e.source}:${e.sourceRecordId}`, e]));
  const byId = new Map(index.map((e) => [e.id, e]));
  return {
    byKey,
    byId,
    idFor: (source: string, recordId: string) => byKey.get(`${source}:${recordId}`)?.id ?? null,
  };
}

/** What the browser and the stored message keep: no `text` (it can be large and is only for verification). */
export function publicIndex(index: SourceIndexEntry[]) {
  return index.map(({ text: _text, ...rest }) => rest);
}
