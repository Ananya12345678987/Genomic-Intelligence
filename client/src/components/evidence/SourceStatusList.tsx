import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import type { SourceMeta } from '../../types/research';
import { SOURCE_LABEL, STATUS_LABEL, formatDate } from './labels';

/** Per-source outcome. An unavailable source is stated plainly; it is never replaced with other data. */
export function SourceStatusList({ items }: { items: SourceMeta[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
      {items.map((s, i) => {
        const bad = s.status === 'unavailable' || s.status === 'rate_limited' || s.status === 'unexpected_response';
        const Icon = bad ? CircleAlert : s.status === 'ok' ? CircleCheck : CircleDashed;
        return (
          <li key={`${s.source}-${i}`} className="flex items-start gap-2 rounded-md bg-surface-alt px-2.5 py-1.5">
            <Icon className={bad ? 'mt-0.5 h-3.5 w-3.5 shrink-0 text-caution' : 'mt-0.5 h-3.5 w-3.5 shrink-0'} aria-hidden />
            <div className="min-w-0">
              <div className="font-medium">
                {SOURCE_LABEL[s.source] ?? s.source}: {STATUS_LABEL[s.status]}
                {typeof s.total === 'number' && s.status === 'ok' ? ` (${s.total})` : ''}
              </div>
              <div className="text-ink-soft">
                Retrieved {formatDate(s.retrievedAt)}
                {s.fromCache ? ` · cached copy${s.cacheExpiresAt ? `, valid until ${formatDate(s.cacheExpiresAt)}` : ''}` : ''}
              </div>
              {s.message && <div className="text-ink-soft">{s.message}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
