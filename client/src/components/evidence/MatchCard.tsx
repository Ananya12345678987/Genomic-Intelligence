import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { MatchedFinding } from '../../types/research';
import { CATEGORY_HELP, CATEGORY_LABEL, SCOPE_LABEL, SOURCE_LABEL, formatDate } from './labels';
import { Provenance, SourceLink, Tech } from './small';

const FIELD_LABEL: Record<string, string> = {
  gene: 'gene', hgvsProtein: 'protein change', hgvsCoding: 'coding change', hgvsGenomic: 'genomic change', rsId: 'dbSNP id',
  transcriptId: 'transcript', referenceGenome: 'assembly', chromosome: 'chromosome', position: 'position',
  referenceAllele: 'reference allele', alternateAllele: 'alternate allele',
};
const field = (f: string) => FIELD_LABEL[f] ?? f;

/** One retrieved record, expandable. Collapsed view answers "what is this and how does it relate to my input?" */
export function MatchCard({ finding, defaultOpen = false }: { finding: MatchedFinding; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { decision, record, evidence, assessment } = finding;
  const ref = record.ref;
  const exact = decision.category === 'exact_normalized';
  const ids = Object.entries(ref.identifiers).filter(([, v]) => v);

  return (
    <article className={clsx('card overflow-hidden', exact && 'border-pistachio-deep')}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-alt/60">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('rounded-pill px-2 py-0.5 text-[11px] font-semibold', exact ? 'bg-pistachio' : 'bg-butter')}>
              {exact ? '● ' : '◐ '}
              {CATEGORY_LABEL[decision.category]}
            </span>
            <span className="text-[11px] text-ink-soft">{SOURCE_LABEL[ref.source]}</span>
          </div>
          <div className="mt-1.5 break-words text-sm font-medium">{ref.displayName}</div>
          <p className="mt-0.5 text-xs text-ink-soft">{CATEGORY_HELP[decision.category]}</p>
          {record.classifications.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {record.classifications.map((c, i) => (
                <li key={i} className="rounded-md bg-surface-alt px-2 py-0.5 text-[11px]">
                  <span className="text-ink-soft">{SCOPE_LABEL[c.scope]}: </span>
                  <span className="font-medium">{c.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ChevronDown className={clsx('mt-1 h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-4 py-4 text-sm">
          <section aria-label="Why this was retrieved">
            <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">Why retrieved <Provenance kind="computed" /></h4>
            <p>{decision.rationale}</p>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <div><dt className="inline text-ink-soft">Matches on: </dt><dd className="inline">{decision.matchingFields.map(field).join(', ') || 'nothing beyond retrieval'}</dd></div>
              <div><dt className="inline text-ink-soft">Differs in: </dt><dd className="inline">{decision.differingFields.map(field).join(', ') || 'no differing field identified'}</dd></div>
              <div><dt className="inline text-ink-soft">Basis: </dt><dd className="inline">{decision.basis.replace(/_/g, ' ')}</dd></div>
            </dl>
          </section>

          <section aria-label="Record details">
            <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">Source record <Provenance kind="sourced" /></h4>
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <div><dt className="inline text-ink-soft">Source: </dt><dd className="inline"><SourceLink url={ref.canonicalUrl}>{SOURCE_LABEL[ref.source]} {ref.sourceRecordId}</SourceLink></dd></div>
              <div><dt className="inline text-ink-soft">Record updated: </dt><dd className="inline">{formatDate(record.sourceUpdatedAt)}</dd></div>
              <div><dt className="inline text-ink-soft">Retrieved: </dt><dd className="inline">{formatDate(record.retrievedAt)}</dd></div>
            </dl>
            {ids.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {ids.map(([k, v]) => (
                  <span key={k}><span className="text-ink-soft">{k}: </span><Tech value={String(v)} /></span>
                ))}
              </div>
            )}
            {record.classifications.map((c, i) => (
              <div key={i} className="mt-3 rounded-md border border-line p-2.5 text-xs">
                <div className="font-medium">{SCOPE_LABEL[c.scope]}: {c.label}</div>
                <div className="mt-0.5 text-ink-soft">{c.scopeNote}</div>
                <div className="mt-1">Review status: {c.reviewStatus ?? 'not stated'}{c.lastEvaluated ? ` · last evaluated ${formatDate(c.lastEvaluated)}` : ''}</div>
                {c.conditions && c.conditions.length > 0 && <div>Condition context: {c.conditions.join('; ')}</div>}
              </div>
            ))}
          </section>

          {evidence.length > 0 && (
            <section aria-label="Curated evidence">
              <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">CIViC evidence items ({evidence.length}) <Provenance kind="sourced" /></h4>
              <p className="mb-2 text-xs text-ink-soft">Curated statements from single publications. They describe study findings, not a recommendation for any individual.</p>
              <ul className="space-y-2">
                {evidence.slice(0, 12).map((e) => (
                  <li key={e.sourceRecordId} className="rounded-md border border-line p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <SourceLink url={e.canonicalUrl}>{e.sourceRecordId}</SourceLink>
                      <span>Level {e.evidenceLevel ?? 'n/a'}</span>
                      <span>{[e.evidenceType, e.evidenceDirection, e.significance].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="mt-1">{e.claimSummary}</div>
                    <div className="mt-1 text-ink-soft">
                      Disease: {e.disease ?? 'not stated'} · Origin: {e.variantOrigin ?? 'not stated'}
                      {e.therapies.length > 0 && ` · Therapies studied: ${e.therapies.join(', ')}`}
                    </div>
                    {e.pmids.length > 0 && (
                      <div className="mt-0.5 text-ink-soft">
                        PubMed: {e.pmids.map((p) => (
                          <span key={p} className="mr-2"><SourceLink url={`https://pubmed.ncbi.nlm.nih.gov/${p}/`}>{p}</SourceLink></span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {evidence.length > 12 && <p className="mt-1 text-xs text-ink-soft">…and {evidence.length - 12} more at the source.</p>}
            </section>
          )}

          <section aria-label="Assessment" className="space-y-2">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">Assessment, four separate questions <Provenance kind="computed" /></h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <Assess title="Match confidence" lead={assessment.matchConfidence.level.replace(/_/g, ' ') + ' level'} body={assessment.matchConfidence.explanation} />
              <Assess title="Evidence strength" lead={assessment.evidenceStrength.items.length ? `${assessment.evidenceStrength.items.length} source classification(s)` : 'none retrieved'} body={assessment.evidenceStrength.note} />
              <Assess title="Clinical relevance" lead="what the source says" body={[...assessment.clinicalRelevance.statements, assessment.clinicalRelevance.note].filter(Boolean).join(' ')} />
              <Assess title="Evidence completeness" lead={assessment.evidenceCompleteness.missing.length ? `${assessment.evidenceCompleteness.missing.length} gap(s)` : 'no gaps identified'} body={[...assessment.evidenceCompleteness.missing, assessment.evidenceCompleteness.note].filter(Boolean).join(' ')} />
            </div>
            <p className="text-[11px] text-ink-soft">These are kept separate on purpose. There is no combined score, and none of them is a probability of pathogenicity or treatment benefit.</p>
          </section>

          {record.limitations.length > 0 && (
            <section aria-label="Limitations">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">Limitations</h4>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-soft">{record.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </article>
  );
}

function Assess({ title, lead, body }: { title: string; lead: string; body: string }) {
  return (
    <div className="rounded-md bg-surface-alt p-2.5 text-xs">
      <div className="font-semibold">{title}</div>
      <div className="text-ink-soft">{lead}</div>
      <p className="mt-1">{body}</p>
    </div>
  );
}
