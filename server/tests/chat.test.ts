import { describe, it, expect, vi } from 'vitest';
import { detectCancerType, interpretMessage } from '../src/services/chat/intent.js';
import { handleTurn, type OrchestratorDeps } from '../src/services/chat/orchestrator.js';
import type { AiProvider } from '../src/services/ai/provider.js';
import type { SearchResult } from '../src/types/domain.js';
import { fakeSources } from './helpers/fakeSources.js';

const noPrior = { hasPriorResults: false };

describe('interpretMessage', () => {
  it('treats a bare gene as a gene-level search', () => {
    const i = interpretMessage('BRAF', noPrior);
    expect(i.kind).toBe('search');
    if (i.kind === 'search') expect(i.variants.map((v) => [v.geneSymbol, v.normalizationStatus])).toEqual([['BRAF', 'gene_only']]);
  });

  it('extracts a variant and cancer context from a natural-language request', () => {
    const i = interpretMessage('Investigate BRAF V600E in melanoma.', noPrior);
    expect(i.kind).toBe('search');
    if (i.kind === 'search') {
      expect(i.variants[0]).toMatchObject({ geneSymbol: 'BRAF', hgvsProtein: 'p.Val600Glu' });
      expect(i.cancerType).toBe('melanoma');
    }
  });

  it('finds two variants for a comparison', () => {
    const i = interpretMessage('Compare BRAF V600E and KRAS G12D', noPrior);
    expect(i.kind).toBe('search');
    if (i.kind === 'search') expect(i.variants.map((v) => v.hgvsProtein)).toEqual(['p.Val600Glu', 'p.Gly12Asp']);
  });

  it('never invents reference genome or transcript', () => {
    const i = interpretMessage('BRAF V600E', noPrior);
    if (i.kind === 'search') expect(i.variants[0]).toMatchObject({ referenceGenome: null, transcriptId: null });
  });

  it('only applies a reference genome the user explicitly supplied', () => {
    const i = interpretMessage('BRAF V600E', { ...noPrior, referenceGenome: 'GRCh38' });
    if (i.kind === 'search') expect(i.variants[0]!.referenceGenome).toBe('GRCh38');
  });

  it('routes long pasted text to extraction review instead of searching', () => {
    const text = `Tumor profiling summary. ${'Sample is adequate. '.repeat(40)} Findings: BRAF V600E detected, KRAS G12D detected.`;
    const i = interpretMessage(text, noPrior);
    expect(i.kind).toBe('report_review');
    if (i.kind === 'report_review') expect(i.candidates.map((c) => c.parsed.hgvsProtein)).toEqual(expect.arrayContaining(['p.Val600Glu', 'p.Gly12Asp']));
  });

  it('asks which gene when none is given', () => {
    const i = interpretMessage('Search publications for a gene and cancer type.', noPrior);
    expect(i.kind).toBe('clarify');
  });

  it('answers a follow-up from prior results only when prior results exist', () => {
    expect(interpretMessage('why is the V600K record different?', { hasPriorResults: true }).kind).toBe('followup');
    expect(interpretMessage('why is that different?', noPrior).kind).toBe('clarify');
  });

  it('detects cancer types conservatively', () => {
    expect(detectCancerType('EGFR variants in non-small cell lung cancer')).toMatch(/lung cancer/);
    expect(detectCancerType('nothing relevant here')).toBeNull();
  });
});

const baseEnv = { AI_ALLOW_SENSITIVE_CONTENT: false };
const turn = (deps: OrchestratorDeps, message: string, extra: { prior?: SearchResult[]; consent?: boolean } = {}) =>
  handleTurn(deps, { message, context: {}, priorResults: extra.prior ?? [], userConsent: extra.consent ?? false });

