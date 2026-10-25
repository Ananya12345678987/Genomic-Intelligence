import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { AnswerBlock, AssistantPayload, ParsedVariant, SearchResult } from '../../types/research';
import { NORMALIZATION_LABEL } from './labels';
import { MatchCard } from './MatchCard';
import { PublicationList } from './PublicationList';
import { SourceStatusList } from './SourceStatusList';
import { TrialList } from './TrialList';
import { Markdown, Provenance, Tech } from './small';

type ResultsPayload = Extract<AssistantPayload, { kind: 'results' }>;

function Section({ title, count, children, defaultOpen = false }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-card border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {typeof count === 'number' && <span className="ml-2 rounded-pill bg-surface-alt px-2 py-0.5 text-[11px] font-normal">{count}</span>}
        </span>
        <span className="text-xs text-ink-soft group-open:hidden">Show</span>
        <span className="hidden text-xs text-ink-soft group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-line px-4 py-3">{children}</div>
    </details>
  );
}

function Answer({ answer }: { answer: AnswerBlock }) {
  return (
    <section aria-label="Summary" className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Provenance kind={answer.mode === 'ai' ? 'ai' : 'computed'} />
        {answer.mode === 'ai' && answer.provider && <span className="text-[11px] text-ink-soft">via {answer.provider}</span>}
      </div>
      {answer.notice && <p className="mb-2 rounded-md bg-butter/60 px-3 py-2 text-xs">{answer.notice}</p>}
      <Markdown>{answer.markdown}</Markdown>
      {answer.removedCount > 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          {answer.removedCount} AI statement{answer.removedCount === 1 ? ' was' : 's were'} removed because the citation could not be verified against retrieved records.
        </p>
      )}
    </section>
  );
}

function Submitted({ v }: { v: ParsedVariant }) {
  const rows: [string, string | number | null][] = [
    ['Gene', v.geneSymbol],
    ['Protein', v.hgvsProtein],
    ['Coding', v.hgvsCoding],
    ['Genomic', v.hgvsGenomic],
    ['Assembly', v.referenceGenome],
    ['Transcript', v.transcriptId],
    ['Position', v.chromosome && v.position ? `${v.chromosome}:${v.position}` : null],
    ['Alleles', v.referenceAllele && v.alternateAllele ? `${v.referenceAllele}>${v.alternateAllele}` : null],
    ['dbSNP', v.rsId],
  ];
  const present = rows.filter((r): r is [string, string | number] => r[1] !== null && r[1] !== '');
  return (
    <div className="rounded-md bg-surface-alt p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Submitted finding</span>
        <Provenance kind="unverified" />
        <span className="rounded-pill bg-surface px-2 py-0.5">{NORMALIZATION_LABEL[v.normalizationStatus] ?? v.normalizationStatus}</span>
        {v.geneSymbol && !v.geneRecognized && <span className="text-caution">Gene symbol not recognized</span>}
      </div>
      <div className="mt-1 break-words text-ink-soft">
        As entered: <code className="tech">{v.sourceRepresentation}</code>
      </div>
      {present.length > 0 && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {present.map(([k, val]) => (
            <div key={k} className="flex flex-wrap items-center gap-1">
              <dt className="text-ink-soft">{k}:</dt>
              <dd>
                <Tech value={String(val)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {v.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-caution">
          {v.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {v.missing.length > 0 && (
        <p className="mt-2">
          <span className="font-medium">Information that would improve the search: </span>
          {v.missing.join('; ')}
        </p>
      )}
    </div>
  );
}

function OneResult({ r }: { r: SearchResult }) {
  const exact = r.findings.filter((f) => f.decision.category === 'exact_normalized' || f.decision.category === 'equivalent_representation');
  const other = r.findings.filter((f) => !exact.includes(f));
  return (
    <div className="space-y-3">
      <Submitted v={r.submitted} />

      {r.findings.length === 0 ? (
        <div className="rounded-card border border-dashed border-line p-4 text-sm">
          <p className="font-medium">No matching database records were found.</p>
          <p className="mt-1 text-xs text-ink-soft">
            This does not mean the variant is unreported; it means these searches returned nothing usable. A reference genome, a transcript, or genomic coordinates, and the
            cancer type, can make a search more specific. Check the source status below in case a source was unavailable.
          </p>
        </div>
      ) : (
        <>
          {exact.length > 0 && (
            <section aria-label="Exact and equivalent matches" className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Exact and equivalent matches ({exact.length})</h3>
              {exact.map((f, i) => (
                <MatchCard key={f.id} finding={f} defaultOpen={i === 0} />
              ))}
            </section>
          )}
          {other.length > 0 && (
            <section aria-label="Related findings" className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Related findings ({other.length}) <span className="font-normal normal-case tracking-normal">not the submitted variant</span>
              </h3>
              {other.map((f) => (
                <MatchCard key={f.id} finding={f} />
              ))}
            </section>
          )}
        </>
      )}

      <Section title="Publications" count={r.publications.length}>
        <PublicationList items={r.publications} />
      </Section>
      <Section title="Clinical trials" count={r.trials.length}>
        <TrialList items={r.trials} />
      </Section>
      <Section title="Sources searched" count={r.sourceStatuses.length}>
        <SourceStatusList items={r.sourceStatuses} />
      </Section>
      {r.notices.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-soft">
          {r.notices.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ResultsView({ payload }: { payload: ResultsPayload }) {
  return (
    <div className="space-y-4">
      <Answer answer={payload.answer} />
      {payload.results.map((r, i) => (
        <div key={i} className="space-y-3">
          {payload.results.length > 1 && <h2 className="text-sm font-semibold">Finding {i + 1}</h2>}
          <OneResult r={r} />
        </div>
      ))}
      <p className="flex items-start gap-2 text-[11px] text-ink-soft">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{payload.safetyNotice}</span>
      </p>
    </div>
  );
}
