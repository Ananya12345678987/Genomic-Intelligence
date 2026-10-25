import { useEffect, useRef } from 'react';
import { CircleAlert, Info, Loader2, RotateCw } from 'lucide-react';
import type { StoredMessage } from '../../types/research';
import { Skeleton, Markdown } from '../evidence/small';
import { ResultsView } from '../evidence/ResultsView';
import { ExtractionReview } from '../variants/ExtractionReview';

export interface BusyState {
  label: string;
  progress?: number;
  /** The user's text, echoed immediately while the server works. */
  echo?: string;
}

interface Props {
  messages: StoredMessage[];
  busy: BusyState | null;
  error: { message: string; retry?: () => void } | null;
  loadError: string | null;
  onRetryLoad: () => void;
  onConfirm: (reportId: string, selections: { id: string; text?: string }[]) => void;
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-card bg-pistachio px-4 py-2.5 text-sm">
        <span className="sr-only">You: </span>
        {text}
      </p>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="card flex gap-3 border-dashed bg-butter/40 px-4 py-3 text-sm text-ink-soft">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <div className="text-xs font-medium uppercase tracking-wider">System notice</div>
        <p className="mt-0.5">{text}</p>
      </div>
    </div>
  );
}

export function MessageList({ messages, busy, error, loadError, onRetryLoad, onConfirm }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy, error]);

  // A review is "done" once any later assistant results message exists.
  const lastResultsAt = messages.reduce((acc, m, i) => (m.payload?.kind === 'results' ? i : acc), -1);
  const lastReviewAt = messages.reduce((acc, m, i) => (m.payload?.kind === 'extraction_review' ? i : acc), -1);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6" role="log" aria-live="polite">
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-card bg-danger-bg px-4 py-3 text-sm text-danger">
          <span className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4" aria-hidden /> Could not load this conversation. {loadError}
          </span>
          <button className="btn" onClick={onRetryLoad}>
            <RotateCw className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        </div>
      )}

      {messages.map((m, i) => {
        if (m.role === 'user') return <UserBubble key={m.id} text={m.content} />;
        if (m.role === 'notice') return <Notice key={m.id} text={m.content} />;
        if (m.payload?.kind === 'results') return <ResultsView key={m.id} payload={m.payload} />;
        if (m.payload?.kind === 'extraction_review') {
          return (
            <ExtractionReview
              key={m.id}
              payload={m.payload}
              done={i !== lastReviewAt || lastResultsAt > i}
              busy={Boolean(busy)}
              onConfirm={onConfirm}
            />
          );
        }
        return (
          <div key={m.id} className="card p-4">
            <Markdown>{m.content}</Markdown>
          </div>
        );
      })}

      {busy?.echo && <UserBubble text={busy.echo} />}
      {busy && (
        <div className="card space-y-2 p-4" role="status">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {busy.label}
            {typeof busy.progress === 'number' && <span className="text-ink-soft">{Math.round(busy.progress * 100)}%</span>}
          </div>
          {typeof busy.progress === 'number' ? (
            <div className="h-1.5 overflow-hidden rounded-pill bg-surface-alt" aria-hidden>
              <div className="h-full bg-pistachio-deep transition-[width]" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
            </div>
          ) : (
            <>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-danger-bg px-4 py-3 text-sm text-danger">
          <span className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden /> {error.message}
          </span>
          {error.retry && (
            <button className="btn" onClick={error.retry}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden /> Retry
            </button>
          )}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
