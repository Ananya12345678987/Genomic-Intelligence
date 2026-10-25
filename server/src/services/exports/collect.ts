import type { AnswerBlock } from '../ai/types.js';
import type { SearchResult } from '../../types/domain.js';

export interface ExportInvestigation {
  title: string;
  cancerContext: string | null;
  referenceGenome: string | null;
  transcriptId: string | null;
  createdAt: Date | string | null;
}

export interface ExportRound {
  results: SearchResult[];
  answer: AnswerBlock | null;
  createdAt: Date | string | null;
}

export interface ExportData {
  investigation: ExportInvestigation;
  rounds: ExportRound[];
  generatedAt: string;
}

interface StoredMessage {
  role: string;
  payload?: unknown;
  createdAt?: Date | string | null;
}

/** Pull stored result payloads out of conversation messages. Only data that was actually retrieved and saved is exported. */
export function collectRounds(messages: StoredMessage[]): ExportRound[] {
  const rounds: ExportRound[] = [];
  for (const m of messages) {
    const p = m.payload as { kind?: string; results?: SearchResult[]; answer?: AnswerBlock } | null | undefined;
    if (m.role === 'assistant' && p?.kind === 'results' && Array.isArray(p.results) && p.results.length) {
      rounds.push({ results: p.results, answer: p.answer ?? null, createdAt: m.createdAt ?? null });
    }
  }
  return rounds;
}
