import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, authApi, setCsrfToken } from '../services/api';
import type { AuthResponse, User } from '../types/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; role: 'researcher' | 'clinician' }) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async (): Promise<AuthResponse | null> => {
      try {
        const res = await authApi.me();
        setCsrfToken(res.csrfToken);
        return res;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null; // not signed in
        throw e;
      }
    },
    retry: false,
    staleTime: Infinity,
  });

  const accept = useCallback(
    (res: AuthResponse) => {
      setCsrfToken(res.csrfToken);
      qc.setQueryData(['auth', 'me'], res);
    },
    [qc],
  );

  const clear = useCallback(() => {
    setCsrfToken(null);
    qc.setQueryData(['auth', 'me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' && q.queryKey[0] !== 'health' });
  }, [qc]);

  const loginM = useMutation({ mutationFn: (v: { email: string; password: string }) => authApi.login(v.email, v.password), onSuccess: accept });
  const registerM = useMutation({ mutationFn: authApi.register, onSuccess: accept });
  const logoutM = useMutation({ mutationFn: authApi.logout, onSettled: clear });
  const deleteM = useMutation({ mutationFn: authApi.deleteAccount, onSuccess: clear });

  const value = useMemo<AuthState>(
    () => ({
      user: meQuery.data?.user ?? null,
      loading: meQuery.isLoading,
      login: async (email, password) => void (await loginM.mutateAsync({ email, password })),
      register: async (input) => void (await registerM.mutateAsync(input)),
      logout: async () => void (await logoutM.mutateAsync()),
      deleteAccount: async (password) => void (await deleteM.mutateAsync(password)),
    }),
    [meQuery.data, meQuery.isLoading, loginM, registerM, logoutM, deleteM],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