describe('handleTurn (real adapters over replayed fixtures)', () => {
  it('returns classified findings, cited deterministic summary, and no model when AI is not configured', async () => {
    const { sources } = fakeSources();
    const out = await turn({ env: baseEnv, sources, ai: null }, 'Investigate BRAF V600E in melanoma.');
    expect(out.role).toBe('assistant');
    if (out.role !== 'assistant' || out.payload.kind !== 'results') throw new Error('expected results');
    const { results, answer, index } = out.payload;

    expect(answer.mode).toBe('deterministic');
    expect(answer.notice).toMatch(/not configured/);

    const r = results[0]!;
    const byName = Object.fromEntries(r.findings.map((f) => [f.record.ref.displayName, f.decision.category]));
    // Same residue, different substitution must never be labelled an exact match.
    const k = r.findings.find((f) => /V600K|Val600Lys/.test(f.record.ref.displayName));
    expect(k).toBeDefined();
    expect(k!.decision.category).not.toBe('exact_normalized');
    // Protein-level notation alone cannot establish nucleotide-level identity, so the best a
    // protein-only submission can earn is "equivalent representation", never "exact normalized".
    expect(r.findings.some((f) => f.decision.category === 'exact_normalized')).toBe(false);
    const equiv = r.findings.filter((f) => f.decision.category === 'equivalent_representation');
    expect(equiv.length).toBeGreaterThan(0);
    expect(equiv.every((f) => f.decision.basis === 'protein_notation')).toBe(true);
    expect(r.notices.join(' ')).toMatch(/No exact normalized match/);
    // The replayed CIViC response includes a KRAS record; the adapter must drop it for a BRAF query.
    expect(Object.keys(byName).join(' ')).not.toMatch(/KRAS/);

    expect(r.publications.length).toBeGreaterThan(0);
    expect(r.trials[0]!.canonicalUrl).toBe('https://clinicaltrials.gov/study/NCT01234567');

    // Every citation links to a record that was actually retrieved.
    expect(out.citations.length).toBeGreaterThan(0);
    for (const c of out.citations) {
      const e = index.find((x) => x.id === c.refId)!;
      expect(e.url).toBe(c.canonicalUrl);
    }
    expect(JSON.stringify(out.payload)).not.toMatch(/"text":/); // verification text is not shipped to the browser index
  });

  it('earns an exact normalized match only from a shared identifier (here a dbSNP id present in the ClinVar record)', async () => {
    const { sources } = fakeSources();
    const out = await turn({ env: baseEnv, sources, ai: null }, 'BRAF rs113488022');
    if (out.role !== 'assistant' || out.payload.kind !== 'results') throw new Error('expected results');
    const exact = out.payload.results[0]!.findings.filter((f) => f.decision.category === 'exact_normalized');
    expect(exact.length).toBeGreaterThan(0);
    expect(exact.every((f) => f.decision.basis === 'identifier')).toBe(true);
  });

  it('keeps going and says so when a source is down', async () => {
    const { sources } = fakeSources({ down: ['trials'] });
    const out = await turn({ env: baseEnv, sources, ai: null }, 'BRAF V600E');
    if (out.role !== 'assistant' || out.payload.kind !== 'results') throw new Error('expected results');
    const r = out.payload.results[0]!;
    expect(r.trials).toEqual([]);
    expect(r.sourceStatuses.find((s) => s.source === 'clinicaltrials')!.status).toBe('unavailable');
    expect(r.notices.join(' ')).toMatch(/ClinicalTrials\.gov could not be searched/);
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it('reports every source as unavailable instead of inventing results when all are down', async () => {
    const { sources } = fakeSources({ down: ['ncbi', 'civic', 'trials'] });
    const out = await turn({ env: baseEnv, sources, ai: null }, 'BRAF V600E');
    if (out.role !== 'assistant' || out.payload.kind !== 'results') throw new Error('expected results');
    const r = out.payload.results[0]!;
    expect(r.findings).toEqual([]);
    expect(r.sourceStatuses.every((s) => s.status === 'unavailable')).toBe(true);
    expect(out.citations).toEqual([]);
  });

  it('removes AI statements whose citations were not retrieved, and keeps verified ones', async () => {
    const { sources } = fakeSources();
    const first = await turn({ env: baseEnv, sources, ai: null }, 'BRAF V600E');
    if (first.role !== 'assistant' || first.payload.kind !== 'results') throw new Error('expected results');
    const real = first.payload.index.find((e) => e.kind === 'variant')!;

    const ai: AiProvider = {
      name: 'fake',
      complete: vi.fn(async () =>
        JSON.stringify({
          statements: [
            { text: `A record named ${real.title} is listed.`, citations: [real.id], type: 'fact' },
            { text: 'This variant is definitely pathogenic in all patients.', citations: ['S999'], type: 'fact' },
          ],
          uncertainties: [],
        }),
      ),
    };
    const out = await turn({ env: baseEnv, sources, ai }, 'BRAF V600E');
    if (out.role !== 'assistant' || out.payload.kind !== 'results') throw new Error('expected results');
    expect(out.payload.answer.mode).toBe('ai');
    expect(out.payload.answer.removedCount).toBe(1);
    expect(out.payload.answer.markdown).not.toMatch(/definitely pathogenic/);
    expect(out.payload.answer.markdown).toMatch(new RegExp(`\\[${real.id}\\]\\(`));
  });

  it('falls back to the deterministic summary when every AI statement fails verification', async () => {
    const { sources } = fakeSources();
    const ai: AiProvider = { name: 'fake', complete: async () => JSON.stringify({ statements: [{ text: 'Invented claim here.', citations: ['S404'], type: 'fact' }], uncertainties: [] }) };
    const out = await turn({ env: baseEnv, sources, ai }, 'BRAF V600E');
    if (out.role !== 'assistant' || out.payload.kind !== 'results') throw new Error('expected results');
    expect(out.payload.answer.mode).toBe('deterministic');
    expect(out.payload.answer.notice).toMatch(/discarded/);
  });

  it('shows the user a clear notice, not a fake answer, when the AI provider fails', async () => {
    const { sources } = fakeSources();
    const ai: AiProvider = { name: 'fake', complete: async () => { throw new Error('boom'); } };
    const out = await turn({ env: baseEnv, sources, ai }, 'BRAF V600E');
    if (out.role !== 'assistant' || out.payload.kind !== 'results') throw new Error('expected results');
    expect(out.payload.answer.mode).toBe('deterministic');
    expect(out.payload.answer.notice).toMatch(/unavailable/i);
  });

  it('pasted report text: extracts for review, searches nothing, and keeps the report text out of the payload', async () => {
    const { sources, calls } = fakeSources();
    const secret = 'PATIENT-ZEBRA-7781';
    const text = `Patient ${secret}. ${'Specimen adequate. '.repeat(40)} BRAF V600E detected.`;
    const out = await turn({ env: baseEnv, sources, ai: null }, text);
    expect(calls).toEqual([]);
    if (out.role !== 'assistant' || out.payload.kind !== 'extraction_review') throw new Error('expected review');
    expect(out.payload.candidates.map((c) => c.hgvsProtein)).toContain('p.Val600Glu');
    expect(JSON.stringify(out)).not.toContain(secret);
  });

  it('report-derived findings never reach the AI provider without operator setting AND user consent', async () => {
    const { sources } = fakeSources();
    const complete = vi.fn(async () => '{}');
    const { runSearches } = await import('../src/services/chat/orchestrator.js');
    const { parseVariantInput } = await import('../src/services/variant-normalization/index.js');
    const v = [parseVariantInput('BRAF p.Val600Glu')];
    for (const [allow, consent] of [[false, true], [true, false], [false, false]] as const) {
      const r = await runSearches({ env: { AI_ALLOW_SENSITIVE_CONTENT: allow }, sources, ai: { name: 'fake', complete } }, v, {}, { reportDerived: true, userConsent: consent });
      expect(r.answer.mode).toBe('deterministic');
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it('answers a follow-up from stored results without new searches, and says deterministic mode cannot answer questions', async () => {
    const { sources, calls } = fakeSources();
    const first = await turn({ env: baseEnv, sources, ai: null }, 'BRAF V600E');
    if (first.role !== 'assistant' || first.payload.kind !== 'results') throw new Error('expected results');
    const before = calls.length;
    const out = await turn({ env: baseEnv, sources, ai: null }, 'why is the V600K record different?', { prior: first.payload.results });
    expect(calls.length).toBe(before);
    if (out.role !== 'assistant' || out.payload.kind !== 'results') throw new Error('expected results');
    expect(out.fresh).toBe(false);
    expect(out.payload.answer.notice).toMatch(/Follow-up questions are answered only when AI/);
  });

  it('asks for clarification when there is nothing to search', async () => {
    const { sources } = fakeSources();
    const out = await turn({ env: baseEnv, sources, ai: null }, 'hello there');
    expect(out.role).toBe('notice');
  });
});
