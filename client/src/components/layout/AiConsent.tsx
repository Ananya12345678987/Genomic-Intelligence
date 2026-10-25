import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../services/api';

/**
 * Consent for sending report-derived text to an external AI provider. Off by default.
 * It takes effect only if the operator has also allowed it in server configuration.
 */
export function AiConsent() {
  const qc = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, retry: 1 });
  const m = useMutation({
    mutationFn: (v: boolean) => settingsApi.patch({ aiSensitiveContentConsent: v }),
    onSuccess: (r) => qc.setQueryData(['settings'], r),
  });

  if (isError) return <p className="px-2.5 py-1.5 text-xs text-ink-soft">Settings could not be loaded.</p>;
  if (!data) return null;
  const { settings } = data;
  const blockedByOperator = !settings.ai.configured || !settings.ai.sensitiveContentAllowedByOperator;

  return (
    <div className="border-t border-line px-2.5 py-2 text-xs">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[#344536]"
          checked={settings.aiSensitiveContentConsent}
          disabled={m.isPending}
          onChange={(e) => m.mutate(e.target.checked)}
        />
        <span>
          <span className="font-medium">Allow report-derived text to be sent to the AI provider</span>
          <span className="mt-0.5 block text-ink-soft">
            Off by default. Gene and variant queries you type are handled separately from uploaded or pasted reports.
            {!settings.ai.configured
              ? ' No AI provider is configured on this server, so nothing is sent either way.'
              : blockedByOperator
                ? ' The server operator has not allowed this, so report text is still not sent.'
                : ''}
          </span>
        </span>
      </label>
      {m.isError && <p role="alert" className="mt-1 text-danger">Could not save this setting.</p>}
    </div>
  );
}
