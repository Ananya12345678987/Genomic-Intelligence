import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { useHealth } from '../../hooks/useHealth';

/** Honest system status. Icon + text, never colour alone. */
export function StatusPill() {
  const { data, isLoading, isError, refetch } = useHealth();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-soft" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking services…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <button
        onClick={() => void refetch()}
        className="flex items-center gap-2 rounded-md bg-danger-bg px-2 py-1 text-xs text-danger"
      >
        <CircleAlert className="h-3.5 w-3.5" aria-hidden /> Server unreachable. Retry
      </button>
    );
  }

  const ok = data.status === 'ok';
  return (
    <div className="space-y-1 text-xs text-ink-soft" role="status">
      <div className="flex items-center gap-2">
        {ok ? (
          <CircleCheck className="h-3.5 w-3.5 text-ink" aria-hidden />
        ) : (
          <CircleAlert className="h-3.5 w-3.5 text-caution" aria-hidden />
        )}
        <span>{ok ? 'Server and database online' : `Database ${data.database}`}</span>
      </div>
      <div className="pl-5">
        AI summaries: {data.ai.configured ? `enabled (${data.ai.provider})` : 'not configured'}
      </div>
    </div>
  );
}
