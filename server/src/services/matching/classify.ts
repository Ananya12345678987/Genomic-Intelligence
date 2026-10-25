import type { MatchDecision, ParsedVariant, SourceVariantRef } from '../../types/domain.js';

function sameGene(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.toUpperCase() === b.toUpperCase();
}

function stripVersion(accession: string): string {
  return accession.replace(/\.\d+$/, '');
}

const GENE_FIELD = 'geneSymbol';

/**
 * Deterministic match classification. No scores, no model. Categories are only assigned
 * from explicit field comparisons, and each decision lists what matched and what differed.
 *
 * Returns null when the record belongs to a different gene (it is not a match at all).
 */
export function classifyMatch(submitted: ParsedVariant, ref: SourceVariantRef): MatchDecision | null {
  const rec = ref.parsed;
  const recGene = ref.geneSymbol ?? rec?.geneSymbol ?? null;

  if (submitted.geneSymbol && recGene && !sameGene(submitted.geneSymbol, recGene)) return null;

  const matching: string[] = [];
  const differing: string[] = [];
  if (sameGene(submitted.geneSymbol, recGene)) matching.push(GENE_FIELD);

  // Identifier-level agreement is the strongest statement we can make without sequence checks.
  if (submitted.rsId && ref.identifiers.rsId && submitted.rsId.toLowerCase() === ref.identifiers.rsId.toLowerCase()) {
    return {
      category: 'exact_normalized',
      basis: 'identifier',
      matchingFields: [...matching, 'rsId'],
      differingFields: differing,
      rationale: `The submitted dbSNP identifier ${submitted.rsId} equals the identifier recorded by ${ref.source}.`,
    };
  }

  if (submitted.normalizationStatus === 'gene_only') {
    return {
      category: 'gene_level_result',
      basis: 'gene',
      matchingFields: matching,
      differingFields: [],
      rationale: 'Only a gene was submitted, so this is a gene-level result. It says nothing about any specific variant.',
    };
  }

  if (submitted.normalizationStatus === 'unresolved' || submitted.normalizationStatus === 'ambiguous') {
    return {
      category: 'unresolved',
      basis: 'none',
      matchingFields: matching,
      differingFields: [],
      rationale: 'The submitted finding could not be normalized to a comparable level, so no variant-level comparison was made.',
    };
  }

  // Genomic coordinates (must share an explicit assembly).
  if (rec && submitted.position !== null && rec.position !== null) {
    const bothAssemblies = !!submitted.referenceGenome && !!rec.referenceGenome;
    if (bothAssemblies && submitted.referenceGenome === rec.referenceGenome && submitted.chromosome === rec.chromosome) {
      if (submitted.position === rec.position) {
        if (submitted.referenceAllele === rec.referenceAllele && submitted.alternateAllele === rec.alternateAllele) {
          return {
            category: 'exact_normalized',
            basis: 'genomic',
            matchingFields: [...matching, 'referenceGenome', 'chromosome', 'position', 'referenceAllele', 'alternateAllele'],
            differingFields: differing,
            rationale: `Identical ${submitted.referenceGenome} chromosome ${submitted.chromosome}, position ${submitted.position} and alleles.`,
          };
        }
        return {
          category: 'same_position_different_allele',
          basis: 'genomic',
          matchingFields: [...matching, 'referenceGenome', 'chromosome', 'position'],
          differingFields: ['alternateAllele'],
          rationale: `Same ${submitted.referenceGenome} position (chr${submitted.chromosome}:${submitted.position}) but different allele (${submitted.referenceAllele}>${submitted.alternateAllele} submitted; ${rec.referenceAllele}>${rec.alternateAllele} in record).`,
        };
      }
    }
  }

  // Coding HGVS on the same transcript accession (version-aware).
  if (rec && submitted.hgvsCoding && rec.hgvsCoding && submitted.transcriptId && rec.transcriptId) {
    const sameAccession = stripVersion(submitted.transcriptId) === stripVersion(rec.transcriptId);
    const sameVersion = submitted.transcriptId === rec.transcriptId;
    if (sameAccession && sameVersion && submitted.hgvsCoding === rec.hgvsCoding) {
      return {
        category: 'exact_normalized',
        basis: 'coding_transcript',
        matchingFields: [...matching, 'transcriptId', 'hgvsCoding'],
        differingFields: differing,
        rationale: `Identical coding change ${rec.hgvsCoding} on the same transcript version (${rec.transcriptId}).`,
      };
    }
    if (sameAccession && !sameVersion) {
      differing.push('transcriptVersion');
    }
    if (sameAccession && sameVersion) {
      const subA = /^c\.(\d+)([ACGT])>([ACGT])$/.exec(submitted.hgvsCoding);
      const subB = /^c\.(\d+)([ACGT])>([ACGT])$/.exec(rec.hgvsCoding);
      if (subA && subB && subA[1] === subB[1]) {
        return {
          category: 'same_position_different_allele',
          basis: 'coding_transcript',
          matchingFields: [...matching, 'transcriptId', 'codingPosition'],
          differingFields: ['hgvsCoding'],
          rationale: `Same coding position on ${rec.transcriptId} but a different nucleotide change (${submitted.hgvsCoding} submitted; ${rec.hgvsCoding} in record).`,
        };
      }
    }
  }

  // Protein level.
  const sp = submitted.protein;
  const rp = rec?.protein ?? null;
  if (sp && rp && sp.kind === 'substitution') {
    if (rp.kind === 'substitution') {
      if (sp.ref === rp.ref && sp.position === rp.position && sp.alt === rp.alt) {
        const nucleotideConflict =
          submitted.hgvsCoding && rec?.hgvsCoding && submitted.transcriptId && rec.transcriptId &&
          submitted.transcriptId === rec.transcriptId && submitted.hgvsCoding !== rec.hgvsCoding;
        if (nucleotideConflict) {
          return {
            category: 'same_gene_different_variant',
            basis: 'protein_notation',
            matchingFields: [...matching, 'hgvsProtein'],
            differingFields: ['hgvsCoding'],
            rationale: `Both predict ${sp.ref}${sp.position}${sp.alt}, but the nucleotide changes differ (${submitted.hgvsCoding} vs ${rec?.hgvsCoding}). These are different variants.`,
          };
        }
        return {
          category: 'equivalent_representation',
          basis: 'protein_notation',
          matchingFields: [...matching, 'hgvsProtein'],
          differingFields: submitted.transcriptId || submitted.position !== null ? ['nucleotide-level identity not compared'] : [],
          rationale: `Same gene and same amino-acid change (${sp.ref}${sp.position}${sp.alt}) after notation normalization. Protein-level agreement only: nucleotide-level identity was not established because the record or the submission lacks matching transcript or genomic detail.`,
        };
      }
      if (sp.position === rp.position && sp.ref === rp.ref) {
        return {
          category: 'same_position_different_allele',
          basis: 'protein_position',
          matchingFields: [...matching, 'proteinPosition', 'referenceAminoAcid'],
          differingFields: ['alternateAminoAcid'],
          rationale: `Same residue (${sp.ref}${sp.position}) but a different substitution (${sp.alt} submitted; ${rp.alt} in record). This is a different variant and its evidence does not transfer automatically.`,
        };
      }
      if (sp.position === rp.position && sp.ref !== rp.ref) {
        return {
          category: 'same_gene_different_variant',
          basis: 'gene',
          matchingFields: [...matching, 'proteinPosition'],
          differingFields: ['referenceAminoAcid', 'alternateAminoAcid'],
          rationale: `The residue number matches (${sp.position}) but the reference amino acid differs (${sp.ref} vs ${rp.ref}); this can reflect a different transcript or a different variant.`,
        };
      }
    }
    if (rp.kind === 'codon_level' && sp.position === rp.position && sp.ref === rp.ref) {
      return {
        category: 'related_biomarker',
        basis: 'protein_position',
        matchingFields: [...matching, 'proteinPosition', 'referenceAminoAcid'],
        differingFields: ['alternateAminoAcid (record is codon-level)'],
        rationale: `The record describes codon ${rp.ref}${rp.position} generally, not the specific ${sp.ref}${sp.position}${sp.alt} substitution. It is related, not an exact match.`,
      };
    }
  }

  if (ref.specificity === 'nonspecific') {
    return {
      category: 'related_biomarker',
      basis: 'gene',
      matchingFields: matching,
      differingFields: ['variant (record describes a broader alteration)'],
      rationale: `The record "${ref.displayName}" describes a broader or non-specific alteration in the same gene, not the submitted variant.`,
    };
  }

  return {
    category: 'same_gene_different_variant',
    basis: 'gene',
    matchingFields: matching,
    differingFields: ['variant'],
    rationale: `Same gene (${recGene ?? 'unknown'}) but a different variant ("${ref.displayName}"). Gene-level overlap is not evidence about the submitted variant.`,
  };
}

export const CATEGORY_ORDER: Record<MatchDecision['category'], number> = {
  exact_normalized: 0,
  equivalent_representation: 1,
  same_position_different_allele: 2,
  related_biomarker: 3,
  same_gene_different_variant: 4,
  gene_level_result: 5,
  literature_only: 6,
  unresolved: 7,
};

export const CATEGORY_LABELS: Record<MatchDecision['category'], string> = {
  exact_normalized: 'Exact normalized match',
  equivalent_representation: 'Equivalent representation',
  same_position_different_allele: 'Same position, different allele',
  same_gene_different_variant: 'Same gene, different variant',
  related_biomarker: 'Related biomarker',
  literature_only: 'Literature-only association',
  unresolved: 'Unresolved or ambiguous',
  gene_level_result: 'Gene-level result',
};
