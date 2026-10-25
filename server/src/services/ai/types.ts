import type { VerifiedStatement } from './verify.js';

/** The narrative block shown above the evidence cards. */
export interface AnswerBlock {
  /** "ai": written by a model and verified against retrieved sources. "deterministic": assembled directly from records, no model. */
  mode: 'ai' | 'deterministic';
  provider: string | null;
  markdown: string;
  statements: VerifiedStatement[];
  removedCount: number;
  removedReasons: string[];
  /** Why AI was not used or what happened to it; shown to the user. */
  notice: string | null;
}
