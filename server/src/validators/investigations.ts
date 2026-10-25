import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { INPUT_TYPES } from '../models/Investigation.js';

const nullableText = (max: number) => z.string().trim().max(max).nullable();

const metadata = z
  .object({
    cancerType: nullableText(120).optional(),
    specimenContext: nullableText(120).optional(),
    referenceGenome: z.enum(['GRCh37', 'GRCh38']).nullable().optional(),
    transcriptId: nullableText(40).optional(),
  })
  .strict();

export const createInvestigationSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  inputType: z.enum(INPUT_TYPES).optional(),
  inputMetadata: metadata.optional(),
  selectedCancerContext: nullableText(120).optional(),
});

export const updateInvestigationSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    inputMetadata: metadata.optional(),
    selectedCancerContext: nullableText(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listInvestigationsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const objectIdParam = z.object({
  id: z.string().refine((v) => isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), { message: 'Invalid id' }),
});
