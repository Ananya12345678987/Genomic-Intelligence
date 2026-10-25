import type { TrialRecord } from '../../types/research';
import { formatDate } from './labels';
import { SourceLink } from './small';

/** Statuses are shown exactly as the registry reports them, only de-shouted for reading. */
const statusText = (s: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'Status not stated');

export function TrialList({ items }: { items: TrialRecord[] }) {
  return (
    <div className="space-y-2">
      <p className="rounded-md bg-butter/60 px-3 py-2 text-xs">
        A trial that mentions the same gene, variant or cancer type does <strong>not</strong> mean a patient is eligible. Eligibility is set by each
        trial&apos;s full criteria and the study team. Trial status changes; check the registry record.
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-ink-soft">No trials were returned for this search.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.nctId} className="rounded-md border border-line p-3 text-xs">
              <div className="text-sm font-medium leading-snug">
                <SourceLink url={t.canonicalUrl}>{t.briefTitle ?? t.title}</SourceLink>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                <code className="tech">{t.nctId}</code>
                <span>
                  <span className="text-ink-soft">Registry status: </span>
                  <strong>{statusText(t.status)}</strong>
                </span>
                <span className="text-ink-soft">Record updated {formatDate(t.sourceUpdatedAt)}</span>
                <span className="text-ink-soft">Retrieved {formatDate(t.retrievedAt)}</span>
              </div>
              {t.briefTitle && t.title !== t.briefTitle && <div className="mt-1 text-ink-soft">Official title: {t.title}</div>}
              <div className="mt-1">
                <span className="text-ink-soft">Conditions: </span>
                {t.conditions.join('; ') || 'not stated'}
              </div>
              <div>
                <span className="text-ink-soft">Interventions: </span>
                {t.interventions.join('; ') || 'not stated'}
              </div>
              {t.eligibilitySummary && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer font-medium">Eligibility text from the registry</summary>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-ink-soft">{t.eligibilitySummary}</p>
                </details>
              )}
              {t.locations.length > 0 && (
                <div className="mt-1 text-ink-soft">
                  Locations (first {Math.min(t.locations.length, 5)}): {t.locations.slice(0, 5).join(' · ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
