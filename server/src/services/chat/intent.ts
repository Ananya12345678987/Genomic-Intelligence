import type { ParsedVariant, ReferenceGenome } from '../../types/domain.js';
import { KNOWN_ONCOLOGY_GENES, extractCandidates, parseVariantInput, type ExtractedCandidate } from '../variant-normalization/index.js';

/** Pasted text longer than this is treated as a report: extracted and reviewed before any search. */
export const REPORT_TEXT_THRESHOLD = 600;
export const MAX_VARIANTS_PER_MESSAGE = 4;

export type Intent =
  | { kind: 'report_review'; candidates: ExtractedCandidate[]; cancerType: string | null }
  | { kind: 'search'; variants: ParsedVariant[]; cancerType: string | null; publicationsFocus: boolean }
  | { kind: 'followup'; question: string }
  | { kind: 'clarify'; message: string };

const CANCER_PATTERN =
  /\b((?:[a-z][a-z-]*\s){0,2}(?:cancer|carcinoma|adenocarcinoma|leuk(?:a)?emia|lymphoma|sarcoma|glioma|glioblastoma|myeloma|melanoma|neuroblastoma|mesothelioma)|nsclc|sclc|aml|cml|cll|gist)\b/i;
const FILLER = new Set(['in', 'of', 'for', 'with', 'and', 'the', 'a', 'an', 'to', 'on', 'variants', 'variant', 'evidence', 'associated', 'find', 'investigate', 'search', 'compare', 'about']);

/**
 * Pull a cancer-type phrase out of free text. Conservative: returns null when unsure, and the
 * result is only used as search context shown to the user, never as a finding.
 */
export function detectCancerType(text: string): string | null {
  const m = CANCER_PATTERN.exec(text);
  if (!m) return null;
  const words = m[1]!.trim().split(/\s+/).filter((w, i, arr) => !(FILLER.has(w.toLowerCase()) && i < arr.length - 1));
  // Drop leading fillers that survived (e.g. "in lung cancer" -> "lung cancer").
  while (words.length > 1 && FILLER.has(words[0]!.toLowerCase())) words.shift();
  const phrase = words.join(' ').slice(0, 80);
  return /^[a-z]{2,5}$/i.test(phrase) ? phrase.toUpperCase() : phrase.toLowerCase();
}

function geneTokens(text: string): string[] {
  const found: string[] = [];
  for (const tok of text.toUpperCase().match(/\b[A-Z][A-Z0-9-]{1,14}\b/g) ?? []) {
    if (KNOWN_ONCOLOGY_GENES.has(tok) && !found.includes(tok)) found.push(tok);
  }
  return found;
}

const PUBLICATION_WORDS = /\b(publications?|papers?|literature|pubmed|articles?|studies)\b/i;

export interface InterpretOptions {
  referenceGenome?: ReferenceGenome | null;
  transcriptId?: string | null;
  /** True when earlier results exist in this investigation, so a question can refer to them. */
  hasPriorResults: boolean;
}

/**
 * Decide what a chat message is asking for. Deterministic pattern matching only; no model is
 * involved in extracting findings from user input.
 */
export function interpretMessage(text: string, opts: InterpretOptions): Intent {
  const clean = text.trim();
  const ctx = { referenceGenome: opts.referenceGenome ?? null };
  const cancerType = detectCancerType(clean);

  if (clean.length > REPORT_TEXT_THRESHOLD) {
    const candidates = extractCandidates(clean, ctx);
    return { kind: 'report_review', candidates, cancerType };
  }

  const candidates = extractCandidates(clean, ctx).filter((c) => c.parsed.normalizationStatus !== 'identifier_only' || c.parsed.rsId);
  const publicationsFocus = PUBLICATION_WORDS.test(clean);
  if (candidates.length) {
    const variants = candidates.slice(0, MAX_VARIANTS_PER_MESSAGE).map((c) => withContext(c.parsed, opts));
    return { kind: 'search', variants, cancerType, publicationsFocus };
  }

  // Direct notation that the candidate extractor does not frame (e.g. a bare "BRAF p.Val600Glu" is
  // covered above; this handles a lone coordinate or HGVS string with context).
  const direct = parseVariantInput(clean, { referenceGenome: opts.referenceGenome ?? null, transcriptId: opts.transcriptId ?? null });
  if (direct.normalizationStatus !== 'unresolved' && direct.normalizationStatus !== 'gene_only' && direct.normalizationStatus !== 'ambiguous') {
    return { kind: 'search', variants: [withContext(direct, opts)], cancerType, publicationsFocus };
  }

  const genes = geneTokens(clean);
  const asksFollowup = opts.hasPriorResults && (genes.length === 0 || /\b(why|how|what|which|explain|compare|difference|differ|more|tell|that|this|those|these|it)\b/i.test(clean));
  if (asksFollowup && !(genes.length && /\b(search|find|investigate|look up|evidence for)\b/i.test(clean))) {
    return { kind: 'followup', question: clean };
  }

  if (genes.length) {
    const variants = genes.slice(0, MAX_VARIANTS_PER_MESSAGE).map((g) => withContext(parseVariantInput(g), opts));
    return { kind: 'search', variants, cancerType, publicationsFocus };
  }

  return {
    kind: 'clarify',
    message: publicationsFocus
      ? 'Which gene (and optionally cancer type) should I search publications for? For example: "Search publications for KRAS in pancreatic cancer."'
      : 'I could not find a gene symbol or variant notation in that message. Enter a gene (for example BRAF), a variant (for example BRAF p.Val600Glu or NM_004333.6:c.1799T>A), paste report text, or attach a PDF report.',
  };
}

function withContext(v: ParsedVariant, opts: InterpretOptions): ParsedVariant {
  // Never invent context: only fill a field the user explicitly provided and the notation left empty.
  const out = { ...v };
  if (!out.referenceGenome && opts.referenceGenome) out.referenceGenome = opts.referenceGenome;
  if (!out.transcriptId && opts.transcriptId) out.transcriptId = opts.transcriptId;
  return out;
}
