import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { extractText, getDocumentProxy } from 'unpdf';
import { MAX_PDF_PAGES, extractPdfText, looksLikePdf, readPdfPageCount } from '../src/services/reports/pdf.js';
import { ReportStore } from '../src/services/reports/store.js';
import { extractCandidates } from '../src/services/variant-normalization/index.js';
import { buildCsv, csvCell, CSV_COLUMNS } from '../src/services/exports/csv.js';
import { buildPdf, plainFromMarkdown } from '../src/services/exports/pdf.js';
import { collectRounds, type ExportData } from '../src/services/exports/collect.js';
import { handleTurn } from '../src/services/chat/orchestrator.js';
import { fakeSources } from './helpers/fakeSources.js';

function makePdf(pages: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    pages.forEach((t, i) => {
      if (i > 0) doc.addPage();
      if (t) doc.text(t);
    });
    doc.end();
  });
}

describe('PDF validation and extraction', () => {
  it('recognizes PDFs by content and rejects other files regardless of name', async () => {
    const pdf = await makePdf(['hello']);
    expect(looksLikePdf(pdf)).toBe(true);
    expect(looksLikePdf(Buffer.from('<html><script>alert(1)</script></html>'))).toBe(false);
    expect(looksLikePdf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe(false);
    expect(looksLikePdf(Buffer.from('MZ\x90\x00\x03\x00\x00\x00 renamed.exe.pdf'))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });

  it('extracts the text layer of a real PDF and finds findings in it', async () => {
    const pdf = await makePdf(['Molecular report. Specimen adequate for testing.', 'Result: BRAF V600E detected. KRAS p.Gly12Asp not detected in this assay run.']);
    expect(await readPdfPageCount(pdf)).toBe(2);
    const out = await extractPdfText(pdf);
    expect(out.pageCount).toBe(2);
    const cands = extractCandidates(out.text);
    expect(cands.map((c) => c.parsed.hgvsProtein)).toEqual(expect.arrayContaining(['p.Val600Glu', 'p.Gly12Asp']));
  });

  it('reports a PDF with no text layer instead of pretending it was processed (no OCR)', async () => {
    const blank = await makePdf(['', '']);
    await expect(extractPdfText(blank)).rejects.toMatchObject({ status: 422, code: 'NO_TEXT_LAYER' });
  });

  it('rejects PDFs over the page limit', async () => {
    const many = await makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => `Page ${i} has some text content here`));
    await expect(extractPdfText(many)).rejects.toMatchObject({ status: 413, code: 'PDF_TOO_MANY_PAGES' });
  });

  it('reports corrupted PDFs as unreadable without leaking internals', async () => {
    const corrupt = Buffer.from('%PDF-1.7\nthis is not a real pdf body at all');
    await expect(extractPdfText(corrupt)).rejects.toMatchObject({ status: 422, code: 'PDF_UNREADABLE' });
    await expect(readPdfPageCount(corrupt)).rejects.toMatchObject({ code: 'PDF_UNREADABLE' });
  });
});

describe('ReportStore', () => {
  it('enforces ownership: another user gets the same answer as a missing id', () => {
    const s = new ReportStore();
    const e = s.create({ userId: 'u1', buffer: Buffer.from('x') });
    expect(s.get(e.id, 'u1')).toBeDefined();
    expect(s.get(e.id, 'u2')).toBeUndefined();
    expect(s.get('does-not-exist', 'u1')).toBeUndefined();
  });

  it('expires entries and drops the raw bytes', () => {
    let t = 1_000;
    const s = new ReportStore(60_000, 10, () => t);
    const e = s.create({ userId: 'u1', buffer: Buffer.from('secret-bytes') });
    t += 59_000;
    expect(s.get(e.id, 'u1')).toBeDefined();
    t += 2_000;
    expect(s.get(e.id, 'u1')).toBeUndefined();
    expect(e.buffer).toBeNull();
    expect(s.size).toBe(0);
  });

  it('bounds memory by evicting the oldest entry', () => {
    let t = 0;
    const s = new ReportStore(60_000, 2, () => ++t);
    const a = s.create({ userId: 'u', buffer: Buffer.from('a') });
    s.create({ userId: 'u', buffer: Buffer.from('b') });
    s.create({ userId: 'u', buffer: Buffer.from('c') });
    expect(s.size).toBe(2);
    expect(s.get(a.id, 'u')).toBeUndefined();
  });

  it('removes everything for a user on request', () => {
    const s = new ReportStore();
    s.create({ userId: 'u1' });
    s.create({ userId: 'u2' });
    s.deleteForUser('u1');
    expect(s.size).toBe(1);
  });
});

