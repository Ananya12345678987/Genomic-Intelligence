import { describe, it, expect } from 'vitest';
import { parseVariantInput, parseRecordName } from '../src/services/variant-normalization/index.js';
import { classifyMatch } from '../src/services/matching/index.js';
import type { SourceVariantRef } from '../src/types/domain.js';

function ref(name: string, gene: string, extra: Partial<SourceVariantRef> = {}): SourceVariantRef {
  const { parsed, specificity } = parseRecordName(name, gene);
  return {
    source: 'civic',
    sourceRecordId: '1',
    canonicalUrl: 'https://example.invalid/1',
    geneSymbol: gene,
    displayName: name,
    parsed,
    specificity,
    identifiers: {},
    ...extra,
  };
}

describe('classifyMatch', () => {
  it('protein-level agreement is an equivalent representation, never an exact match', () => {
    const d = classifyMatch(parseVariantInput('BRAF p.Val600Glu'), ref('V600E', 'BRAF'))!;
    expect(d.category).toBe('equivalent_representation');
    expect(d.rationale).toMatch(/nucleotide-level identity was not established/i);
  });

  it('identical coding change on the same transcript version is exact', () => {
    const sub = parseVariantInput('NM_004333.6(BRAF):c.1799T>A');
    const rec = ref('NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)', 'BRAF');
    expect(classifyMatch(sub, rec)!.category).toBe('exact_normalized');
  });

  it('a different transcript version prevents an exact match', () => {
    const sub = parseVariantInput('NM_004333.4(BRAF):c.1799T>A');
    const rec = ref('NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)', 'BRAF');
    const d = classifyMatch(sub, rec)!;
    expect(d.category).not.toBe('exact_normalized');
  });

  it('same genomic position on the same assembly with identical alleles is exact', () => {
    const sub = parseVariantInput('NC_000007.14:g.140753336A>T');
    const rec = ref('NC_000007.14:g.140753336A>T', 'BRAF');
    expect(classifyMatch(sub, rec)!.category).toBe('exact_normalized');
  });

  it('identical coordinates on different assemblies are NOT compared as equal', () => {
    const sub = parseVariantInput('7-140753336-A-T', { referenceGenome: 'GRCh37', geneSymbol: 'BRAF' });
    const rec = ref('NC_000007.14:g.140753336A>T', 'BRAF');
    expect(classifyMatch(sub, rec)!.category).not.toBe('exact_normalized');
  });

  it('same residue, different substitution is same_position_different_allele', () => {
    const d = classifyMatch(parseVariantInput('BRAF V600E'), ref('V600K', 'BRAF'))!;
    expect(d.category).toBe('same_position_different_allele');
    expect(d.differingFields).toContain('alternateAminoAcid');
  });

  it('a codon-level record is only a related biomarker', () => {
    const d = classifyMatch(parseVariantInput('BRAF V600E'), ref('V600', 'BRAF'))!;
    expect(d.category).toBe('related_biomarker');
  });

  it('same gene, different residue is same_gene_different_variant', () => {
    const d = classifyMatch(parseVariantInput('BRAF V600E'), ref('G469A', 'BRAF'))!;
    expect(d.category).toBe('same_gene_different_variant');
  });

  it('broad alterations are related biomarkers, not variant matches', () => {
    const d = classifyMatch(parseVariantInput('EGFR L858R'), ref('AMPLIFICATION', 'EGFR'))!;
    expect(d.category).toBe('related_biomarker');
  });

  it('records from another gene are discarded entirely', () => {
    expect(classifyMatch(parseVariantInput('BRAF V600E'), ref('V600E', 'KRAS'))).toBeNull();
  });

  it('gene-only queries yield gene_level_result, not a variant category', () => {
    const d = classifyMatch(parseVariantInput('BRAF'), ref('V600E', 'BRAF'))!;
    expect(d.category).toBe('gene_level_result');
  });

  it('unnormalizable submissions are unresolved', () => {
    const d = classifyMatch(parseVariantInput('BRAF c.1799T>A'), ref('V600E', 'BRAF'))!;
    expect(['unresolved', 'same_gene_different_variant']).toContain(d.category);
    expect(d.category).not.toBe('exact_normalized');
  });

  it('identical rsIDs are exact at identifier level', () => {
    const sub = parseVariantInput('BRAF rs113488022');
    const rec = ref('V600E', 'BRAF', { identifiers: { rsId: 'rs113488022' } });
    const d = classifyMatch(sub, rec)!;
    expect(d.category).toBe('exact_normalized');
    expect(d.basis).toBe('identifier');
  });

  it('same protein change but conflicting nucleotide change is a different variant', () => {
    const sub = parseVariantInput('NM_004333.6(BRAF):c.1799_1800delinsAA (p.Val600Glu)');
    const rec = ref('NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)', 'BRAF');
    const d = classifyMatch(sub, rec)!;
    expect(d.category).toBe('same_gene_different_variant');
    expect(d.differingFields).toContain('hgvsCoding');
  });
});
