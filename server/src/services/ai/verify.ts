import { z } from 'zod';
import type { SourceIndexEntry } from '../../types/domain.js';

export const aiOutputSchema = z.object({
  statements: z
    .array(
      z.object({
        text: z.string().min(3).max(800),
        citations: z.array(z.string().regex(/^S\d{1,4}$/)).max(8).default([]),
        type: z.enum(['fact', 'synthesis', 'uncertainty']),
      }),
    )
    .max(25),
  uncertainties: z.array(z.string().min(3).max(400)).max(10).default([]),
});
export type AiOutput = z.infer<typeof aiOutputSchema>;

export interface VerifiedStatement {
  text: string;
  type: 'fact' | 'synthesis' | 'uncertainty';
  citations: string[];
}
export interface RejectedStatement {
  text: string;
  reason: string;
}
export interface VerificationResult {
  verified: VerifiedStatement[];
  rejected: RejectedStatement[];
  uncertainties: string[];
}

const STOPWORDS = new Set(
  `about above after again against also among because been before being between both cannot could does doing during each
  from further have having here however into itself just more most only other over same should since some such than that
  their them then there these they this those through under until very were what when where which while with within would
  study studies evidence record records source sources reported report reports found data result results based available
  variant variants cancer cancers tumor tumors clinical patient patients`.split(/\s+/),
);

// Language the product must never output as a model statement.
const FORBIDDEN: { re: RegExp; reason: string }[] = [
  { re: /\b(should|must|ought to)\s+(be\s+)?(treated|receive|take|start|use|undergo)\b/i, reason: 'treatment recommendation' },
  { re: /\b(i|we)\s+(recommend|advise|suggest)\b/i, reason: 'recommendation' },
  { re: /\b(recommend(ed)?|prescrib(e|ed|ing))\b.{0,40}\b(patient|treatment|therapy|drug)\b/i, reason: 'treatment recommendation' },
  { re: /\b(is|are|would be|may be)\s+eligible\b|\bqualif(y|ies)\s+for\b/i, reason: 'eligibility claim' },
  { re: /\b(will|would)\s+(respond|benefit|work|improve|cure)\b/i, reason: 'outcome prediction' },
  { re: /\b(you|the patient|this patient)\s+(has|have|had)\b.{0,30}\b(cancer|melanoma|carcinoma|tumou?r|leukemia|lymphoma)\b/i, reason: 'diagnosis' },
  { re: /\b\d{1,3}(\.\d+)?\s?%\s*(chance|probability|likelihood|risk|likely|confidence|certain)/i, reason: 'probability' },
  { re: /\b(probability|likelihood|chance)\s+(of|that)\b.{0,40}\b\d/i, reason: 'probability' },
  { re: /<\s*\/?\s*(script|iframe|img|a|style)\b|javascript:|\]\(\s*https?:/i, reason: 'markup or link not allowed in statements' },
];

/** Tokens that identify a specific entity. If the statement names one the cited text lacks, it is unsupported. */
function anchors(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bNCT\d{8}\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/\bPMID[:\s]*(\d{4,9})\b/gi)) out.add(m[1]!);
  for (const m of text.matchAll(/\b[A-Z]\d{1,5}[A-Z*]\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/\bp\.[A-Z][a-z]{2}\d{1,5}[A-Z][a-z]{2}\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/\bc\.\d+[ACGT]>[ACGT]\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/\brs\d{3,12}\b/gi)) out.add(m[0]);
  for (const m of text.matchAll(/\b(?:EID|MP|VCV)\d{3,12}\b/g)) out.add(m[0]);
  // Gene-like all-caps tokens (BRAF, TP53, EGFR). Short caps like "DNA" or "NCT" are skipped by the length/digit rule below.
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{2,9}\b/g)) {
    const t = m[0];
    if (/^(DNA|RNA|NCT|FDA|EMA|PCR|NGS|SNV|VAF|HGVS|CIViC|ClinVar|PMID|NCI|WHO|II|III|IV)$/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (/^[A-Z]\d{1,5}[A-Z*]$/.test(t)) continue; // handled above
    out.add(t);
  }
  return [...out];
}

function contentWords(text: string): string[] {
  return [
    ...new Set(
      (text.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? []).filter((w) => !STOPWORDS.has(w)).map((w) => w.slice(0, 6)),
    ),
  ];
}

/**
 * Verify model statements against retrieved sources.
 *  - Every citation must be an id that the application issued.
 *  - Fact/synthesis statements need at least one citation.
 *  - Every specific entity named (gene, variant, NCT id, PMID...) must appear in the cited text.
 *  - Enough of the statement's content words must appear in the cited text.
 *  - Recommendation, eligibility, diagnosis, outcome and probability language is rejected outright.
 * This establishes consistency with retrieved text; it cannot prove a claim is clinically correct.
 */
export function verifyStatements(output: AiOutput, index: SourceIndexEntry[]): VerificationResult {
  const byId = new Map(index.map((e) => [e.id, e]));
  const verified: VerifiedStatement[] = [];
  const rejected: RejectedStatement[] = [];

  for (const s of output.statements) {
    const text = s.text.trim();
    const bad = FORBIDDEN.find((f) => f.re.test(text));
    if (bad) {
      rejected.push({ text, reason: `Removed: ${bad.reason}` });
      continue;
    }
    if (s.type === 'uncertainty') {
      verified.push({ text, type: 'uncertainty', citations: [] });
      continue;
    }
    const cites = [...new Set(s.citations)];
    if (!cites.length) {
      rejected.push({ text, reason: 'Removed: no citation' });
      continue;
    }
    const unknown = cites.filter((c) => !byId.has(c));
    if (unknown.length) {
      rejected.push({ text, reason: `Removed: unknown citation ${unknown.join(', ')}` });
      continue;
    }
    const corpus = cites.map((c) => byId.get(c)!.text).join(' \n ');
    const corpusLower = corpus.toLowerCase();

    const missingAnchor = anchors(text).find((a) => !corpusLower.includes(a.toLowerCase()));
    if (missingAnchor) {
      rejected.push({ text, reason: `Removed: "${missingAnchor}" does not appear in the cited source` });
      continue;
    }
    const words = contentWords(text);
    if (words.length >= 3) {
      const hit = words.filter((w) => corpusLower.includes(w)).length;
      if (hit / words.length < 0.4) {
        rejected.push({ text, reason: 'Removed: statement is not supported by the cited source text' });
        continue;
      }
    }
    verified.push({ text, type: s.type, citations: cites });
  }
  return { verified, rejected, uncertainties: output.uncertainties };
}

/** Pull the first JSON object out of a model reply (models sometimes wrap it in prose or fences). */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
