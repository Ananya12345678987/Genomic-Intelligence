import { useState } from 'react';
import { CircleAlert, CircleCheck, FileDown, Loader2, X } from 'lucide-react';
import type { SearchResult } from '../../types/research';
import { ApiError, downloadExport } from '../../services/api';

type State = { kind: 'idle' } | { kind: 'working'; format: 'pdf' | 'csv' } | { kind: 'done'; filename: string; bytes: number } | { kind: 'error'; message: string; format: 'pdf' | 'csv' };

/** Success is shown only after the server returned a non-empty file. */
export function ExportDialog({ investigationId, results, onClose }: { investigationId: string; results: SearchResult[]; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const run = async (format: 'pdf' | 'csv') => {
    setState({ kind: 'working', format });
    try {
      const r = await downloadExport(format, investigationId);
      setState({ kind: 'done', ...r });
    } catch (e) {
      setState({ kind: 'error', format, message: e instanceof ApiError ? e.message : 'The export could not be generated. Please try again.' });
    }
  };

  const findings = results.reduce((n, r) => n + r.findings.length, 0);
  const exact = results.reduce((n, r) => n + r.findings.filter((f) => f.decision.category === 'exact_normalized').length, 0);
  const pubs = results.reduce((n, r) => n + r.publications.length, 0);
  const trials = results.reduce((n, r) => n + r.trials.length, 0);
  const down = results.flatMap((r) => r.sourceStatuses).filter((s) => s.status === 'unavailable' || s.status === 'rate_limited').length;
  const working = state.kind === 'working';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" role="dialog" aria-modal="true" aria-labelledby="exp-title">
      <div className="card w-full max-w-md space-y-4 p-5 shadow-lift">
        <div className="flex items-start justify-between">
          <h2 id="exp-title" className="text-lg font-semibold">
            Export research report
          </h2>
          <button className="btn !p-1.5" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-soft">Preview of what will be included</p>
          <ul className="space-y-0.5 rounded-md bg-surface-alt p-3 text-sm">
            <li>{results.length} submitted finding{results.length === 1 ? '' : 's'}</li>
            <li>
              {findings} matched record{findings === 1 ? '' : 's'} ({exact} exact normalized)
            </li>
            <li>{pubs} publication{pubs === 1 ? '' : 's'}, {trials} clinical trial{trials === 1 ? '' : 's'}</li>
            <li>Source retrieval dates, match rationale, limitations and the scope statement</li>
          </ul>
          {down > 0 && <p className="mt-2 text-xs text-caution">{down} source search{down === 1 ? ' was' : 'es were'} unavailable; the report will say so.</p>}
          <p className="mt-2 text-xs text-ink-soft">The report is generated from this investigation&apos;s stored results. It supports research and review and is not a diagnosis or treatment recommendation.</p>
        </div>

        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" disabled={working} onClick={() => void run('pdf')}>
            {working && state.format === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />} PDF report
          </button>
          <button className="btn flex-1" disabled={working} onClick={() => void run('csv')}>
            {working && state.format === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />} CSV data
          </button>
        </div>

        <div aria-live="polite">
          {state.kind === 'done' && (
            <p className="flex items-center gap-2 rounded-md bg-pistachio/60 px-3 py-2 text-sm">
              <CircleCheck className="h-4 w-4 shrink-0" aria-hidden /> Downloaded {state.filename} ({Math.max(1, Math.round(state.bytes / 1024))} KB)
            </p>
          )}
          {state.kind === 'error' && (
            <p role="alert" className="flex items-start justify-between gap-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              <span className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {state.message}
              </span>
              <button className="underline" onClick={() => void run(state.format)}>
                Retry
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
