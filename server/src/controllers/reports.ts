import type { Request, Response } from 'express';
import multer from 'multer';
import { authOf } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../config/logger.js';
import { findOwnedInvestigationById } from './investigations.js';
import { confirmVariantsSchema, extractSchema, reportIdParam, uploadFieldsSchema } from '../validators/search.js';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, extractPdfText, looksLikePdf, readPdfPageCount } from '../services/reports/pdf.js';
import { extractCandidates, parseVariantInput } from '../services/variant-normalization/index.js';
import { runSearches, resultsOutcome, toReviewCandidate, type AssistantPayload } from '../services/chat/orchestrator.js';
import { persistSearch } from '../services/persistence/persist.js';
import type { AppDeps } from '../services/deps.js';
import type { Env } from '../config/env.js';
import type { ParsedVariant } from '../types/domain.js';
import { presentMessage, saveAssistantMessage, saveUserMessage, userHasAiConsent } from './messages.js';

/** Memory storage on purpose: no temp files, no paths, nothing to clean up on disk. */
export const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 4, parts: 6, fieldSize: 1024 },
}).single('file');

export function reportsController(env: Env, deps: AppDeps) {
  return {
    async upload(req: Request, res: Response) {
      const { userId } = authOf(req);
      const fields = uploadFieldsSchema.parse(req.body ?? {});
      if (fields.investigationId) await findOwnedInvestigationById(userId, fields.investigationId);

      const file = req.file;
      if (!file) throw HttpError.badRequest('Attach a PDF file in the "file" field.');
      // Content check, not filename or declared MIME type.
      if (!looksLikePdf(file.buffer)) {
        throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF files are supported. The file does not look like a PDF.');
      }
      const pageCount = await readPdfPageCount(file.buffer);
      if (pageCount > MAX_PDF_PAGES) {
        throw new HttpError(413, 'PDF_TOO_MANY_PAGES', `This PDF has ${pageCount} pages; the limit is ${MAX_PDF_PAGES}.`);
      }
      const entry = deps.reports.create({ userId: String(userId), investigationId: fields.investigationId ?? null, buffer: file.buffer, pageCount, reportDerived: true });
      // The original file name is intentionally neither stored nor echoed.
      res.status(201).json({ reportId: entry.id, pageCount, sizeBytes: file.size, expiresAt: new Date(entry.expiresAt).toISOString() });
    },

    async extract(req: Request, res: Response) {
      const { userId } = authOf(req);
      const { id } = reportIdParam.parse(req.params);
      const body = extractSchema.parse(req.body ?? {});
      const entry = deps.reports.get(id, String(userId));
      if (!entry) throw HttpError.notFound('Report not found or expired. Upload it again.');

      const investigationId = body.investigationId ?? entry.investigationId;
      const inv = investigationId ? await findOwnedInvestigationById(userId, investigationId) : null;

      if (!entry.candidates) {
        if (!entry.buffer) throw new HttpError(409, 'REPORT_NOT_AVAILABLE', 'The uploaded file is no longer available. Upload it again.');
        const { pageCount, text, truncated } = await extractPdfText(entry.buffer);
        entry.candidates = extractCandidates(text, { referenceGenome: body.referenceGenome ?? null });
        entry.pageCount = pageCount;
        entry.buffer = null; // the raw file is dropped as soon as extraction finishes
        if (truncated) logger.info('PDF text truncated before extraction');
      }
      const found = entry.candidates.length;
      const payload: AssistantPayload = {
        kind: 'extraction_review',
        reportId: entry.id,
        candidates: entry.candidates.map(toReviewCandidate),
        context: { cancerType: inv?.inputMetadata?.cancerType ?? null, referenceGenome: body.referenceGenome ?? null, transcriptId: null },
        pageCount: entry.pageCount,
        notice: found
          ? `Found ${found} candidate finding${found === 1 ? '' : 's'} in ${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'} by text pattern matching. Review, correct and select the ones to investigate. The PDF and its text were not stored.`
          : 'No gene or variant notation was recognized in this PDF. The PDF and its text were not stored. You can enter a finding manually.',
      };

      let messages: { userMessage: ReturnType<typeof presentMessage>; assistantMessage: ReturnType<typeof presentMessage> } | null = null;
      if (inv) {
        const userMsg = await saveUserMessage(inv._id, `[PDF report uploaded: ${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'}. The file was processed and not stored.]`);
        const aMsg = await saveAssistantMessage(inv._id, 'assistant', `Extracted ${found} candidate finding${found === 1 ? '' : 's'} for your review.`, payload, []);
        inv.status = 'awaiting_confirmation';
        inv.inputType = 'report_pdf';
        await inv.save();
        messages = { userMessage: presentMessage(userMsg), assistantMessage: presentMessage(aMsg) };
      }
      res.json({ reportId: entry.id, payload, ...(messages ?? {}) });
    },

    async confirm(req: Request, res: Response) {
      const { userId } = authOf(req);
      const { id } = reportIdParam.parse(req.params);
      const body = confirmVariantsSchema.parse(req.body);
      const entry = deps.reports.get(id, String(userId));
      if (!entry?.candidates) throw HttpError.notFound('Extraction review not found or expired. Extract the report again.');
      const inv = await findOwnedInvestigationById(userId, body.investigationId);

      const ctx = {
        cancerType: body.context?.cancerType ?? inv.inputMetadata?.cancerType ?? null,
        referenceGenome: body.context?.referenceGenome ?? null,
        transcriptId: body.context?.transcriptId ?? null,
      };

      const variants: ParsedVariant[] = [];
      for (const sel of body.selections) {
        const cand = entry.candidates.find((c) => c.id === sel.id);
        if (!cand) throw HttpError.badRequest('One of the selected findings is not part of this review.');
        // A user correction is re-parsed; nothing is carried over from the earlier extraction guess.
        const parsed = sel.text && sel.text !== cand.text ? parseVariantInput(sel.text, { referenceGenome: ctx.referenceGenome }) : cand.parsed;
        if (parsed.normalizationStatus === 'unresolved') {
          throw new HttpError(422, 'UNRESOLVED_FINDING', `"${(sel.text ?? cand.text).slice(0, 80)}" could not be interpreted as a gene or variant. Correct it or deselect it.`);
        }
        variants.push(parsed);
      }

      const userConsent = await userHasAiConsent(userId);
      const { results, answer, index } = await runSearches(
        { env, sources: deps.sources, ai: deps.ai },
        variants,
        ctx,
        { reportDerived: entry.reportDerived, userConsent },
      );
      const outcome = resultsOutcome(results, answer, index, ctx.cancerType, true);

      const userMsg = await saveUserMessage(inv._id, `Investigate ${variants.length} reviewed finding${variants.length === 1 ? '' : 's'} from the report.`);
      const aMsg = await saveAssistantMessage(inv._id, 'assistant', outcome.content, outcome.payload as AssistantPayload, outcome.citations);
      inv.status = 'complete';
      await inv.save();

      const notices: string[] = [];
      try {
        await persistSearch({ userId, investigationId: inv._id, results });
      } catch (err) {
        logger.warn({ message: (err as Error).message }, 'Could not persist structured search records');
        notices.push('The results could not be saved as structured records, but they are included in this conversation.');
      }
      res.status(201).json({ userMessage: presentMessage(userMsg), assistantMessage: presentMessage(aMsg), notices });
    },
  };
}
