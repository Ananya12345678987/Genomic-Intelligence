import type {
  NormalizationStatus,
  ParseContext,
  ParsedVariant,
  ProteinChange,
  ReferenceGenome,
} from '../../types/domain.js';
import { GENE_ALIASES, KNOWN_ONCOLOGY_GENES } from './geneList.js';
import { ONE_LETTER_CLASS, toThreeLetter } from './aminoAcids.js';

/**
 * RefSeq chromosome accessions → chromosome + assembly. An accession whose version is
 * not in this table is NOT assumed to belong to any assembly. The table was written
 * from NCBI's published GRCh38/GRCh37 chromosome accessions; verify against the NCBI
 * assembly report before relying on it for anything beyond triage.
 */
const GRCH38_VERSION: Record<string, number> = {
  '1': 11, '2': 12, '3': 12, '4': 12, '5': 10, '6': 12, '7': 14, '8': 11, '9': 12, '10': 11, '11': 10, '12': 12,
  '13': 11, '14': 9, '15': 10, '16': 10, '17': 11, '18': 10, '19': 10, '20': 11, '21': 9, '22': 12, X: 12, Y: 11,
};

function chromosomeFromAccession(num: number): string | null {
  if (num >= 1 && num <= 22) return String(num);
  if (num === 23) return 'X';
  if (num === 24) return 'Y';
  return null;
}

export function assemblyFromAccession(accessionNumber: number, version: number): { chromosome: string; assembly: ReferenceGenome } | null {
  const chromosome = chromosomeFromAccession(accessionNumber);
  if (!chromosome) return null;
  const v38 = GRCH38_VERSION[chromosome];
  if (v38 === undefined) return null;
  if (version === v38) return { chromosome, assembly: 'GRCh38' };
  if (version === v38 - 1) return { chromosome, assembly: 'GRCh37' };
  return null;
}

const PROTEIN_3 = /^([A-Z][a-z]{2})(\d{1,5})([A-Z][a-z]{2}|\*|=|\?)$/;
const PROTEIN_1 = new RegExp(`^([${ONE_LETTER_CLASS}])(\\d{1,5})([${ONE_LETTER_CLASS}*X])$`);
const TOKEN_LOOKS_LIKE_VARIANT = new RegExp(`^(?:[${ONE_LETTER_CLASS}]\\d{1,5}[${ONE_LETTER_CLASS}*X]?|[A-Z][a-z]{2}\\d{1,5}[A-Z][a-z]{2})$`);
// Tokens that are not gene symbols. Accession prefixes (NM_, NR_, ENST...) are matched as prefixes;
// everything else must match the WHOLE token. A bare prefix test here once rejected real genes whose
// names merely start with the same letters (NRAS, NPM1, NRG1, NCOR1, NCOA3).
const RESERVED_TOKENS = new RegExp(
  '^(?:(?:NM|NC|NP|NR|XM|XR)_|ENS[TP]\\d|' +
    '(?:NM|NC|NP|NR|ENST|ENSP|HGVS|DNA|RNA|VCF|SNV|INDEL|VAF|MSI|TMB|NGS|CHR(?:[0-9]{1,2}|X|Y|M)?|GRCH37|GRCH38|HG19|HG38)$)',
  'i',
);

