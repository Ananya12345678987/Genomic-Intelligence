import type { Env } from '../../config/env.js';
import type { SourceBundle } from '../../adapters/types.js';
import type { AiProvider } from '../ai/provider.js';
import type { AnswerBlock } from '../ai/types.js';
import { buildAnswer } from '../ai/summarize.js';
import { searchEvidence } from '../evidence/search.js';
import { buildSourceIndex, publicIndex } from '../evidence/sourceIndex.js';
import type { ParsedVariant, ReferenceGenome, SearchContext, SearchResult, SourceIndexEntry } from '../../types/domain.js';
import type { ExtractedCandidate } from '../variant-normalization/index.js';
import { interpretMessage } from './intent.js';

export const SAFETY_NOTICE =
  'For research and evidence review only. This is not a diagnosis or a treatment recommendation. Interpretation belongs with qualified professionals who have the full clinical context.';

export interface OrchestratorDeps {
  env: Pick<Env, 'AI_ALLOW_SENSITIVE_CONTENT'>;
  sources: SourceBundle;
  ai: AiProvider | null;
}

export interface ChatContext {
  cancerType?: string | null;
  referenceGenome?: ReferenceGenome | null;
  transcriptId?: string | null;
}

export type CitationRef = { refId: string; source: string; sourceRecordId: string; canonicalUrl: string; verified: boolean };

export type AssistantPayload =
  | {
      kind: 'results';
      results: SearchResult[];
      answer: AnswerBlock;
      index: ReturnType<typeof publicIndex>;
      safetyNotice: string;
    }
  | {
      kind: 'extraction_review';
      reportId: string | null;
      candidates: ReviewCandidate[];
      context: SearchContext;
      pageCount: number | null;
      notice: string;
    };

/** What the browser needs to review an extracted finding. The surrounding report text is never included. */
export interface ReviewCandidate {
  id: string;
  text: string;
  status: ExtractedCandidate['status'];
  warnings: string[];
  selected: boolean;
  geneSymbol: string | null;
  hgvsProtein: string | null;
  hgvsCoding: string | null;
  hgvsGenomic: string | null;
  transcriptId: string | null;
  referenceGenome: ReferenceGenome | null;
  chromosome: string | null;
  position: number | null;
  referenceAllele: string | null;
  alternateAllele: string | null;
  rsId: string | null;
  normalizationStatus: string;
}

export function toReviewCandidate(c: ExtractedCandidate): ReviewCandidate {
  const p = c.parsed;
  return {
    id: c.id,
    text: c.text,
    status: c.status,
    warnings: c.warnings,
    selected: c.selected,
    geneSymbol: p.geneSymbol,
    hgvsProtein: p.hgvsProtein,
    hgvsCoding: p.hgvsCoding,
    hgvsGenomic: p.hgvsGenomic,
    transcriptId: p.transcriptId,
    referenceGenome: p.referenceGenome,
    chromosome: p.chromosome,
    position: p.position,
    referenceAllele: p.referenceAllele,
    alternateAllele: p.alternateAllele,
    rsId: p.rsId,
    normalizationStatus: p.normalizationStatus,
  };
}

export type TurnOutcome =
  | { role: 'assistant'; content: string; payload: AssistantPayload; citations: CitationRef[]; candidates?: ExtractedCandidate[]; detectedCancerType: string | null; submittedVariants: ParsedVariant[]; fresh: boolean }
  | { role: 'notice'; content: string; payload: null; citations: []; detectedCancerType: string | null; submittedVariants: [] };

