import type { HealthResponse } from '../types/chat';
import type { AuthResponse, Investigation, Paged } from '../types/api';
import type { ChatContext, Settings, StoredMessage } from '../types/research';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The CSRF token lives only in memory (never localStorage). It is re-issued by
 * GET /auth/me on every page load, and the session itself is an HttpOnly cookie
 * that JavaScript cannot read.
 */
let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

/** Thin fetch wrapper: cookies for sessions, JSON in/out, consistent errors. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const getHealth = () => apiFetch<HealthResponse>('/health');

export const authApi = {
  me: () => apiFetch<AuthResponse>('/auth/me'),
  login: (email: string, password: string) =>
    apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: json({ email, password }) }),
  register: (input: { name: string; email: string; password: string; role: 'researcher' | 'clinician' }) =>
    apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: json(input) }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
  deleteAccount: (password: string) => apiFetch<void>('/auth/me', { method: 'DELETE', body: json({ password }) }),
};

export const investigationsApi = {
  list: (q?: string) =>
    apiFetch<Paged<Investigation>>(`/investigations?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  get: (id: string) => apiFetch<{ investigation: Investigation }>(`/investigations/${id}`),
  create: (body: Partial<Investigation> = {}) =>
    apiFetch<{ investigation: Investigation }>('/investigations', { method: 'POST', body: json(body) }),
  rename: (id: string, title: string) =>
    apiFetch<{ investigation: Investigation }>(`/investigations/${id}`, { method: 'PATCH', body: json({ title }) }),
  remove: (id: string) => apiFetch<void>(`/investigations/${id}`, { method: 'DELETE' }),
};

export interface TurnResponse {
  userMessage: StoredMessage;
  assistantMessage: StoredMessage;
  notices?: string[];
}

export const chatApi = {
  messages: (investigationId: string) => apiFetch<{ items: StoredMessage[] }>(`/investigations/${investigationId}/messages`),
  send: (investigationId: string, message: string, context?: ChatContext) =>
    apiFetch<TurnResponse>('/chat/message', { method: 'POST', body: json({ investigationId, message, context }) }),
};

export interface UploadedReport {
  reportId: string;
  pageCount: number;
  sizeBytes: number;
}

/** multipart upload via XMLHttpRequest, because fetch cannot report upload progress. */
export function uploadReport(file: File, investigationId: string | undefined, onProgress: (fraction: number) => void): Promise<UploadedReport> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/reports/upload`);
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'The upload could not be sent. Check your connection and try again.'));
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadedReport);
      else reject(new ApiError(xhr.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `Upload failed (${xhr.status})`));
    };
    const form = new FormData();
    if (investigationId) form.append('investigationId', investigationId);
    form.append('file', file);
    xhr.send(form);
  });
}

export const reportsApi = {
  extract: (reportId: string, investigationId?: string) =>
    apiFetch<{ reportId: string } & Partial<TurnResponse>>(`/reports/${reportId}/extract`, { method: 'POST', body: json({ investigationId }) }),
  confirm: (reportId: string, investigationId: string, selections: { id: string; text?: string }[], context?: ChatContext) =>
    apiFetch<TurnResponse>(`/reports/${reportId}/confirm-variants`, { method: 'POST', body: json({ investigationId, selections, context }) }),
};

/** Download a generated export. Resolves only when the server actually returned the file. */
export async function downloadExport(kind: 'pdf' | 'csv', investigationId: string): Promise<{ filename: string; bytes: number }> {
  const res = await fetch(`${BASE}/reports/export/${kind}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    body: json({ investigationId }),
  });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    let code = 'HTTP_ERROR';
    try {
      const b = await res.json();
      message = b?.error?.message ?? message;
      code = b?.error?.code ?? code;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code, message);
  }
  const blob = await res.blob();
  if (blob.size === 0) throw new ApiError(res.status, 'EMPTY_EXPORT', 'The server returned an empty file.');
  const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `export.${kind}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { filename, bytes: blob.size };
}

export const settingsApi = {
  get: () => apiFetch<{ settings: Settings }>('/settings'),
  patch: (body: Partial<{ aiSensitiveContentConsent: boolean }>) => apiFetch<{ settings: Settings }>('/settings', { method: 'PATCH', body: json(body) }),
};