export function parseProteinBody(body: string): ProteinChange | null {
  const cleaned = body.replace(/^p\./i, '').replace(/^\(|\)$/g, '').trim();
  const m3 = PROTEIN_3.exec(cleaned);
  if (m3) {
    const ref = toThreeLetter(m3[1]!);
    const alt = m3[3] === '*' ? 'Ter' : m3[3] === '=' || m3[3] === '?' ? m3[3] : toThreeLetter(m3[3]!);
    if (ref && alt) return { kind: 'substitution', ref, position: Number(m3[2]), alt, raw: cleaned };
    return null;
  }
  const m1 = PROTEIN_1.exec(cleaned);
  if (m1) {
    const ref = toThreeLetter(m1[1]!);
    const alt = toThreeLetter(m1[3]!);
    if (ref && alt) return { kind: 'substitution', ref, position: Number(m1[2]), alt, raw: cleaned };
    return null;
  }
  // Other HGVS protein events (frameshift, deletion, insertion, extension) are kept verbatim.
  if (/^[A-Z][a-z]{2}\d+(?:_[A-Z][a-z]{2}\d+)?(?:fs|del|ins|dup|ext|delins)/.test(cleaned) || /^[A-Z]\d+(?:_[A-Z]\d+)?(?:fs|del|ins|dup|ext)/.test(cleaned)) {
    return { kind: 'other', ref: null, position: null, alt: null, raw: cleaned };
  }
  return null;
}

export function formatProteinHgvs(change: ProteinChange): string | null {
  if (change.kind === 'substitution' && change.ref && change.position !== null && change.alt) {
    return `p.${change.ref}${change.position}${change.alt}`;
  }
  if (change.kind === 'other') return `p.${change.raw}`;
  return null;
}

function emptyParsed(source: string): ParsedVariant {
  return {
    sourceRepresentation: source,
    geneSymbol: null,
    geneRecognized: false,
    hgvsGenomic: null,
    hgvsCoding: null,
    hgvsProtein: null,
    referenceGenome: null,
    transcriptId: null,
    chromosome: null,
    position: null,
    referenceAllele: null,
    alternateAllele: null,
    rsId: null,
    protein: null,
    normalizationStatus: 'unresolved',
    warnings: [],
    missing: [],
  };
}

function resolveGene(token: string, warnings: string[]): { symbol: string; recognized: boolean } {
  const upper = token.toUpperCase();
  const alias = GENE_ALIASES[upper];
  if (alias) {
    warnings.push(`"${token}" is not the current HGNC symbol; interpreted as ${alias}. Please confirm.`);
    return { symbol: alias, recognized: KNOWN_ONCOLOGY_GENES.has(alias) };
  }
  return { symbol: upper, recognized: KNOWN_ONCOLOGY_GENES.has(upper) };
}

function findGeneToken(text: string): string | null {
  // ClinVar style: NM_004333.6(BRAF):c.1799T>A
  const paren = /\(([A-Za-z][A-Za-z0-9-]{1,14})\)\s*:/.exec(text);
  if (paren && !RESERVED_TOKENS.test(paren[1]!)) return paren[1]!;
  for (const token of text.split(/[\s:,;()]+/)) {
    if (!token) continue;
    if (!/^[A-Za-z][A-Za-z0-9-]{1,14}$/.test(token)) continue;
    if (RESERVED_TOKENS.test(token)) continue;
    if (TOKEN_LOOKS_LIKE_VARIANT.test(token)) continue;
    if (/^p$|^c$|^g$/i.test(token)) continue;
    if (/^rs\d+$/i.test(token)) continue;
    const upper = token.toUpperCase();
    // Accept all-caps symbols (BRAF, TP53) or known aliases written in any case.
    if (token === upper || GENE_ALIASES[upper]) return token;
  }
  return null;
}

/**
 * Parse a user-entered gene/variant string into explicit fields. Anything not present in
 * the input stays null; nothing is guessed or inferred (no assembly, transcript or allele).
 */