/** Citation records for every source id that the answer text actually links to. */
export function citationsFor(markdown: string, index: SourceIndexEntry[]): CitationRef[] {
  const used = new Set([...markdown.matchAll(/\[(S\d{1,4})\]\(/g)].map((m) => m[1]!));
  return index
    .filter((e) => used.has(e.id))
    .map((e) => ({ refId: e.id, source: e.source, sourceRecordId: e.sourceRecordId, canonicalUrl: e.url, verified: true }));
}

/** Run searches for already-chosen variants and build the verified answer. */
export async function runSearches(
  deps: OrchestratorDeps,
  variants: ParsedVariant[],
  ctx: SearchContext,
  opts: { reportDerived: boolean; userConsent: boolean; publicationsFocus?: boolean; question?: string | null },
): Promise<{ results: SearchResult[]; answer: AnswerBlock; index: SourceIndexEntry[] }> {
  const results: SearchResult[] = [];
  // Sequential on purpose: NCBI limits requests per IP, and each search already fans out in parallel.
  for (const v of variants) {
    results.push(await searchEvidence(deps.sources, v, ctx, { includeTrials: !opts.publicationsFocus }));
  }
  const index = buildSourceIndex(results);
  const answer = await buildAnswer({
    env: deps.env,
    provider: deps.ai,
    results,
    index,
    question: opts.question ?? null,
    reportDerived: opts.reportDerived,
    userConsent: opts.userConsent,
  });
  return { results, answer, index };
}

export function resultsOutcome(
  results: SearchResult[],
  answer: AnswerBlock,
  index: SourceIndexEntry[],
  detectedCancerType: string | null,
  fresh: boolean,
): TurnOutcome {
  const payload: AssistantPayload = { kind: 'results', results, answer, index: publicIndex(index), safetyNotice: SAFETY_NOTICE };
  return {
    role: 'assistant',
    content: answer.markdown.slice(0, 19000),
    payload,
    citations: citationsFor(answer.markdown, index),
    detectedCancerType,
    submittedVariants: results.map((r) => r.submitted),
    fresh,
  };
}

export interface TurnInput {
  message: string;
  context: ChatContext;
  /** Results from earlier in this investigation, used for follow-up questions. */
  priorResults: SearchResult[];
  userConsent: boolean;
}

/**
 * One chat turn. Order matters: structured extraction and retrieval come first; the model (if any)
 * only ever sees retrieved records, and only verified statements survive.
 */
export async function handleTurn(deps: OrchestratorDeps, input: TurnInput): Promise<TurnOutcome> {
  const intent = interpretMessage(input.message, {
    referenceGenome: input.context.referenceGenome ?? null,
    transcriptId: input.context.transcriptId ?? null,
    hasPriorResults: input.priorResults.length > 0,
  });

  if (intent.kind === 'clarify') {
    return { role: 'notice', content: intent.message, payload: null, citations: [], detectedCancerType: null, submittedVariants: [] };
  }

  const cancerType = input.context.cancerType ?? (intent.kind === 'followup' ? null : intent.cancerType);
  const ctx: SearchContext = {
    cancerType,
    referenceGenome: input.context.referenceGenome ?? null,
    transcriptId: input.context.transcriptId ?? null,
  };

  if (intent.kind === 'report_review') {
    const found = intent.candidates.length;
    const payload: AssistantPayload = {
      kind: 'extraction_review',
      reportId: null, // assigned by the controller when the review is registered
      candidates: intent.candidates.map(toReviewCandidate),
      context: ctx,
      pageCount: null,
      notice: found
        ? `Found ${found} candidate finding${found === 1 ? '' : 's'} by pattern matching. Review, correct and select the ones to investigate. Nothing has been searched yet, and the pasted text was not stored.`
        : 'No gene or variant notation was recognized in the pasted text. Nothing was searched, and the text was not stored. Try entering a finding directly, for example "BRAF p.Val600Glu".',
    };
    return {
      role: 'assistant',
      content: found ? `Extracted ${found} candidate finding${found === 1 ? '' : 's'} for your review.` : 'No findings were recognized in the pasted text.',
      payload,
      citations: [],
      candidates: intent.candidates,
      detectedCancerType: cancerType,
      submittedVariants: [],
      fresh: false,
    };
  }

  if (intent.kind === 'followup') {
    const index = buildSourceIndex(input.priorResults);
    const answer = await buildAnswer({
      env: deps.env,
      provider: deps.ai,
      results: input.priorResults,
      index,
      question: intent.question,
      reportDerived: false,
      userConsent: input.userConsent,
    });
    if (answer.mode === 'deterministic') {
      answer.notice = answer.notice
        ? `${answer.notice} Follow-up questions are answered only when AI summarization is available; the summary above restates the retrieved records.`
        : 'Follow-up questions are answered only when AI summarization is available; the summary above restates the retrieved records.';
    }
    return resultsOutcome(input.priorResults, answer, index, null, false);
  }

  const { results, answer, index } = await runSearches(deps, intent.variants, ctx, {
    reportDerived: false,
    userConsent: input.userConsent,
    publicationsFocus: intent.publicationsFocus,
  });
  return resultsOutcome(results, answer, index, cancerType, true);
}
