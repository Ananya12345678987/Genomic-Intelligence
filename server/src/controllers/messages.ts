import type { Types } from 'mongoose';
import { ConversationMessage, UserSettings } from '../models/index.js';
import type { SearchResult } from '../types/domain.js';
import type { AssistantPayload, CitationRef } from '../services/chat/orchestrator.js';

export const REDACTED_REPORT_NOTE = (chars: number) => `[Pasted report text (${chars.toLocaleString('en-US')} characters) was processed and not stored.]`;

interface StoredMessageLike {
  _id: unknown;
  role: string;
  content: string;
  payload?: unknown;
  citationReferences?: unknown;
  createdAt?: Date;
}

export const presentMessage = (m: StoredMessageLike) => ({
  id: String(m._id),
  role: m.role,
  content: m.content,
  payload: m.payload ?? null,
  citationReferences: m.citationReferences ?? [],
  createdAt: m.createdAt,
});

export async function saveUserMessage(investigationId: Types.ObjectId, content: string) {
  return ConversationMessage.create({ investigationId, role: 'user', content: content.slice(0, 20000) });
}

export async function saveAssistantMessage(
  investigationId: Types.ObjectId,
  role: 'assistant' | 'notice',
  content: string,
  payload: AssistantPayload | null,
  citations: CitationRef[],
) {
  // `content` is required by the schema, so an empty summary must not silently fail the save.
  return ConversationMessage.create({ investigationId, role, content: content.slice(0, 20000) || 'Search completed.', payload, citationReferences: citations });
}

/** Results from the most recent search in this investigation, for follow-up questions. */
export async function loadPriorResults(investigationId: Types.ObjectId): Promise<SearchResult[]> {
  const m = await ConversationMessage.findOne({ investigationId, role: 'assistant', 'payload.kind': 'results' })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  const p = m?.payload as { results?: SearchResult[] } | null | undefined;
  return Array.isArray(p?.results) ? p.results : [];
}

export async function userHasAiConsent(userId: Types.ObjectId): Promise<boolean> {
  const s = await UserSettings.findOne({ userId }).select('aiSensitiveContentConsent').lean();
  return s?.aiSensitiveContentConsent === true;
}
