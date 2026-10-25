import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { authOf } from '../middleware/auth.js';
import { findOwnedInvestigationById } from './investigations.js';
import { chatMessageSchema } from '../validators/search.js';
import { handleTurn, type AssistantPayload } from '../services/chat/orchestrator.js';
import { REPORT_TEXT_THRESHOLD } from '../services/chat/intent.js';
import { persistSearch } from '../services/persistence/persist.js';
import type { AppDeps } from '../services/deps.js';
import { REDACTED_REPORT_NOTE, loadPriorResults, presentMessage, saveAssistantMessage, saveUserMessage, userHasAiConsent } from './messages.js';

export function chatController(env: Env, deps: AppDeps) {
  return {
    async message(req: Request, res: Response) {
      const { userId } = authOf(req);
      const body = chatMessageSchema.parse(req.body);
      const inv = await findOwnedInvestigationById(userId, body.investigationId);

      const meta = inv.inputMetadata;
      const context = {
        cancerType: body.context?.cancerType ?? meta?.cancerType ?? inv.selectedCancerContext ?? null,
        referenceGenome: body.context?.referenceGenome ?? (meta?.referenceGenome as 'GRCh37' | 'GRCh38' | null | undefined) ?? null,
        transcriptId: body.context?.transcriptId ?? meta?.transcriptId ?? null,
      };

      const [priorResults, userConsent] = await Promise.all([loadPriorResults(inv._id), userHasAiConsent(userId)]);
      const outcome = await handleTurn({ env, sources: deps.sources, ai: deps.ai }, { message: body.message, context, priorResults, userConsent });

      // Long pasted text is report content: it is processed but never written to conversation history.
      const isReportText = body.message.length > REPORT_TEXT_THRESHOLD;
      const userContent = isReportText ? REDACTED_REPORT_NOTE(body.message.length) : body.message;

      // Register the review so the user can confirm selected findings in a separate, explicit step.
      let payload: AssistantPayload | null = outcome.payload;
      if (outcome.role === 'assistant' && outcome.payload?.kind === 'extraction_review') {
        const entry = deps.reports.create({
          userId: String(userId),
          investigationId: String(inv._id),
          candidates: outcome.candidates ?? [],
          reportDerived: true,
        });
        payload = { ...outcome.payload, reportId: entry.id };
      }

      const userMsg = await saveUserMessage(inv._id, userContent);
      const assistantMsg = await saveAssistantMessage(inv._id, outcome.role, outcome.content, payload, outcome.citations);

      // Update investigation metadata.
      if (outcome.role === 'assistant') {
        if (payload?.kind === 'extraction_review') {
          inv.status = 'awaiting_confirmation';
          inv.inputType = 'report_text';
        } else {
          inv.status = 'complete';
          const types = new Set(outcome.submittedVariants.map((v) => (v.normalizationStatus === 'gene_only' ? 'gene' : 'variant')));
          if (outcome.fresh && types.size === 1) {
            const t = [...types][0] as 'gene' | 'variant';
            inv.inputType = !inv.inputType || inv.inputType === 'mixed' || inv.inputType === t ? t : 'mixed';
          }
        }
        if (outcome.detectedCancerType && !inv.inputMetadata?.cancerType) inv.set('inputMetadata.cancerType', outcome.detectedCancerType);
        await inv.save();
      }

      // Persistence of structured records is best-effort: retrieved results are still returned if it fails.
      const notices: string[] = [];
      if (outcome.role === 'assistant' && payload?.kind === 'results' && outcome.fresh) {
        try {
          await persistSearch({ userId, investigationId: inv._id, results: payload.results });
        } catch (err) {
          logger.warn({ message: (err as Error).message }, 'Could not persist structured search records');
          notices.push('The results could not be saved as structured records, but they are included in this conversation.');
        }
      }

      res.status(201).json({ userMessage: presentMessage(userMsg), assistantMessage: presentMessage(assistantMsg), notices });
    },
  };
}
