import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { investigationsApi } from '../services/api';

export function useInvestigationList(search: string) {
  return useQuery({
    queryKey: ['investigations', 'list', search],
    queryFn: () => investigationsApi.list(search.trim() || undefined),
  });
}

export function useInvestigation(id: string | undefined) {
  return useQuery({
    queryKey: ['investigations', 'detail', id],
    queryFn: () => investigationsApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useInvestigationMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['investigations'] });
  return {
    create: useMutation({ mutationFn: investigationsApi.create, onSuccess: refresh }),
    rename: useMutation({
      mutationFn: (v: { id: string; title: string }) => investigationsApi.rename(v.id, v.title),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: investigationsApi.remove, onSuccess: refresh }),
  };
}
