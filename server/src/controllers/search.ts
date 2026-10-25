import { isValidObjectId } from 'mongoose';
import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../config/logger.js';
import { EvidenceRecord, Variant } from '../models/index.js';
import { findOwnedInvestigationById } from './investigations.js';
import { idParam, normalizeSchema, publicationSearchSchema, trialSearchSchema, variantSearchSchema } from '../validators/search.js';
import { parseVariantInput } from '../services/variant-normalization/index.js';
import { searchEvidence } from '../services/evidence/search.js';
import { buildSourceIndex, publicIndex } from '../services/evidence/sourceIndex.js';
import { persistSearch } from '../services/persistence/persist.js';
import type { AppDeps } from '../services/deps.js';
import type { ParsedVariant, SearchContext } from '../types/domain.js';

const joinQuery = (gene?: string, variant?: string) => [gene, variant].filter(Boolean).join(' ');

function parseSubmitted(input: { query: string; geneSymbol?: string; referenceGenome?: 'GRCh37' | 'GRCh38' | null; transcriptId?: string | null }): ParsedVariant {
  return parseVariantInput(input.query, {
    geneSymbol: input.geneSymbol ?? null,
    referenceGenome: input.referenceGenome ?? null,
    transcriptId: input.transcriptId ?? null,
  });
}

export function searchController(deps: AppDeps) {
  return {
    /** Validate and normalize only. No external calls. */
    async normalize(req: Request, res: Response) {
      const body = normalizeSchema.parse(req.body);
      res.json({ normalized: parseSubmitted(body) });
    },

    async searchVariants(req: Request, res: Response) {
      const { userId } = authOf(req);
      const body = variantSearchSchema.parse(req.body);
      const invId = body.investigationId ? (await findOwnedInvestigationById(userId, body.investigationId))._id : null;
      const submitted = parseSubmitted(body);
      if (submitted.normalizationStatus === 'unresolved') {
        throw new HttpError(422, 'UNRESOLVED_FINDING', 'The input could not be interpreted as a gene or variant.', { warnings: submitted.warnings, missing: submitted.missing });
      }
      const ctx: SearchContext = { cancerType: body.cancerType ?? null, referenceGenome: body.referenceGenome ?? null, transcriptId: body.transcriptId ?? null };
      const result = await searchEvidence(deps.sources, submitted, ctx, { includeTrials: body.includeTrials, includePublications: body.includePublications });
      const index = buildSourceIndex([result]);
      let saved = false;
      if (invId) {
        try {
          await persistSearch({ userId, investigationId: invId, results: [result] });
          saved = true;
        } catch (err) {
          logger.warn({ message: (err as Error).message }, 'Could not persist structured search records');
        }
      }
      res.json({ result, index: publicIndex(index), saved });
    },

    async getVariant(req: Request, res: Response) {
      const { userId } = authOf(req);
      const { id } = idParam.parse(req.params);
      const doc = await Variant.findById(id).lean();
      // Shared public-source variants (userId null) are readable by any signed-in user;
      // a submitted variant is visible only to its owner, and looks identical to "not found" otherwise.
      if (!doc || (doc.userId && String(doc.userId) !== String(userId))) throw HttpError.notFound('Variant not found');
      res.json({ variant: { ...doc, id: String(doc._id), _id: undefined, userId: undefined, __v: undefined } });
    },

    /** Paginated, flattened view of source records for a gene/variant query. */
    async searchEvidenceRecords(req: Request, res: Response) {
      const body = variantSearchSchema.parse(req.body);
      const submitted = parseSubmitted(body);
      if (submitted.normalizationStatus === 'unresolved') {
        throw new HttpError(422, 'UNRESOLVED_FINDING', 'The input could not be interpreted as a gene or variant.', { warnings: submitted.warnings, missing: submitted.missing });
      }
      const ctx: SearchContext = { cancerType: body.cancerType ?? null, referenceGenome: body.referenceGenome ?? null, transcriptId: body.transcriptId ?? null };
      const result = await searchEvidence(deps.sources, submitted, ctx, { includeTrials: false, includePublications: false });
      const total = result.findings.length;
      const start = (body.page - 1) * body.limit;
      res.json({
        submitted: result.submitted,
        items: result.findings.slice(start, start + body.limit),
        page: body.page,
        limit: body.limit,
        total,
        sourceStatuses: result.sourceStatuses,
        notices: result.notices,
        retrievedAt: result.retrievedAt,
      });
    },

    async getEvidence(req: Request, res: Response) {
      const { id } = idParam.parse(req.params);
      if (!isValidObjectId(id)) throw HttpError.notFound('Evidence record not found');
      const doc = await EvidenceRecord.findById(id).lean();
      if (!doc) throw HttpError.notFound('Evidence record not found');
      res.json({ evidence: { ...doc, id: String(doc._id), _id: undefined, __v: undefined } });
    },

    async searchPublications(req: Request, res: Response) {
      const body = publicationSearchSchema.parse(req.body);
      const submitted = parseVariantInput(joinQuery(body.geneSymbol, body.variant) || body.query!, { geneSymbol: body.geneSymbol ?? null });
      const ctx: SearchContext = { cancerType: body.cancerType ?? null };
      const result = body.query && !body.geneSymbol
        ? await deps.sources.pubmed.searchByText(body.query, body.limit)
        : await deps.sources.pubmed.searchPublications(submitted, ctx, body.limit);
      res.json({ ...result, items: result.items, page: 1, limit: body.limit, total: result.total ?? result.items.length });
    },

    async searchTrials(req: Request, res: Response) {
      const body = trialSearchSchema.parse(req.body);
      const submitted = parseVariantInput(joinQuery(body.geneSymbol, body.variant) || (body.cancerType ?? ''), { geneSymbol: body.geneSymbol ?? null });
      const result = await deps.sources.trials.searchTrials(submitted, { cancerType: body.cancerType ?? null }, { statuses: body.statuses, limit: body.limit });
      res.json({
        ...result,
        page: 1,
        limit: body.limit,
        total: result.total ?? result.items.length,
        notice: 'A shared gene, variant or cancer type does not establish eligibility for any trial. Status can change; verify at the official record.',
      });
    },
  };
}
