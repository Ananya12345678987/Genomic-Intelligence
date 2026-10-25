import type { MatchedFinding, MatchCategory, SearchResult, SourceIndexEntry } from '../../types/domain.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../matching/index.js';
import { indexLookup } from '../evidence/sourceIndex.js';

export const mdEscape = (s: string) => s.replace(/([\\`*_{}[\]()#+!|<>])/g, '\\$1');

export function citeLinks(ids: (string | null)[], index: SourceIndexEntry[]): string {
  const { byId } = indexLookup(index);
  return ids
    .filter((i): i is string => !!i)
    .map((id) => {
      const e = byId.get(id);
      return e ? `[${id}](${e.url})` : '';
    })
    .filter(Boolean)
    .join(' ');
}

function describeFinding(f: MatchedFinding, index: SourceIndexEntry[]): string {
  const { idFor } = indexLookup(index);
  const rid = idFor(f.record.ref.source, f.record.ref.sourceRecordId);
  const parts: string[] = [`${f.record.ref.source === 'clinvar' ? 'ClinVar' : 'CIViC'} record **${mdEscape(f.record.ref.displayName)}** ${citeLinks([rid], index)}`];
  for (const c of f.record.classifications) {
    const scope = {
      germline_pathogenicity: 'germline pathogenicity',
      somatic_clinical_impact: 'somatic clinical impact',
      somatic_oncogenicity: 'oncogenicity',
      curated_evidence: 'curated evidence',
      other: 'classification',
    }[c.scope];
    parts.push(`reports "${mdEscape(c.label)}" (${scope}${c.reviewStatus ? `; review status: ${mdEscape(c.reviewStatus)}` : ''})`);
  }
  if (f.evidence.length) {
    const levels = [...new Set(f.evidence.map((e) => e.evidenceLevel).filter(Boolean))].sort().join(', ');
    const ids = f.evidence.slice(0, 3).map((e) => idFor('civic', e.sourceRecordId));
    parts.push(`has ${f.evidence.length} accepted evidence item${f.evidence.length === 1 ? '' : 's'} (levels: ${levels || 'n/a'}) ${citeLinks(ids, index)}`);
  }
  return parts.join(' ');
}

/**
 * A plain, model-free summary assembled directly from retrieved records. Every sentence is a
 * template filled from a record, and every record mentioned is cited by an id from our own index.
 */
export function deterministicSummary(results: SearchResult[], index: SourceIndexEntry[]): string {
  const { idFor } = indexLookup(index);
  const blocks: string[] = [];

  for (const r of results) {
    const s = r.submitted;
    const title = s.hgvsProtein ?? s.hgvsCoding ?? s.hgvsGenomic ?? s.rsId ?? s.sourceRepresentation;
    const lines: string[] = [`### ${mdEscape(s.geneSymbol ?? 'Unknown gene')} ${mdEscape(title)}`];
    lines.push(`Submitted as "${mdEscape(s.sourceRepresentation)}". Normalization level: **${s.normalizationStatus.replace(/_/g, ' ')}**.`);

    const byCat = new Map<MatchCategory, MatchedFinding[]>();
    for (const f of r.findings) byCat.set(f.decision.category, [...(byCat.get(f.decision.category) ?? []), f]);
    const cats = [...byCat.keys()].sort((a, b) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b]);

    if (s.normalizationStatus !== 'gene_only') {
      const exact = byCat.get('exact_normalized');
      if (exact?.length) {
        lines.push(`**Exact normalized match${exact.length > 1 ? 'es' : ''}:**`);
        for (const f of exact.slice(0, 4)) lines.push(`- ${describeFinding(f, index)}`);
      } else {
        lines.push('**No exact normalized match was found** in the sources queried.');
      }
    }
    for (const cat of cats) {
      if (cat === 'exact_normalized') continue;
      const list = byCat.get(cat)!;
      lines.push(`**${CATEGORY_LABELS[cat]}** (${list.length}):`);
      for (const f of list.slice(0, 3)) lines.push(`- ${describeFinding(f, index)}. ${mdEscape(f.decision.rationale)}`);
      if (list.length > 3) lines.push(`- …and ${list.length - 3} more in the evidence panel.`);
    }
    if (!r.findings.length) lines.push('No variant records were retrieved for this submission.');

    if (r.publications.length) {
      const ids = r.publications.slice(0, 3).map((p) => idFor('pubmed', p.pmid));
      lines.push(`**Publications:** ${r.publications.length} PubMed result${r.publications.length === 1 ? '' : 's'} (abstract-level only; full articles not reviewed) ${citeLinks(ids, index)}`);
    }
    if (r.trials.length) {
      const ids = r.trials.slice(0, 3).map((t) => idFor('clinicaltrials', t.nctId));
      lines.push(`**Clinical trials:** ${r.trials.length} record${r.trials.length === 1 ? '' : 's'} matched by text search ${citeLinks(ids, index)}. A shared gene, variant or cancer type does not establish eligibility.`);
    }
    blocks.push(lines.join('\n\n'));
  }
  return blocks.join('\n\n---\n\n');
}
