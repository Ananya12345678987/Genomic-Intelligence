import type {
  EvidenceItem,
  MatchAssessment,
  MatchDecision,
  ParsedVariant,
  VariantRecord,
} from '../../types/domain.js';

const CONFIDENCE_LEVEL: Record<MatchDecision['basis'], MatchAssessment['matchConfidence']['level']> = {
  identifier: 'identifier',
  genomic: 'identifier',
  coding_transcript: 'identifier',
  protein_notation: 'notation',
  protein_position: 'position',
  gene: 'gene',
  none: 'none',
};

const CONFIDENCE_TEXT: Record<MatchAssessment['matchConfidence']['level'], string> = {
  identifier: 'Established through identical identifiers or coordinates. This describes how well the record corresponds to the submission, not how strong the clinical evidence is.',
  notation: 'Established through identical protein-level notation only. Nucleotide-level identity was not established.',
  position: 'Only the position (residue) matches, not the specific change.',
  gene: 'Only the gene matches.',
  none: 'No variant-level comparison was possible.',
};

/**
 * Build the four separate assessments. They are qualitative and source-attributed.
 * Nothing here is a probability, a pathogenicity estimate, or a treatment recommendation.
 */
export function assessFinding(
  submitted: ParsedVariant,
  decision: MatchDecision,
  record: VariantRecord,
  evidence: EvidenceItem[],
): MatchAssessment {
  const level = CONFIDENCE_LEVEL[decision.basis];

  const strengthItems: MatchAssessment['evidenceStrength']['items'] = [];
  for (const c of record.classifications) {
    strengthItems.push({
      label: `${c.label}${c.reviewStatus ? ` (review status: ${c.reviewStatus})` : ''}`,
      scope: c.scope,
      note: c.scopeNote,
    });
  }
  for (const e of evidence) {
    if (e.evidenceLevel) {
      strengthItems.push({
        label: `CIViC evidence level ${e.evidenceLevel} (${[e.evidenceType, e.evidenceDirection].filter(Boolean).join(', ')})`,
        scope: 'evidence_level',
        note: 'A CIViC evidence level describes the type of study behind one curated statement. It is not a measure of benefit for an individual patient.',
      });
    }
  }

  const statements: string[] = [];
  for (const c of record.classifications) {
    const cond = c.conditions?.length ? ` for ${c.conditions.slice(0, 3).join('; ')}` : '';
    statements.push(`${record.ref.source === 'clinvar' ? 'ClinVar' : record.ref.source}: ${c.label}${cond} (${c.scopeNote})`);
  }
  for (const e of evidence.slice(0, 5)) {
    statements.push(
      `CIViC evidence ${e.sourceRecordId}: ${[e.evidenceType, e.significance, e.evidenceDirection].filter(Boolean).join(' / ')}${e.disease ? ` in ${e.disease}` : ''}${e.therapies.length ? ` (therapy context: ${e.therapies.join(', ')})` : ''}`,
    );
  }

  const missing: string[] = [];
  if (decision.category !== 'exact_normalized') missing.push('no exact normalized match for the submitted variant');
  if (submitted.normalizationStatus === 'protein_change') missing.push('transcript and genomic coordinates were not provided');
  if (!record.classifications.length && !evidence.length) missing.push('no source classification or evidence item attached to this record');
  for (const m of submitted.missing) if (!missing.some((x) => x.includes(m))) missing.push(`submitted ${m} not provided`);

  return {
    matchConfidence: { level, explanation: CONFIDENCE_TEXT[level] },
    evidenceStrength: {
      items: strengthItems,
      note: 'Each classification is shown with its original scope. A germline pathogenicity classification is not a statement about cancer treatment, and a somatic clinical-impact classification is not a pathogenicity classification.',
    },
    clinicalRelevance: {
      statements,
      note: 'These are statements made by the source about its own context (disease, alteration, therapy). They are not recommendations for any individual patient.',
    },
    evidenceCompleteness: {
      missing,
      note: missing.length ? 'Information that was absent and could change the assessment.' : 'No obvious gaps were detected; this does not imply the record is complete.',
    },
  };
}
