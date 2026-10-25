import { randomUUID } from 'node:crypto';
import type { ParsedVariant, ReferenceGenome } from '../../types/domain.js';
import { parseVariantInput } from './parse.js';
import { ONE_LETTER_CLASS } from './aminoAcids.js';

export interface ExtractedCandidate {
  id: string;
  /** The exact text span that was recognized. Short by construction; no surrounding report text is kept. */
  text: string;
  parsed: ParsedVariant;
  status: 'recognized' | 'needs_review';
  warnings: string[];
  selected: boolean;
}

const MAX_CANDIDATES = 50;

// A gene token directly followed (within a few characters) by a protein change.
const GENE_PROTEIN = new RegExp(
  `\\b([A-Z][A-Z0-9-]{1,14})\\b[\\s:]{0,3}(?:p\\.)?\\(?((?:[A-Z][a-z]{2}|[${ONE_LETTER_CLASS}])\\d{1,5}(?:[A-Z][a-z]{2}|[${ONE_LETTER_CLASS}*]|X))\\)?`,
  'g',
);
const GENE_PROTEIN_FS = /\b([A-Z][A-Z0-9-]{1,14})\b[\s:]{0,3}p\.\(?([A-Z][a-z]{2}\d+(?:fs|del|ins|dup|ext)\S*)\)?/g;
const HGVS_CODING = /\b((?:NM_|NR_)\d{6,9}(?:\.\d+)?(?:\([A-Za-z0-9-]+\))?\s*:\s*c\.[^\s,;]+(?:\s*\(p\.[^\s)]+\))?)/g;
const HGVS_GENOMIC = /\b(NC_\d{6}\.\d{1,2}\s*:\s*g\.[^\s,;]+)/g;
const COORDS = /\b((?:chr(?:omosome)?\s*)?(?:[0-9]{1,2}|X|Y)\s*[:-]\s*\d{4,9}\s*[:\-\s]?\s*[ACGT]+\s*(?:>|[:\-\s])\s*[ACGT]+)\b/gi;
const RSID = /\b(rs\d{1,12})\b/gi;

function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}

/**
 * Find candidate genomic findings in free text (pasted reports or PDF text). This is
 * pattern matching, not interpretation: every candidate carries warnings and is shown to
 * the user for review before any search runs. Unrecognized genes are flagged, not dropped.
 */
export function extractCandidates(text: string, ctx: { referenceGenome?: ReferenceGenome | null } = {}): ExtractedCandidate[] {
  const seen = new Set<string>();
  const found: ExtractedCandidate[] = [];

  const add = (rawSpan: string, geneHint?: string) => {
    if (found.length >= MAX_CANDIDATES) return;
    // Sentence punctuation after a notation is not part of it.
    const span = rawSpan.replace(/[.,;:]+$/, '');
    const parsed = parseVariantInput(geneHint ? `${geneHint} ${span}` : span, { referenceGenome: ctx.referenceGenome ?? null });
    if (parsed.normalizationStatus === 'unresolved') return;
    const key = [
      parsed.geneSymbol,
      parsed.hgvsProtein,
      parsed.hgvsCoding,
      parsed.transcriptId,
      parsed.hgvsGenomic,
      parsed.chromosome && `${parsed.chromosome}:${parsed.position}:${parsed.referenceAllele}:${parsed.alternateAllele}`,
      parsed.rsId,
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);

    const warnings = [...parsed.warnings];
    const recognizedGene = parsed.geneRecognized || (!parsed.geneSymbol && parsed.normalizationStatus === 'identifier_only');
    const complete =
      parsed.normalizationStatus === 'genomic_coordinates' ||
      parsed.normalizationStatus === 'coding_hgvs' ||
      (parsed.normalizationStatus === 'protein_change' && parsed.geneRecognized);
    const status = recognizedGene && complete ? 'recognized' : 'needs_review';
    if (parsed.normalizationStatus === 'identifier_only') warnings.push('Only an rsID was found; no gene or change was extracted with it.');

    found.push({
      id: randomUUID(),
      text: span.trim().slice(0, 120),
      parsed,
      status,
      warnings,
      selected: status === 'recognized',
    });
  };

  for (const m of matches(HGVS_CODING, text)) add(m[1]!);
  for (const m of matches(HGVS_GENOMIC, text)) add(m[1]!);
  for (const m of matches(GENE_PROTEIN_FS, text)) add(`p.${m[2]}`, m[1]);
  for (const m of matches(GENE_PROTEIN, text)) {
    const gene = m[1]!;
    // Skip tokens that are obviously not genes (assembly names, test abbreviations, accession prefixes).
    if (/^(NM|NC|NP|NR|ENST|HGVS|GRCH\d+|HG\d+|VAF|MSI|TMB|NGS|DNA|RNA|PCR|FISH|IHC)$/i.test(gene)) continue;
    add(`p.${m[2]}`, gene);
  }
  for (const m of matches(COORDS, text)) add(m[1]!);
  for (const m of matches(RSID, text)) add(m[1]!);

  return found;
}
