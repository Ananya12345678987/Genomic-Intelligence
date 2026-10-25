/**
 * Runs the real Express routes and controllers with two seams replaced:
 *  - requireAuth reads a test header instead of a session (session/CSRF logic is covered by the
 *    database-backed suite in auth-investigations.integration.test.ts, which needs MongoDB);
 *  - the Mongoose models are an in-memory fake (see helpers/fakeModels.ts).
 * It proves controller wiring, validation, ownership and data flow, not MongoDB behaviour.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import PDFDocument from 'pdfkit';

vi.mock('../src/models/index.js', async () => (await import('./helpers/fakeModels.js')).fakeModels);
vi.mock('../src/middleware/auth.js', async () => {
  const { HttpError } = await import('../src/utils/httpError.js');
  return {
    requireAuth: (req: any, _res: unknown, next: (e?: unknown) => void) => {
      const u = req.get('x-test-user');
      if (!u) return next(HttpError.unauthorized());
      req.auth = { userId: u, role: 'researcher', csrfToken: 't', sessionToken: 's' };
      next();
    },
    authOf: (req: any) => {
      if (!req.auth) throw HttpError.unauthorized();
      return req.auth;
    },
  };
});

import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { fakeModels, resetFakeModels } from './helpers/fakeModels.js';
import { fakeSources } from './helpers/fakeSources.js';

const env = parseEnv({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://unused/test', SESSION_SECRET: 's'.repeat(48), RATE_LIMIT_MAX: '100000' } as NodeJS.ProcessEnv);
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

function makePdf(pages: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    pages.forEach((t, i) => { if (i) doc.addPage(); if (t) doc.text(t); });
    doc.end();
  });
}

let app: ReturnType<typeof createApp>;
let calls: string[];
beforeEach(() => {
  resetFakeModels();
  const f = fakeSources();
  calls = f.calls;
  app = createApp(env, { sources: f.sources, ai: null });
});

const as = (user: string) => ({
  post: (url: string) => request(app).post(url).set('x-test-user', user),
  get: (url: string) => request(app).get(url).set('x-test-user', user),
  patch: (url: string) => request(app).patch(url).set('x-test-user', user),
});

async function newInvestigation(user = A, title = 'Test') {
  const res = await as(user).post('/api/investigations').send({ title });
  expect(res.status).toBe(201);
  return res.body.investigation.id as string;
}

describe('access control', () => {
  it('requires sign-in for every research endpoint, and keeps unknown paths a plain 404', async () => {
    for (const [method, url] of [
      ['post', '/api/chat/message'], ['post', '/api/variants/search'], ['post', '/api/variants/normalize'],
      ['post', '/api/evidence/search'], ['post', '/api/publications/search'], ['post', '/api/trials/search'],
      ['post', '/api/reports/upload'], ['post', '/api/reports/export/pdf'], ['post', '/api/reports/export/csv'],
      ['get', '/api/settings'], ['get', '/api/variants/abc'], ['get', '/api/evidence/abc'],
    ] as const) {
      const res = await (request(app) as any)[method](url).send({});
      expect(res.status, `${method} ${url}`).toBe(401);
    }
    expect((await request(app).get('/api/definitely-not-a-route')).status).toBe(404);
    expect(calls).toEqual([]); // nothing reached an external service
  });

  it("does not let another user chat in, read, or export someone else's investigation", async () => {
    const id = await newInvestigation(A);
    await as(A).post('/api/chat/message').send({ investigationId: id, message: 'BRAF V600E' }).expect(201);

    expect((await as(B).post('/api/chat/message').send({ investigationId: id, message: 'BRAF' })).status).toBe(404);
    expect((await as(B).get(`/api/investigations/${id}/messages`)).status).toBe(404);
    expect((await as(B).post('/api/reports/export/csv').send({ investigationId: id })).status).toBe(404);
    expect((await as(B).post('/api/reports/export/pdf').send({ investigationId: id })).status).toBe(404);
  });
});

describe('chat → results → persistence', () => {
  it('runs a search, returns verified citations, and stores structured records', async () => {
    const id = await newInvestigation();
    const res = await as(A).post('/api/chat/message').send({ investigationId: id, message: 'Investigate BRAF V600E in melanoma.' });
    expect(res.status).toBe(201);
    const { assistantMessage, userMessage } = res.body;
    expect(userMessage.content).toBe('Investigate BRAF V600E in melanoma.');
    expect(assistantMessage.payload.kind).toBe('results');
    expect(assistantMessage.payload.safetyNotice).toMatch(/not a diagnosis/);
    expect(assistantMessage.citationReferences.length).toBeGreaterThan(0);
    for (const c of assistantMessage.citationReferences) {
      expect(assistantMessage.payload.index.some((e: any) => e.id === c.refId && e.url === c.canonicalUrl)).toBe(true);
    }

    const inv = fakeModels.Investigation.docs[0]!;
    expect(inv.status).toBe('complete');
    expect(inv.inputType).toBe('variant');
    expect(inv.inputMetadata.cancerType).toBe('melanoma');

    // Structured persistence
    const submitted = fakeModels.Variant.docs.find((v) => v.userId === A);
    expect(submitted).toMatchObject({ geneSymbol: 'BRAF', hgvsProtein: 'p.Val600Glu', investigationId: id });
    expect(submitted!.referenceGenome ?? null).toBeNull(); // never guessed
    expect(submitted!.transcriptId ?? null).toBeNull();
    expect(fakeModels.MatchResult.docs.length).toBeGreaterThan(0);
    expect(fakeModels.MatchResult.docs.every((m) => !('confidence' in m))).toBe(true);
    expect(fakeModels.EvidenceRecord.docs.some((e) => e.source === 'civic' && e.sourceRecordId === 'EID1409')).toBe(true);
    expect(fakeModels.Publication.docs.length).toBeGreaterThan(0);
    expect(fakeModels.ClinicalTrial.docs[0]!.nctId).toBe('NCT01234567');

    const history = await as(A).get(`/api/investigations/${id}/messages`);
    expect(history.body.items.map((m: any) => m.role)).toEqual(['user', 'assistant']);
  });

  it('answers a follow-up from stored results without new external calls or new records', async () => {
    const id = await newInvestigation();
    await as(A).post('/api/chat/message').send({ investigationId: id, message: 'BRAF V600E' }).expect(201);
    const callsBefore = calls.length;
    const variantsBefore = fakeModels.Variant.docs.length;
    const res = await as(A).post('/api/chat/message').send({ investigationId: id, message: 'why is the V600K record different?' });
    expect(res.status).toBe(201);
    expect(calls.length).toBe(callsBefore);
    expect(fakeModels.Variant.docs.length).toBe(variantsBefore);
  });

  it('asks for clarification instead of searching when nothing can be searched', async () => {
    const id = await newInvestigation();
    const res = await as(A).post('/api/chat/message').send({ investigationId: id, message: 'hello' });
    expect(res.body.assistantMessage.role).toBe('notice');
    expect(calls).toEqual([]);
  });

  it('validates input', async () => {
    const id = await newInvestigation();
    expect((await as(A).post('/api/chat/message').send({ investigationId: 'not-an-id', message: 'x' })).status).toBe(400);
    expect((await as(A).post('/api/chat/message').send({ investigationId: id })).status).toBe(400);
    expect((await as(A).post('/api/chat/message').send({ investigationId: id, message: '   ' })).status).toBe(400);
    expect((await as(A).post('/api/chat/message').send({ investigationId: id, message: 'BRAF', context: { referenceGenome: 'hg19' } })).status).toBe(400);
    // NoSQL operator objects are rejected by validation, never reaching a query.
    expect((await as(A).post('/api/chat/message').send({ investigationId: { $ne: null }, message: 'BRAF' })).status).toBe(400);
  });
});

describe('pasted report text', () => {
  it('is reviewed before any search and is never stored in conversation history', async () => {
    const id = await newInvestigation();
    const secret = 'PATIENT-ZEBRA-7781';
    const text = `Patient ${secret}. ${'Specimen adequate. '.repeat(40)} Results: BRAF V600E detected; KRAS G12D detected.`;
    const res = await as(A).post('/api/chat/message').send({ investigationId: id, message: text });
    expect(res.status).toBe(201);
    expect(calls).toEqual([]);
    const p = res.body.assistantMessage.payload;
    expect(p.kind).toBe('extraction_review');
    expect(p.reportId).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.userMessage.content).toMatch(/not stored/);
    expect(JSON.stringify(fakeModels.ConversationMessage.docs)).not.toContain(secret);
    expect(fakeModels.Investigation.docs[0]!.status).toBe('awaiting_confirmation');

    // Confirm a corrected selection.
    const braf = p.candidates.find((c: any) => c.hgvsProtein === 'p.Val600Glu');
    const kras = p.candidates.find((c: any) => c.hgvsProtein === 'p.Gly12Asp');
    const confirm = await as(A).post(`/api/reports/${p.reportId}/confirm-variants`).send({
      investigationId: id,
      selections: [{ id: braf.id }, { id: kras.id, text: 'KRAS p.Gly12Cys' }],
    });
    expect(confirm.status).toBe(201);
    const results = confirm.body.assistantMessage.payload.results;
    expect(results.map((r: any) => r.submitted.hgvsProtein)).toEqual(['p.Val600Glu', 'p.Gly12Cys']);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('refuses another user, unknown selections and uninterpretable corrections', async () => {
    const id = await newInvestigation();
    const text = `${'Specimen adequate. '.repeat(40)} BRAF V600E detected.`;
    const p = (await as(A).post('/api/chat/message').send({ investigationId: id, message: text })).body.assistantMessage.payload;
    const sel = [{ id: p.candidates[0].id }];
    expect((await as(B).post(`/api/reports/${p.reportId}/confirm-variants`).send({ investigationId: id, selections: sel })).status).toBe(404);
    expect((await as(A).post(`/api/reports/${p.reportId}/confirm-variants`).send({ investigationId: id, selections: [{ id: 'nope' }] })).status).toBe(400);
    const bad = await as(A).post(`/api/reports/${p.reportId}/confirm-variants`).send({ investigationId: id, selections: [{ id: p.candidates[0].id, text: '???' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('UNRESOLVED_FINDING');
    expect((await as(A).post('/api/reports/short/confirm-variants').send({ investigationId: id, selections: sel })).status).toBe(400);
  });
});

describe('PDF upload → extract → confirm', () => {
  const upload = (user: string, buf: Buffer, filename = 'report.pdf', fields: Record<string, string> = {}) => {
    let r = as(user).post('/api/reports/upload');
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', buf, { filename, contentType: 'application/pdf' });
  };

  it('processes a text PDF end to end and never echoes the file name', async () => {
    const id = await newInvestigation();
    const pdf = await makePdf(['Clinical molecular report for research review purposes.', 'Variant found: BRAF V600E. Also tested KRAS p.Gly12Asp, no change.']);
    const up = await upload(A, pdf, 'JOHN-DOE-MRN-4471.pdf', { investigationId: id });
    expect(up.status).toBe(201);
    expect(up.body.pageCount).toBe(2);
    expect(JSON.stringify(up.body)).not.toMatch(/JOHN|4471/);

    const ex = await as(A).post(`/api/reports/${up.body.reportId}/extract`).send({ investigationId: id });
    expect(ex.status).toBe(200);
    expect(ex.body.payload.kind).toBe('extraction_review');
    expect(ex.body.payload.pageCount).toBe(2);
    expect(ex.body.payload.candidates.map((c: any) => c.hgvsProtein)).toEqual(expect.arrayContaining(['p.Val600Glu', 'p.Gly12Asp']));
    expect(calls).toEqual([]); // extraction alone searches nothing
    expect(JSON.stringify(fakeModels.ConversationMessage.docs)).not.toMatch(/JOHN|4471|Clinical molecular report/);
    expect(fakeModels.Investigation.docs[0]!.inputType).toBe('report_pdf');

    // Extraction is idempotent (the file bytes are gone after the first call).
    const again = await as(A).post(`/api/reports/${up.body.reportId}/extract`).send({ investigationId: id });
    expect(again.status).toBe(200);
    expect(again.body.payload.candidates.length).toBe(ex.body.payload.candidates.length);

    const first = ex.body.payload.candidates.find((c: any) => c.hgvsProtein === 'p.Val600Glu');
    const confirm = await as(A).post(`/api/reports/${up.body.reportId}/confirm-variants`).send({ investigationId: id, selections: [{ id: first.id }] });
    expect(confirm.status).toBe(201);
    expect(confirm.body.assistantMessage.payload.kind).toBe('results');
  });

  it('rejects files that are not PDFs even when named and typed like one', async () => {
    const res = await upload(A, Buffer.from('<html><script>alert(1)</script></html>'), 'report.pdf');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects oversized files and missing files', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 10, 0x20)]);
    const res = await upload(A, big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect((await as(A).post('/api/reports/upload').send({})).status).toBe(400);
  });

  it('reports a scanned (no text layer) PDF honestly', async () => {
    const up = await upload(A, await makePdf(['', '']));
    expect(up.status).toBe(201);
    const ex = await as(A).post(`/api/reports/${up.body.reportId}/extract`).send({});
    expect(ex.status).toBe(422);
    expect(ex.body.error.code).toBe('NO_TEXT_LAYER');
    expect(ex.body.error.message).toMatch(/OCR is not supported/);
  });

  it("does not let another user extract someone else's upload, or upload into their investigation", async () => {
    const id = await newInvestigation(A);
    const up = await upload(A, await makePdf(['BRAF V600E detected in this specimen report text.']));
    expect((await as(B).post(`/api/reports/${up.body.reportId}/extract`).send({})).status).toBe(404);
    expect((await upload(B, await makePdf(['BRAF V600E']), 'r.pdf', { investigationId: id })).status).toBe(404);
  });
});

describe('exports', () => {
  it('refuses to export an investigation with no results rather than reporting success', async () => {
    const id = await newInvestigation();
    for (const kind of ['pdf', 'csv']) {
      const res = await as(A).post(`/api/reports/export/${kind}`).send({ investigationId: id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOTHING_TO_EXPORT');
    }
  });

  it('downloads a CSV and a PDF built from the saved investigation, as private non-cacheable attachments', async () => {
    const id = await newInvestigation(A, 'BRAF melanoma review');
    await as(A).post('/api/chat/message').send({ investigationId: id, message: 'BRAF V600E in melanoma' }).expect(201);

    const csv = await as(A).post('/api/reports/export/csv').send({ investigationId: id });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="variant-evidence-\d{8}\.csv"$/);
    expect(csv.headers['cache-control']).toMatch(/no-store/);
    expect(csv.text).toMatch(/VCV000013961/);
    expect(csv.text).toMatch(/NCT01234567/);

    const pdf = await as(A).post('/api/reports/export/pdf').send({ investigationId: id }).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toMatch(/no-store/);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('direct search endpoints', () => {
  it('normalizes without calling any external service', async () => {
    const res = await as(A).post('/api/variants/normalize').send({ query: 'BRAF p.Val600Glu' });
    expect(res.status).toBe(200);
    expect(res.body.normalized).toMatchObject({ geneSymbol: 'BRAF', hgvsProtein: 'p.Val600Glu', normalizationStatus: 'protein_change', referenceGenome: null, transcriptId: null });
    expect(calls).toEqual([]);
  });

  it('searches variants with provenance and refuses unresolvable input with a helpful error', async () => {
    const ok = await as(A).post('/api/variants/search').send({ query: 'BRAF p.Val600Glu', cancerType: 'melanoma' });
    expect(ok.status).toBe(200);
    expect(ok.body.result.findings.length).toBeGreaterThan(0);
    expect(ok.body.result.sourceStatuses.map((s: any) => s.source).sort()).toEqual(['civic', 'clinicaltrials', 'clinvar', 'pubmed']);
    expect(ok.body.saved).toBe(false); // no investigation given, nothing persisted

    const bad = await as(A).post('/api/variants/search').send({ query: '????' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('UNRESOLVED_FINDING');
  });

  it('paginates evidence records, and serves publications and trials with source metadata', async () => {
    const ev = await as(A).post('/api/evidence/search').send({ query: 'BRAF p.Val600Glu', limit: 2, page: 1 });
    expect(ev.status).toBe(200);
    expect(ev.body.items.length).toBe(2);
    expect(ev.body.total).toBeGreaterThan(2);
    const page2 = await as(A).post('/api/evidence/search').send({ query: 'BRAF p.Val600Glu', limit: 2, page: 2 });
    expect(page2.body.items[0].id).not.toBe(ev.body.items[0].id);

    const pubs = await as(A).post('/api/publications/search').send({ geneSymbol: 'BRAF', cancerType: 'melanoma' });
    expect(pubs.status).toBe(200);
    expect(pubs.body.source).toBe('pubmed');
    expect(pubs.body.items[0].canonicalUrl).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/);
    expect(pubs.body.retrievedAt).toBeTruthy();

    const trials = await as(A).post('/api/trials/search').send({ geneSymbol: 'BRAF', cancerType: 'melanoma' });
    expect(trials.status).toBe(200);
    expect(trials.body.items[0].canonicalUrl).toBe('https://clinicaltrials.gov/study/NCT01234567');
    expect(trials.body.notice).toMatch(/eligibility/);
    expect((await as(A).post('/api/trials/search').send({})).status).toBe(400);
  });

  it("only shows a user their own submitted variants", async () => {
    const id = await newInvestigation(A);
    await as(A).post('/api/variants/search').send({ query: 'BRAF p.Val600Glu', investigationId: id }).expect(200);
    const mine = fakeModels.Variant.docs.find((v) => v.userId === A)!;
    expect((await as(A).get(`/api/variants/${mine._id}`)).status).toBe(200);
    expect((await as(B).get(`/api/variants/${mine._id}`)).status).toBe(404);
    expect((await as(B).post('/api/variants/search').send({ query: 'BRAF p.Val600Glu', investigationId: id })).status).toBe(404);
  });
});

describe('settings and consent', () => {
  it('records and revokes AI consent for report-derived content', async () => {
    const on = await as(A).patch('/api/settings').send({ aiSensitiveContentConsent: true });
    expect(on.body.settings.aiSensitiveContentConsent).toBe(true);
    expect(on.body.settings.aiSensitiveContentConsentAt).toBeTruthy();
    const off = await as(A).patch('/api/settings').send({ aiSensitiveContentConsent: false });
    expect(off.body.settings.aiSensitiveContentConsent).toBe(false);
    expect(off.body.settings.aiSensitiveContentConsentAt).toBeNull();
    expect((await as(A).patch('/api/settings').send({ role: 'admin' })).status).toBe(400); // unknown field rejected
    expect((await as(B).get('/api/settings')).body.settings.aiSensitiveContentConsent).toBe(false);
  });
});

describe('deleting an investigation removes its records', () => {
  it('cascades to messages, match results and submitted variants', async () => {
    const id = await newInvestigation();
    await as(A).post('/api/chat/message').send({ investigationId: id, message: 'BRAF V600E' }).expect(201);
    expect(fakeModels.Variant.docs.some((v) => v.userId === A)).toBe(true);
    const del = await request(app).delete(`/api/investigations/${id}`).set('x-test-user', A);
    expect(del.status).toBe(204);
    expect(fakeModels.ConversationMessage.docs).toEqual([]);
    expect(fakeModels.MatchResult.docs).toEqual([]);
    expect(fakeModels.Variant.docs.some((v) => v.userId === A)).toBe(false);
  });
});
