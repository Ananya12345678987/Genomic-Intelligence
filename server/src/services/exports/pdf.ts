import PDFDocument from 'pdfkit';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../matching/index.js';
import type { MatchedFinding, SearchResult } from '../../types/domain.js';
import type { ExportData } from './collect.js';

export const BRAND_PLACEHOLDER = '[Startup Name]';

export const SCOPE_STATEMENT =
  'This report supports research and evidence review. It is not a diagnosis, a treatment recommendation, or a clinical interpretation, and it has not been clinically validated. Source classifications keep their original meaning: a classification of variant pathogenicity is not a statement about treatment actionability, and a shared gene, variant or cancer type does not establish clinical-trial eligibility. Clinical decisions belong with qualified professionals who have the full clinical context.';

// Built-in PDF fonts cover WinAnsi only; anything else would render as garbage, so mark it explicitly.
const pdfSafe = (s: unknown): string =>
  String(s ?? '').replace(/[^\u0009\u000A\u000D -~ -ÿ–—‘’“”…•]/g, '?');

/** Turn the stored markdown summary into readable plain text for the PDF. */
export function plainFromMarkdown(md: string): string {
  return md
    .replace(/\[(S\d{1,4})\]\([^)]*\)/g, '[$1]')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\\([\\`*_{}[\]()#+!|<>])/g, '$1')
    .replace(/^---$/gm, '');
}

const C = { ink: '#344536', soft: '#5E6A57', line: '#DDE2D1', band: '#EEF1E3', warn: '#7A5A12' };

export function buildPdf(data: ExportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 64, left: 54, right: 54 },
      bufferPages: true,
      info: { Title: `Research report: ${pdfSafe(data.investigation.title)}`, Producer: 'Cancer Genomic Intelligence (prototype)' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const h1 = (t: string) => doc.moveDown(0.6).font('Helvetica-Bold').fontSize(14).fillColor(C.ink).text(pdfSafe(t), { width: W });
    const h2 = (t: string) => doc.moveDown(0.5).font('Helvetica-Bold').fontSize(11.5).fillColor(C.ink).text(pdfSafe(t), { width: W });
    const h3 = (t: string) => doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(pdfSafe(t), { width: W });
    const p = (t: string, color = C.ink, size = 9.5) => doc.font('Helvetica').fontSize(size).fillColor(color).text(pdfSafe(t), { width: W });
    const mono = (t: string) => doc.font('Courier').fontSize(9).fillColor(C.ink).text(pdfSafe(t), { width: W });
    const kv = (k: string, v: unknown) => {
      if (v === null || v === undefined || v === '') return;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.soft).text(`${pdfSafe(k)}: `, { continued: true, width: W });
      doc.font('Helvetica').fillColor(C.ink).text(pdfSafe(v), { width: W });
    };
    const rule = () => {
      doc.moveDown(0.4);
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + W, doc.y).strokeColor(C.line).lineWidth(0.7).stroke();
      doc.moveDown(0.4);
    };

    // Title block
    doc.font('Helvetica').fontSize(9).fillColor(C.soft).text(pdfSafe(BRAND_PLACEHOLDER));
    doc.font('Helvetica-Bold').fontSize(20).fillColor(C.ink).text('Variant Evidence Report', { width: W });
    doc.font('Helvetica').fontSize(10).fillColor(C.soft).text(`Generated ${data.generatedAt}`);
    rule();

    h2('Investigation');
    kv('Title', data.investigation.title);
    kv('Cancer context (as entered)', data.investigation.cancerContext);
    kv('Reference genome (as entered)', data.investigation.referenceGenome);
    kv('Transcript (as entered)', data.investigation.transcriptId);
    kv('Created', data.investigation.createdAt ? new Date(data.investigation.createdAt).toISOString() : null);
    kv('Search rounds included', data.rounds.length);

    doc.moveDown(0.6);
    const boxY = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.warn).text('Scope and safety', doc.page.margins.left + 8, boxY + 6, { width: W - 16 });
    doc.font('Helvetica').fontSize(8.8).fillColor(C.ink).text(pdfSafe(SCOPE_STATEMENT), doc.page.margins.left + 8, doc.y + 2, { width: W - 16 });
    const boxH = doc.y + 6 - boxY;
    doc.save().rect(doc.page.margins.left, boxY, W, boxH).strokeColor(C.line).lineWidth(0.8).stroke().restore();
    doc.y = boxY + boxH + 4;

    if (!data.rounds.length) {
      h1('No results');
      p('This investigation has no saved search results to report. Run a search and export again.');
    }

    let roundNo = 0;
    for (const round of data.rounds) {
      roundNo++;
      h1(`Search round ${roundNo}`);
      if (round.createdAt) p(`Run ${new Date(round.createdAt).toISOString()}`, C.soft, 8.5);

      if (round.answer) {
        h2('Summary');
        p(
          round.answer.mode === 'ai'
            ? `AI-assisted summary (${round.answer.provider ?? 'provider'}). Each statement was checked against a record retrieved in this search; the model's statements are not independent sources.`
            : 'Summary assembled directly from retrieved records without an AI model.',
          C.soft,
          8.5,
        );
        doc.moveDown(0.2);
        p(plainFromMarkdown(round.answer.markdown));
        if (round.answer.notice) p(round.answer.notice, C.warn, 8.5);
      }
      for (const r of round.results) renderResult(r);
    }

    h1('Evidence limitations');
    for (const line of [
      'Results come only from the sources queried at the retrieval times shown; they do not cover every known variant or publication.',
      'Match categories describe how a retrieved record relates to the submitted notation. Biological similarity is not equivalent clinical significance.',
      'Abstracts are not full articles; the complete articles were not reviewed.',
      'Trial status changes. Check each ClinicalTrials.gov record directly before relying on it.',
      'Somatic or germline origin of a submitted finding is not established by this report.',
    ]) p(`• ${line}`, C.ink, 9);

    function renderResult(r: SearchResult) {
      const s = r.submitted;
      h2(`Submitted finding: ${s.geneSymbol ?? 'unknown gene'} ${s.hgvsProtein ?? s.hgvsCoding ?? s.hgvsGenomic ?? s.rsId ?? ''}`.trim());
      kv('As entered', s.sourceRepresentation);
      kv('Normalization level', s.normalizationStatus.replace(/_/g, ' '));
      kv('Gene', s.geneSymbol);
      kv('HGVS protein', s.hgvsProtein);
      kv('HGVS coding', s.hgvsCoding);
      kv('HGVS genomic', s.hgvsGenomic);
      kv('Transcript', s.transcriptId);
      kv('Reference genome', s.referenceGenome);
      kv('Coordinates', s.chromosome && s.position ? `${s.chromosome}:${s.position} ${s.referenceAllele ?? '?'}>${s.alternateAllele ?? '?'}` : null);
      kv('rsID', s.rsId);
      kv('Cancer context for search', r.context.cancerType);
      if (s.missing.length) kv('Not provided', s.missing.join('; '));
      for (const w of s.warnings) p(`Note: ${w}`, C.warn, 8.5);

      const sorted = [...r.findings].sort((a, b) => CATEGORY_ORDER[a.decision.category] - CATEGORY_ORDER[b.decision.category]);
      const exact = sorted.filter((f) => f.decision.category === 'exact_normalized');
      h3(exact.length ? `Exact normalized matches (${exact.length})` : 'No exact normalized match was found in the sources queried');
      for (const f of exact) renderFinding(f);

      const others = sorted.filter((f) => f.decision.category !== 'exact_normalized');
      if (others.length) {
        h3(`Related findings, not exact matches (${others.length})`);
        for (const f of others.slice(0, 25)) renderFinding(f);
        if (others.length > 25) p(`…and ${others.length - 25} more not shown. Use the CSV export for the full list.`, C.soft, 8.5);
      }

      if (r.publications.length) {
        h3(`Publications (${r.publications.length}), abstract-level only`);
        for (const pub of r.publications.slice(0, 20)) {
          p(`${pub.title}`, C.ink, 9);
          p(`${pub.authors.slice(0, 4).join(', ')}${pub.authors.length > 4 ? ' et al.' : ''}. ${pub.journal ?? ''} ${pub.publicationDate ?? ''}. PMID ${pub.pmid}${pub.doi ? `, DOI ${pub.doi}` : ''}`, C.soft, 8.5);
          p(pub.canonicalUrl, C.soft, 8);
          doc.moveDown(0.2);
        }
      }
      if (r.trials.length) {
        h3(`Clinical trials (${r.trials.length}), text-search matches only`);
        p('A shared gene, variant or cancer type does not establish eligibility for any trial.', C.warn, 8.5);
        for (const t of r.trials.slice(0, 20)) {
          p(`${t.nctId}: ${t.title}`, C.ink, 9);
          p(`Status as reported: ${t.status ?? 'not stated'}. Conditions: ${t.conditions.join('; ') || 'not stated'}. Interventions: ${t.interventions.join('; ') || 'not stated'}. Source updated: ${t.sourceUpdatedAt ?? 'not stated'}. Retrieved: ${t.retrievedAt}.`, C.soft, 8.5);
          p(t.canonicalUrl, C.soft, 8);
          doc.moveDown(0.2);
        }
      }

      h3('Source status and retrieval');
      for (const st of r.sourceStatuses) {
        p(`${st.source}: ${st.status}${st.message ? ` (${st.message})` : ''}. Retrieved ${st.retrievedAt}${st.fromCache ? ' (from cache)' : ''}.`, C.soft, 8.5);
      }
      for (const n of r.notices) p(`• ${n}`, C.ink, 8.8);
    }

    function renderFinding(f: MatchedFinding) {
      doc.moveDown(0.25);
      p(`${f.record.ref.displayName}`, C.ink, 9.5);
      kv('Match category', CATEGORY_LABELS[f.decision.category]);
      kv('Why retrieved', f.decision.rationale);
      kv('Differs from submission', f.decision.differingFields.join('; '));
      kv('Source', `${f.record.ref.source} ${f.record.ref.sourceRecordId}`);
      kv('Record updated at source', f.record.sourceUpdatedAt);
      kv('Retrieved', f.record.retrievedAt);
      for (const c of f.record.classifications) {
        kv(`Classification (${c.scope.replace(/_/g, ' ')})`, `${c.label}${c.reviewStatus ? `; review status: ${c.reviewStatus}` : ''}${c.lastEvaluated ? `; last evaluated: ${c.lastEvaluated}` : ''}${c.conditions?.length ? `; conditions: ${c.conditions.join(', ')}` : ''}`);
      }
      for (const e of f.evidence.slice(0, 8)) {
        kv(`CIViC ${e.sourceRecordId}`, [e.evidenceType, e.evidenceLevel && `level ${e.evidenceLevel}`, e.evidenceDirection, e.significance, e.disease, e.therapies.length ? `therapies: ${e.therapies.join(', ')}` : null, e.pmids.length ? `PMID ${e.pmids.join(', ')}` : null].filter(Boolean).join('; '));
      }
      if (f.evidence.length > 8) p(`…and ${f.evidence.length - 8} more evidence items for this record.`, C.soft, 8.5);
      for (const m of f.assessment.evidenceCompleteness.missing) p(`Missing: ${m}`, C.warn, 8.5);
      mono(f.record.ref.canonicalUrl);
    }

    // Footer on every page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // allow drawing in the margin without triggering a new page
      doc.font('Helvetica').fontSize(7.5).fillColor(C.soft).text(
        `Research support only. Not a diagnosis or treatment recommendation.   Page ${i + 1} of ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 38,
        { width: W, align: 'center', lineBreak: false },
      );
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