export function parseVariantInput(input: string, ctx: ParseContext = {}): ParsedVariant {
  const text = input.replace(/\s+/g, ' ').trim();
  const out = emptyParsed(text);
  if (!text) {
    out.warnings.push('Empty input.');
    out.missing.push('geneSymbol');
    return out;
  }

  // --- identifiers -------------------------------------------------------
  const rs = /\brs(\d{1,12})\b/i.exec(text);
  if (rs) out.rsId = `rs${rs[1]}`;

  // --- transcript --------------------------------------------------------
  const tx = /\b(NM_\d{6,9}(?:\.\d+)?|NR_\d{6,9}(?:\.\d+)?|ENST\d{11}(?:\.\d+)?)\b/.exec(text);
  const protAcc = /\b(NP_\d{6,9}(?:\.\d+)?)\b/.exec(text);
  if (tx) {
    out.transcriptId = tx[1]!;
    if (!/\.\d+$/.test(tx[1]!)) out.warnings.push('Transcript has no version number; transcript versions can change coordinates.');
  } else if (ctx.transcriptId) {
    out.transcriptId = ctx.transcriptId;
  }
  if (protAcc) out.warnings.push('Protein accession noted but not used for matching.');

  // --- genomic HGVS (NC_...:g.) -----------------------------------------
  const g = /\bNC_(\d{6})\.(\d{1,2})\s*:\s*g\.([^\s,;)]+)/i.exec(text);
  if (g) {
    const asm = assemblyFromAccession(Number(g[1]), Number(g[2]));
    out.hgvsGenomic = `NC_${g[1]}.${g[2]}:g.${g[3]}`;
    const sub = /^(\d+)([ACGT])>([ACGT])$/i.exec(g[3]!);
    if (asm) {
      out.chromosome = asm.chromosome;
      out.referenceGenome = asm.assembly;
    } else {
      out.warnings.push('Chromosome accession version could not be mapped to GRCh37 or GRCh38; assembly left unresolved.');
      out.missing.push('referenceGenome');
    }
    if (sub) {
      out.position = Number(sub[1]);
      out.referenceAllele = sub[2]!.toUpperCase();
      out.alternateAllele = sub[3]!.toUpperCase();
    } else {
      out.warnings.push('Genomic change is not a simple substitution; position and alleles were not extracted.');
    }
  }

  // --- coordinate forms: chr7:140753336 A>T, 7-140753336-A-T ------------
  if (!g) {
    const chr =
      /\bchr(?:omosome)?\s*([0-9]{1,2}|X|Y)\s*[:\-]\s*(\d+)\s*(?:[:\-\s])?\s*([ACGT]+)\s*(?:>|[:\-\s])\s*([ACGT]+)\b/i.exec(text) ??
      /\b([0-9]{1,2}|X|Y)-(\d+)-([ACGT]+)-([ACGT]+)\b/i.exec(text);
    if (chr) {
      out.chromosome = chr[1]!.toUpperCase();
      out.position = Number(chr[2]);
      out.referenceAllele = chr[3]!.toUpperCase();
      out.alternateAllele = chr[4]!.toUpperCase();
    }
  }
  if (out.position !== null) {
    if (!out.referenceGenome && ctx.referenceGenome) out.referenceGenome = ctx.referenceGenome;
    if (!out.referenceGenome) {
      out.missing.push('referenceGenome');
      out.warnings.push('Genomic coordinates were given without a reference genome (GRCh37 or GRCh38); the assembly was not assumed.');
    }
    out.warnings.push('Alleles are not verified against the reference sequence.');
  }

  // --- coding HGVS -------------------------------------------------------
  const c = /\bc\.([^\s,;)]+)/i.exec(text);
  if (c) {
    out.hgvsCoding = `c.${c[1]}`;
    if (!out.transcriptId) {
      out.missing.push('transcriptId');
      out.warnings.push('Coding notation (c.) was given without a transcript accession; it cannot be resolved without one.');
    }
  }

  // --- protein -----------------------------------------------------------
  const geneToken = ctx.geneSymbol ?? findGeneToken(text);
  const pExplicit = /\bp\.\(?([^\s,;)]+)\)?/i.exec(text);
  let protein: ProteinChange | null = null;
  if (pExplicit) {
    protein = parseProteinBody(pExplicit[1]!);
    if (!protein) out.warnings.push(`Protein notation "p.${pExplicit[1]}" could not be parsed.`);
  } else if (geneToken) {
    // Bare forms such as "V600E" are only accepted next to a gene symbol.
    const bare = new RegExp(`(?:^|[\\s:(])([${ONE_LETTER_CLASS}]\\d{1,5}[${ONE_LETTER_CLASS}*X]|[A-Z][a-z]{2}\\d{1,5}[A-Z][a-z]{2})(?=$|[\\s,;)])`).exec(text);
    if (bare) protein = parseProteinBody(bare[1]!);
  }
  if (protein) {
    out.protein = protein;
    out.hgvsProtein = formatProteinHgvs(protein);
  }

  // --- gene --------------------------------------------------------------
  if (geneToken) {
    const resolved = resolveGene(geneToken, out.warnings);
    out.geneSymbol = resolved.symbol;
    out.geneRecognized = resolved.recognized;
    if (!resolved.recognized) {
      out.warnings.push(`${resolved.symbol} is not in the built-in oncology gene list; the symbol was not checked against HGNC.`);
    }
  } else {
    out.missing.push('geneSymbol');
  }

  // --- status ------------------------------------------------------------
  let status: NormalizationStatus = 'unresolved';
  if (out.position !== null && out.referenceAllele && out.alternateAllele && out.referenceGenome) {
    status = 'genomic_coordinates';
  } else if (out.hgvsCoding && out.transcriptId) {
    status = 'coding_hgvs';
  } else if (out.protein && out.protein.kind !== 'codon_level' && out.geneSymbol) {
    status = 'protein_change';
    out.warnings.push(
      'Protein-level notation does not by itself identify a unique genomic variant; supply a transcript or genomic coordinates for nucleotide-level matching.',
    );
    if (!out.transcriptId) out.missing.push('transcriptId');
    if (!out.referenceGenome) out.missing.push('referenceGenome');
  } else if (out.rsId) {
    status = 'identifier_only';
  } else if (out.geneSymbol && !out.hgvsCoding && !out.protein && out.position === null) {
    status = 'gene_only';
  } else if (out.geneSymbol || out.protein || out.hgvsCoding || out.position !== null) {
    status = 'ambiguous';
  }
  out.normalizationStatus = status;
  if (status === 'identifier_only' && !out.geneSymbol) out.missing.push('geneSymbol');
  out.missing = [...new Set(out.missing)];
  return out;
}

