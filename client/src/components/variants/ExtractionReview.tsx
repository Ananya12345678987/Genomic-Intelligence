import { useState } from 'react';
import { CircleAlert, CircleCheck, FileSearch, Loader2 } from 'lucide-react';
import type { AssistantPayload } from '../../types/research';
import { NORMALIZATION_LABEL } from '../evidence/labels';
import { Provenance } from '../evidence/small';

type ReviewPayload = Extract<AssistantPayload, { kind: 'extraction_review' }>;

interface Props {
  payload: ReviewPayload;
  /** True once these findings were already investigated or the review is no longer the active step. */
  done: boolean;
  busy: boolean;
  onConfirm: (reportId: string, selections: { id: string; text?: string }[]) => void;
}

/** Extracted findings are guesses from text patterns. Nothing is searched until the user confirms. */
export function ExtractionReview({ payload, done, busy, onConfirm }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(payload.candidates.map((c) => [c.id, c.selected])));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);

  const chosen = payload.candidates.filter((c) => selected[c.id]);
  const uncertain = chosen.some((c) => c.status === 'needs_review' || (edits[c.id] !== undefined && edits[c.id] !== c.text));
  const canGo = !done && !busy && Boolean(payload.reportId) && chosen.length > 0 && (!uncertain || acknowledged);

  return (
    <section aria-label="Extracted findings review" className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileSearch className="h-4 w-4" aria-hidden />
        <h2 className="text-sm font-semibold">Review extracted findings</h2>
        <Provenance kind="unverified" />
      </div>
      <p className="text-xs text-ink-soft">{payload.notice}</p>

      {payload.candidates.length > 0 && (
        <ul className="space-y-2">
          {payload.candidates.map((c) => {
            const text = edits[c.id] ?? c.text;
            const ids = [c.geneSymbol && `gene ${c.geneSymbol}`, c.hgvsProtein, c.hgvsCoding, c.hgvsGenomic, c.transcriptId, c.referenceGenome, c.rsId].filter(Boolean) as string[];
            return (
              <li key={c.id} className="rounded-md border border-line p-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[#344536]"
                    checked={Boolean(selected[c.id])}
                    disabled={done}
                    onChange={(e) => setSelected((s) => ({ ...s, [c.id]: e.target.checked }))}
                    aria-label={`Investigate ${c.text}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`cand-${c.id}`}>
                        Finding text (editable)
                      </label>
                      <input
                        id={`cand-${c.id}`}
                        value={text}
                        disabled={done}
                        onChange={(e) => setEdits((s) => ({ ...s, [c.id]: e.target.value }))}
                        className="tech min-w-[10rem] flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-sm"
                      />
                      {c.status === 'recognized' ? (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-pistachio/70 px-2 py-0.5 font-medium">
                          <CircleCheck className="h-3 w-3" aria-hidden /> Recognized
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-caution-bg px-2 py-0.5 font-medium text-caution">
                          <CircleAlert className="h-3 w-3" aria-hidden /> Needs review
                        </span>
                      )}
                    </div>
                    <div className="text-ink-soft">
                      {NORMALIZATION_LABEL[c.normalizationStatus] ?? c.normalizationStatus}
                      {ids.length > 0 && ` · ${ids.join(' · ')}`}
                    </div>
                    {c.warnings.length > 0 && (
                      <ul className="list-disc space-y-0.5 pl-5 text-caution">
                        {c.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {uncertain && !done && (
        <label className="flex items-start gap-2 rounded-md bg-butter/60 px-3 py-2 text-xs">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#344536]" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>I have checked the uncertain or edited findings against the original report.</span>
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canGo}
          onClick={() =>
            payload.reportId &&
            onConfirm(
              payload.reportId,
              chosen.map((c) => (edits[c.id] !== undefined && edits[c.id] !== c.text ? { id: c.id, text: edits[c.id] } : { id: c.id })),
            )
          }
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Investigate {chosen.length} selected finding{chosen.length === 1 ? '' : 's'}
        </button>
        {done && <span className="text-xs text-ink-soft">Already investigated or superseded.</span>}
      </div>
    </section>
  );
}
