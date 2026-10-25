import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { ConversationMessage, UserSettings } from '../models/index.js';
import { exportSchema, settingsPatchSchema } from '../validators/search.js';
import { findOwnedInvestigationById } from './investigations.js';
import { collectRounds, type ExportData } from '../services/exports/collect.js';
import { buildCsv } from '../services/exports/csv.js';
import { buildPdf } from '../services/exports/pdf.js';
import type { Env } from '../config/env.js';

async function loadExportData(req: Request): Promise<ExportData> {
  const { userId } = authOf(req);
  const { investigationId } = exportSchema.parse(req.body);
  const inv = await findOwnedInvestigationById(userId, investigationId);
  const messages = await ConversationMessage.find({ investigationId: inv._id, role: 'assistant' }).sort({ createdAt: 1, _id: 1 }).lean();
  const rounds = collectRounds(messages);
  // Never report success for an export with nothing in it.
  if (!rounds.length) {
    throw new HttpError(409, 'NOTHING_TO_EXPORT', 'This investigation has no saved search results yet. Run a search first.');
  }
  return {
    investigation: {
      title: inv.title,
      cancerContext: inv.selectedCancerContext ?? inv.inputMetadata?.cancerType ?? null,
      referenceGenome: inv.inputMetadata?.referenceGenome ?? null,
      transcriptId: inv.inputMetadata?.transcriptId ?? null,
      createdAt: inv.createdAt ?? null,
    },
    rounds,
    generatedAt: new Date().toISOString(),
  };
}

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

function sendDownload(res: Response, body: Buffer | string, type: string, filename: string) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Private data: never cacheable by browsers or shared caches.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(body);
}

export const exportsController = {
  async pdf(req: Request, res: Response) {
    const data = await loadExportData(req);
    sendDownload(res, await buildPdf(data), 'application/pdf', `variant-evidence-report-${stamp()}.pdf`);
  },
  async csv(req: Request, res: Response) {
    const data = await loadExportData(req);
    sendDownload(res, buildCsv(data), 'text/csv; charset=utf-8', `variant-evidence-${stamp()}.csv`);
  },
};

export function settingsController(env: Env) {
  const present = (s: { aiSensitiveContentConsent?: boolean | null; aiSensitiveContentConsentAt?: Date | null; defaultReferenceGenome?: string | null; sidebarCollapsed?: boolean | null } | null) => ({
    aiSensitiveContentConsent: s?.aiSensitiveContentConsent === true,
    aiSensitiveContentConsentAt: s?.aiSensitiveContentConsentAt ?? null,
    defaultReferenceGenome: s?.defaultReferenceGenome ?? null,
    sidebarCollapsed: s?.sidebarCollapsed === true,
    ai: {
      configured: env.AI_PROVIDER !== 'none',
      sensitiveContentAllowedByOperator: env.AI_ALLOW_SENSITIVE_CONTENT,
    },
  });
  return {
    async get(req: Request, res: Response) {
      const s = await UserSettings.findOne({ userId: authOf(req).userId }).lean();
      res.json({ settings: present(s) });
    },
    async patch(req: Request, res: Response) {
      const { userId } = authOf(req);
      const input = settingsPatchSchema.parse(req.body);
      const set: Record<string, unknown> = { ...input };
      if (input.aiSensitiveContentConsent !== undefined) {
        set.aiSensitiveContentConsentAt = input.aiSensitiveContentConsent ? new Date() : null;
      }
      const s = await UserSettings.findOneAndUpdate({ userId }, { $set: set }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
      res.json({ settings: present(s) });
    },
  };
}
