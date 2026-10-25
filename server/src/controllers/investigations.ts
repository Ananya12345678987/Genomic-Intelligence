import type { Request, Response } from 'express';
import { trusted } from 'mongoose';
import { Investigation, ConversationMessage, MatchResult, Variant } from '../models/index.js';
import { HttpError } from '../utils/httpError.js';
import { authOf } from '../middleware/auth.js';
import {
  createInvestigationSchema,
  updateInvestigationSchema,
  listInvestigationsQuery,
  objectIdParam,
} from '../validators/investigations.js';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const present = (i: {
  _id: unknown;
  title: string;
  inputType?: string | null;
  inputMetadata?: unknown;
  selectedCancerContext?: string | null;
  status?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}) => ({
  id: String(i._id),
  title: i.title,
  inputType: i.inputType,
  inputMetadata: i.inputMetadata,
  selectedCancerContext: i.selectedCancerContext,
  status: i.status,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
});

/**
 * Every query below filters on BOTH the document id and the authenticated
 * user's id. A missing document and someone else's document are
 * indistinguishable (404), so ids cannot be probed.
 */
export async function findOwnedInvestigationById(userId: unknown, id: string) {
  const doc = await Investigation.findOne({ _id: id, userId });
  if (!doc) throw HttpError.notFound('Investigation not found');
  return doc;
}

export async function findOwnedInvestigation(req: Request) {
  const { id } = objectIdParam.parse(req.params);
  return findOwnedInvestigationById(authOf(req).userId, id);
}

export const investigationsController = {
  async create(req: Request, res: Response) {
    const input = createInvestigationSchema.parse(req.body ?? {});
    const doc = await Investigation.create({ ...input, userId: authOf(req).userId });
    res.status(201).json({ investigation: present(doc) });
  },

  async list(req: Request, res: Response) {
    const { q, page, limit } = listInvestigationsQuery.parse(req.query);
    const filter: Record<string, unknown> = { userId: authOf(req).userId };
    if (q) filter.title = trusted({ $regex: escapeRegex(q), $options: 'i' });
    const [items, total] = await Promise.all([
      Investigation.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Investigation.countDocuments(filter),
    ]);
    res.json({ items: items.map(present), page, limit, total });
  },

  async get(req: Request, res: Response) {
    res.json({ investigation: present(await findOwnedInvestigation(req)) });
  },

  async update(req: Request, res: Response) {
    const doc = await findOwnedInvestigation(req);
    const input = updateInvestigationSchema.parse(req.body);
    if (input.title !== undefined) doc.title = input.title;
    if (input.selectedCancerContext !== undefined) doc.selectedCancerContext = input.selectedCancerContext;
    if (input.inputMetadata) {
      for (const [k, v] of Object.entries(input.inputMetadata)) {
        if (v !== undefined) doc.set(`inputMetadata.${k}`, v);
      }
    }
    await doc.save();
    res.json({ investigation: present(doc) });
  },

  async remove(req: Request, res: Response) {
    const doc = await findOwnedInvestigation(req);
    await ConversationMessage.deleteMany({ investigationId: doc._id });
    await MatchResult.deleteMany({ investigationId: doc._id });
    await Variant.deleteMany({ investigationId: doc._id });
    await doc.deleteOne();
    res.status(204).end();
  },

  async messages(req: Request, res: Response) {
    const doc = await findOwnedInvestigation(req);
    const items = await ConversationMessage.find({ investigationId: doc._id }).sort({ createdAt: 1, _id: 1 }).lean();
    res.json({
      items: items.map((m) => ({
        id: String(m._id),
        role: m.role,
        content: m.content,
        payload: m.payload,
        citationReferences: m.citationReferences,
        createdAt: m.createdAt,
      })),
    });
  },
};
