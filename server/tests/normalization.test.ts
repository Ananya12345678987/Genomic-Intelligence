import { describe, it, expect } from 'vitest';
import { parseVariantInput, parseRecordName, extractCandidates, assemblyFromAccession } from '../src/services/variant-normalization/index.js';

describe('parseVariantInput: protein notation', () => {
  it('treats one-letter and three-letter forms as the same normalized change', () => {
    const a = parseVariantInput('BRAF V600E');
    const b = parseVariantInput('BRAF p.Val600Glu');
    const c = parseVariantInput('BRAF:p.V600E');
    for (const p of [a, b, c]) {
      expect(p.geneSymbol).toBe('BRAF');
      expect(p.protein).toMatchObject({ kind: 'substitution', ref: 'Val', position: 600, alt: 'Glu' });
      expect(p.hgvsProtein).toBe('p.Val600Glu');
      expect(p.normalizationStatus).toBe('protein_change');
    }
  });

  it('does not invent a transcript, assembly or alleles for protein-only input', () => {
    const p = parseVariantInput('BRAF V600E');
    expect(p.transcriptId).toBeNull();
    expect(p.referenceGenome).toBeNull();
    expect(p.chromosome).toBeNull();
    expect(p.position).toBeNull();
    expect(p.referenceAllele).toBeNull();
    expect(p.alternateAllele).toBeNull();
    expect(p.missing).toEqual(expect.arrayContaining(['transcriptId', 'referenceGenome']));
    expect(p.warnings.join(' ')).toMatch(/does not by itself identify a unique genomic variant/);
  });

  it('flags non-HGNC aliases rather than silently renaming', () => {
    const p = parseVariantInput('HER2 S310F');
    expect(p.geneSymbol).toBe('ERBB2');
    expect(p.warnings.join(' ')).toMatch(/not the current HGNC symbol/);
  });

  it('classifies a bare gene as gene_only', () => {
    const p = parseVariantInput('BRAF');
    expect(p.geneSymbol).toBe('BRAF');
    expect(p.normalizationStatus).toBe('gene_only');
  });

  it('rejects empty input', () => {
    const p = parseVariantInput('   ');
    expect(p.normalizationStatus).toBe('unresolved');
  });
});

describe('gene symbols that start with reserved accession letters', () => {
  it.each([
    ['NRAS p.Gln61Arg', 'NRAS'],
    ['NPM1 p.Trp288fs', 'NPM1'],
    ['NRG1 p.Glu100Lys', 'NRG1'],
    ['NCOR1 p.Arg500Ter', 'NCOR1'],
    ['NCOA3 p.Gln10Glu', 'NCOA3'],
  ])('keeps the gene in "%s"', (input, gene) => {
    expect(parseVariantInput(input).geneSymbol).toBe(gene);
  });

  it('still ignores accession and report tokens that are not genes', () => {
    expect(parseVariantInput('NM_004333.6(BRAF):c.1799T>A').geneSymbol).toBe('BRAF');
    const found = extractCandidates('VAF 38% on chr7 and GRCh38 NGS panel. NRAS p.Gln61Arg detected.', { referenceGenome: null });
    expect(found.map((c) => c.parsed.geneSymbol)).toEqual(['NRAS']);
  });

  it('extracts NRAS from a table-style report line', () => {
    const found = extractCandidates('Gene Protein change\nNRAS p.(Gln61Arg) c.182A>G NM_002524.5 6% Detected', { referenceGenome: null });
    const nras = found.find((c) => c.parsed.hgvsProtein === 'p.Gln61Arg');
    expect(nras?.parsed.geneSymbol).toBe('NRAS');
    expect(nras?.status).toBe('recognized');
  });
});

