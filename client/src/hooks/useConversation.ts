import { useQuery, useQueryClient } from '@tanstack/react-query';
import { chatApi } from '../services/api';
import type { StoredMessage } from '../types/research';

/** Server-backed message history for one investigation, with a local append that keeps the cache in step. */
export function useConversation(investigationId: string | undefined) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['messages', investigationId],
    queryFn: () => chatApi.messages(investigationId!),
    enabled: Boolean(investigationId),
    staleTime: 60_000,
    retry: 1,
  });

  const append = (invId: string, ...msgs: (StoredMessage | undefined)[]) => {
    const add = msgs.filter((m): m is StoredMessage => Boolean(m));
    qc.setQueryData<{ items: StoredMessage[] }>(['messages', invId], (old) => ({ items: [...(old?.items ?? []), ...add] }));
  };

  return {
    messages: q.data?.items ?? [],
    loading: q.isLoading && Boolean(investigationId),
    error: q.error as Error | null,
    refetch: q.refetch,
    append,
  };
}
