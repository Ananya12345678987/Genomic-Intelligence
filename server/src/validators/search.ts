import { z } from 'zod';
import { objectIdParam } from './investigations.js';

const objectId = objectIdParam.shape.id;
const gene = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9-]{0,14}$/, 'Invalid gene symbol');
const genome = z.enum(['GRCh37', 'GRCh38']);
const transcript = z.string().trim().regex(/^[A-Za-z0-9_.]{3,30}$/, 'Invalid transcript accession');
const text = (max: number) => z.string().trim().min(1).max(max);

export const contextSchema = z
  .object({
    cancerType: z.string().trim().max(120).nullable().optional(),
    referenceGenome: genome.nullable().optional(),
    transcriptId: transcript.nullable().optional(),
  })
  .strict();

export const normalizeSchema = z.object({
  query: text(400),
  geneSymbol: gene.optional(),
  referenceGenome: genome.nullable().optional(),
  transcriptId: transcript.nullable().optional(),
});

export const variantSearchSchema = z.object({
  query: text(400),
  geneSymbol: gene.optional(),
  cancerType: z.string().trim().max(120).nullable().optional(),
  referenceGenome: genome.nullable().optional(),
  transcriptId: transcript.nullable().optional(),
  investigationId: objectId.optional(),
  includeTrials: z.boolean().optional(),
  includePublications: z.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const publicationSearchSchema = z
  .object({
    query: text(300).optional(),
    geneSymbol: gene.optional(),
    variant: text(200).optional(),
    cancerType: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(8),
  })
  .refine((v) => v.query || v.geneSymbol, { message: 'Provide a query or a gene symbol' });

export const trialSearchSchema = z
  .object({
    geneSymbol: gene.optional(),
    variant: text(200).optional(),
    cancerType: z.string().trim().max(120).optional(),
    statuses: z.array(z.string().trim().max(40)).max(8).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .refine((v) => v.geneSymbol || v.cancerType, { message: 'Provide a gene symbol or a cancer type' });

export const chatMessageSchema = z.object({
  investigationId: objectId,
  message: text(20000),
  context: contextSchema.optional(),
});

export const confirmVariantsSchema = z.object({
  investigationId: objectId,
  selections: z
    .array(z.object({ id: z.string().trim().min(1).max(64), text: z.string().trim().min(1).max(300).optional() }))
    .min(1)
    .max(20),
  context: contextSchema.optional(),
});

export const uploadFieldsSchema = z.object({ investigationId: objectId.optional() });
export const extractSchema = z.object({ investigationId: objectId.optional(), referenceGenome: genome.nullable().optional() });
export const reportIdParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{20,40}$/, 'Invalid report id') });
export const exportSchema = z.object({ investigationId: objectId });
export const idParam = objectIdParam;

export const settingsPatchSchema = z
  .object({
    aiSensitiveContentConsent: z.boolean().optional(),
    defaultReferenceGenome: genome.nullable().optional(),
    sidebarCollapsed: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one setting' });