describe('parseVariantInput: nucleotide notation', () => {
  it('resolves coding HGVS only when a transcript is present', () => {
    const withTx = parseVariantInput('NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)');
    expect(withTx.geneSymbol).toBe('BRAF');
    expect(withTx.transcriptId).toBe('NM_004333.6');
    expect(withTx.hgvsCoding).toBe('c.1799T>A');
    expect(withTx.normalizationStatus).toBe('coding_hgvs');

    const noTx = parseVariantInput('BRAF c.1799T>A');
    expect(noTx.transcriptId).toBeNull();
    expect(noTx.normalizationStatus).not.toBe('coding_hgvs');
    expect(noTx.missing).toContain('transcriptId');
  });

  it('warns when the transcript has no version', () => {
    const p = parseVariantInput('NM_004333(BRAF):c.1799T>A');
    expect(p.warnings.join(' ')).toMatch(/no version/);
  });

  it('maps NC accessions to an assembly only for known versions', () => {
    const g38 = parseVariantInput('NC_000007.14:g.140753336A>T');
    expect(g38).toMatchObject({ chromosome: '7', position: 140753336, referenceGenome: 'GRCh38', normalizationStatus: 'genomic_coordinates' });
    const g37 = parseVariantInput('NC_000007.13:g.140453136A>T');
    expect(g37.referenceGenome).toBe('GRCh37');
    const unknown = parseVariantInput('NC_000007.99:g.140753336A>T');
    expect(unknown.referenceGenome).toBeNull();
    expect(unknown.normalizationStatus).not.toBe('genomic_coordinates');
    expect(assemblyFromAccession(7, 99)).toBeNull();
  });

  it('does not assume an assembly for bare coordinates, and uses supplied context when given', () => {
    const bare = parseVariantInput('chr7:140753336 A>T');
    expect(bare).toMatchObject({ chromosome: '7', position: 140753336, referenceAllele: 'A', alternateAllele: 'T' });
    expect(bare.referenceGenome).toBeNull();
    expect(bare.normalizationStatus).not.toBe('genomic_coordinates');
    expect(bare.missing).toContain('referenceGenome');

    const withCtx = parseVariantInput('7-140753336-A-T', { referenceGenome: 'GRCh38' });
    expect(withCtx.referenceGenome).toBe('GRCh38');
    expect(withCtx.normalizationStatus).toBe('genomic_coordinates');
  });

  it('extracts an rsID', () => {
    const p = parseVariantInput('rs113488022');
    expect(p.rsId).toBe('rs113488022');
    expect(p.normalizationStatus).toBe('identifier_only');
  });
});

describe('parseRecordName', () => {
  it('marks a bare codon as codon-level', () => {
    const r = parseRecordName('V600', 'BRAF');
    expect(r.specificity).toBe('codon_level');
    expect(r.parsed.protein?.kind).toBe('codon_level');
  });
  it('marks broad alterations as non-specific', () => {
    expect(parseRecordName('AMPLIFICATION', 'EGFR').specificity).toBe('nonspecific');
    expect(parseRecordName('EXON 19 DELETION', 'EGFR').specificity).toBe('nonspecific');
  });
  it('treats a specific substitution as specific', () => {
    const r = parseRecordName('V600E', 'BRAF');
    expect(r.specificity).toBe('specific');
    expect(r.parsed.hgvsProtein).toBe('p.Val600Glu');
  });
});

describe('extractCandidates', () => {
  const report = `
    Somatic findings: BRAF p.Val600Glu (VAF 34%), KRAS G12C, and EGFR L858R were detected.
    Also NM_000546.6(TP53):c.743G>A (p.Arg248Gln). Reference: GRCh38. Test code FISH PCR.
    Incidental rs1042522.
  `;
  it('finds variants and flags uncertain ones for review', () => {
    const c = extractCandidates(report);
    const protein = c.map((x) => x.parsed.hgvsProtein);
    expect(protein).toEqual(expect.arrayContaining(['p.Val600Glu', 'p.Gly12Cys', 'p.Leu858Arg']));
    expect(c.some((x) => x.parsed.transcriptId === 'NM_000546.6')).toBe(true);
    const braf = c.find((x) => x.parsed.geneSymbol === 'BRAF' && x.parsed.hgvsProtein === 'p.Val600Glu');
    expect(braf?.status).toBe('recognized');
    expect(braf?.selected).toBe(true);
    const rs = c.find((x) => x.parsed.rsId === 'rs1042522');
    expect(rs?.status).toBe('needs_review');
    expect(rs?.selected).toBe(false);
  });
  it('does not treat lab abbreviations as genes', () => {
    const c = extractCandidates('Assay: FISH P53 PCR V600E NGS');
    expect(c.every((x) => x.parsed.geneSymbol !== 'FISH')).toBe(true);
  });
  it('keeps candidate text short so no report body is retained', () => {
    const c = extractCandidates('x'.repeat(5000) + ' BRAF V600E ' + 'y'.repeat(5000));
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.text.length <= 120)).toBe(true);
  });
});