/**
 * Parse a variant *name from a source record* (CIViC "V600E", ClinVar title). Differs from
 * user parsing: a bare codon ("V600") is allowed and marked codon-level.
 */
export function parseRecordName(name: string, geneSymbol: string | null): { parsed: ParsedVariant; specificity: 'specific' | 'codon_level' | 'nonspecific' } {
  const trimmed = name.trim();
  const parsed = parseVariantInput(geneSymbol ? `${geneSymbol} ${trimmed}` : trimmed, { geneSymbol });
  const codon = new RegExp(`^([${ONE_LETTER_CLASS}])(\\d{1,5})$`).exec(trimmed);
  if (codon) {
    const ref = toThreeLetter(codon[1]!)!;
    parsed.protein = { kind: 'codon_level', ref, position: Number(codon[2]), alt: null, raw: trimmed };
    parsed.normalizationStatus = 'ambiguous';
    return { parsed, specificity: 'codon_level' };
  }
  const nonspecific = /(amplification|deletion|loss|fusion|rearrangement|overexpression|expression|wild[\s-]?type|exon|mutation$|truncat|frameshift|splice|methylation|\bLOF\b|\bGOF\b|\bITD\b|\bSV\b|domain)/i.test(trimmed);
  if (parsed.protein?.kind === 'substitution' || parsed.hgvsCoding || parsed.position !== null || parsed.rsId) {
    return { parsed, specificity: 'specific' };
  }
  if (nonspecific || !parsed.protein) return { parsed, specificity: 'nonspecific' };
  return { parsed, specificity: 'specific' };
}
