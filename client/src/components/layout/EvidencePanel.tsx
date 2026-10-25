import { FileDown, FlaskConical } from 'lucide-react';
import type { SearchResult } from '../../types/research';
import { CATEGORY_LABEL, formatDate } from '../evidence/labels';
import { SourceStatusList } from '../evidence/SourceStatusList';
import { SourceLink } from '../evidence/small';

/** Investigation overview. Mounted only once results exist; details stay in the conversation cards. */
export function EvidencePanel({ results, onExport }: { results: SearchResult[]; onExport: () => void }) {
  const findings = results.flatMap((r) => r.findings);
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.decision.category, (counts.get(f.decision.category) ?? 0) + 1);
  const pubs = results.flatMap((r) => r.publications);
  const uniquePubs = [...new Map(pubs.map((p) => [p.pmid, p])).values()];
  const trials = [...new Map(results.flatMap((r) => r.trials).map((t) => [t.nctId, t])).values()];
  const statuses = results.flatMap((r) => r.sourceStatuses);
  const latest = results.map((r) => r.retrievedAt).sort().at(-1);

  return (
    <aside className="hidden h-full w-[360px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface-alt p-4 xl:flex" aria-label="Investigation overview">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FlaskConical className="h-4 w-4" aria-hidden /> Investigation overview
        </div>
        <button className="btn !px-2.5 !py-1.5 text-xs" onClick={onExport}>
          <FileDown className="h-3.5 w-3.5" aria-hidden /> Export
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">Latest retrieval {formatDate(latest)}</p>

      <section className="card mt-4 p-3 text-xs">
        <h3 className="mb-1.5 font-semibold">Match categories</h3>
        {counts.size === 0 ? (
          <p className="text-ink-soft">No matched records.</p>
        ) : (
          <ul className="space-y-0.5">
            {[...counts.entries()].map(([k, n]) => (
              <li key={k} className="flex justify-between gap-2">
                <span>{CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k}</span>
                <span className="tech">{n}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-ink-soft">Categories are not interchangeable: only an exact normalized match refers to the submitted variant.</p>
      </section>

      <section className="card mt-3 p-3 text-xs">
        <h3 className="mb-1.5 font-semibold">Sources searched</h3>
        <SourceStatusList items={statuses} />
      </section>

      <section className="card mt-3 p-3 text-xs">
        <h3 className="mb-1.5 font-semibold">Publications ({uniquePubs.length})</h3>
        <ul className="space-y-1.5">
          {uniquePubs.slice(0, 6).map((p) => (
            <li key={p.pmid}>
              <SourceLink url={p.canonicalUrl}>{p.title}</SourceLink>
            </li>
          ))}
        </ul>
        {uniquePubs.length > 6 && <p className="mt-1 text-ink-soft">{uniquePubs.length - 6} more in the conversation.</p>}
      </section>

      <section className="card mt-3 p-3 text-xs">
        <h3 className="mb-1.5 font-semibold">Clinical trials ({trials.length})</h3>
        <ul className="space-y-1.5">
          {trials.slice(0, 6).map((t) => (
            <li key={t.nctId}>
              <SourceLink url={t.canonicalUrl}>{t.nctId}</SourceLink> <span className="text-ink-soft">{t.status ?? 'status not stated'}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-ink-soft">A shared biomarker does not establish trial eligibility.</p>
      </section>
    </aside>
  );
}