describe('CSV export', () => {
  it('neutralizes spreadsheet formulas and quotes special characters', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    for (const lead of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) expect(csvCell(lead)).toMatch(/^"'/);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell('normal text')).toBe('"normal text"');
  });

  async function sampleData(): Promise<ExportData> {
    const { sources } = fakeSources();
    const out = await handleTurn({ env: { AI_ALLOW_SENSITIVE_CONTENT: false }, sources, ai: null }, { message: 'BRAF V600E in melanoma', context: {}, priorResults: [], userConsent: false });
    if (out.role !== 'assistant') throw new Error('expected assistant');
    const rounds = collectRounds([{ role: 'user' }, { role: 'assistant', payload: out.payload, createdAt: new Date('2026-10-24T00:00:00Z') }]);
    return { investigation: { title: 'Test investigation', cancerContext: 'melanoma', referenceGenome: null, transcriptId: null, createdAt: new Date('2026-10-24T00:00:00Z') }, rounds, generatedAt: '2026-10-24T01:00:00.000Z' };
  }

  it('contains the real retrieved records with identifiers, categories and dates', async () => {
    const data = await sampleData();
    const csv = buildCsv(data);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.map((c) => `"${c}"`).join(','));
    expect(lines.length).toBeGreaterThan(4);
    expect(csv).toMatch(/"clinvar","VCV000013961"/);
    expect(csv).toMatch(/"civic","EID1409"/);
    expect(csv).toMatch(/"pubmed","22222222"/);
    expect(csv).toMatch(/"clinicaltrials","NCT01234567"/);
    expect(csv).toMatch(/Equivalent representation/);
    expect(csv).toMatch(/Same position, different allele/i);
    expect(csv).toMatch(/2026-/); // retrieval dates present
  });

  it('keeps hostile record names inert', async () => {
    const data = await sampleData();
    const f = data.rounds[0]!.results[0]!.findings[0]!;
    f.record.ref.displayName = '=cmd|\' /C calc\'!A0';
    const csv = buildCsv(data);
    expect(csv).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csv).not.toMatch(/(^|,)"=cmd/m);
  });
});

describe('PDF export', () => {
  it('produces a real PDF containing the investigation data, sources, limits and safety statement', async () => {
    const { sources } = fakeSources();
    const out = await handleTurn({ env: { AI_ALLOW_SENSITIVE_CONTENT: false }, sources, ai: null }, { message: 'BRAF V600E in melanoma', context: {}, priorResults: [], userConsent: false });
    if (out.role !== 'assistant') throw new Error('expected assistant');
    const data: ExportData = {
      investigation: { title: 'BRAF melanoma review', cancerContext: 'melanoma', referenceGenome: 'GRCh38', transcriptId: null, createdAt: new Date('2026-10-24T00:00:00Z') },
      rounds: collectRounds([{ role: 'assistant', payload: out.payload, createdAt: new Date('2026-10-24T00:00:00Z') }]),
      generatedAt: '2026-10-24T01:00:00.000Z',
    };
    const buf = await buildPdf(data);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');

    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    for (const needle of [
      'Variant Evidence Report',
      'BRAF melanoma review',
      'It is not a diagnosis',
      'VCV000013961',
      'EID1409',
      'PMID 22222222',
      'NCT01234567',
      'does not establish eligibility',
      'Equivalent representation',
      'Source status and retrieval',
      'Evidence limitations',
      'Page 1 of',
    ]) {
      expect(flat, `PDF should contain "${needle}"`).toContain(needle);
    }
  });

  it('handles characters outside the built-in font without crashing', async () => {
    const buf = await buildPdf({ investigation: { title: 'Δ 変異 report', cancerContext: null, referenceGenome: null, transcriptId: null, createdAt: null }, rounds: [], generatedAt: '2026-10-24T01:00:00.000Z' });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('strips link syntax and markdown noise from summaries', () => {
    expect(plainFromMarkdown('**Exact** record [S3](https://x.test/a) \\(esc\\)')).toBe('Exact record [S3] (esc)');
  });
});
