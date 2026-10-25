/**
 * "notice" messages come from the application itself (status, limitations),
 * never from a model, so they are styled and labelled distinctly.
 */
export type ChatMessage =
  | { id: string; role: 'user'; content: string; createdAt: string }
  | { id: string; role: 'notice'; content: string; createdAt: string };

export interface HealthResponse {
  status: 'ok' | 'degraded';
  time: string;
  database: 'connected' | 'connecting' | 'disconnected';
  ai: { configured: boolean; provider: string; sensitiveContentAllowed?: boolean };
  sources: Record<string, string>;
}
