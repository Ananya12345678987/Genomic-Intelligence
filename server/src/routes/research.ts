import { Router } from 'express';
import type { Env } from '../config/env.js';
import type { AppDeps } from '../services/deps.js';
import { requireAuth } from '../middleware/auth.js';
import { expensiveRateLimiter } from '../middleware/security.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { searchController } from '../controllers/search.js';
import { chatController } from '../controllers/chat.js';
import { pdfUpload, reportsController } from '../controllers/reports.js';
import { exportsController, settingsController } from '../controllers/exports.js';

/** Every route here requires a signed-in user and, for state changes, a valid CSRF token. */
export function researchRouter(env: Env, deps: AppDeps): Router {
  const router = Router();
  // Scoped to our prefixes so unknown paths still return a plain 404 rather than a 401.
  router.use(['/variants', '/evidence', '/publications', '/trials', '/chat', '/reports', '/settings'], requireAuth);
  const heavy = expensiveRateLimiter(env);

  const search = searchController(deps);
  const chat = chatController(env, deps);
  const reports = reportsController(env, deps);
  const settings = settingsController(env);

  router.post('/variants/normalize', asyncHandler(search.normalize));
  router.post('/variants/search', heavy, asyncHandler(search.searchVariants));
  router.get('/variants/:id', asyncHandler(search.getVariant));

  router.post('/evidence/search', heavy, asyncHandler(search.searchEvidenceRecords));
  router.get('/evidence/:id', asyncHandler(search.getEvidence));
  router.post('/publications/search', heavy, asyncHandler(search.searchPublications));
  router.post('/trials/search', heavy, asyncHandler(search.searchTrials));

  router.post('/chat/message', heavy, asyncHandler(chat.message));

  router.post('/reports/upload', heavy, pdfUpload, asyncHandler(reports.upload));
  router.post('/reports/:id/extract', heavy, asyncHandler(reports.extract));
  router.post('/reports/:id/confirm-variants', heavy, asyncHandler(reports.confirm));
  router.post('/reports/export/pdf', asyncHandler(exportsController.pdf));
  router.post('/reports/export/csv', asyncHandler(exportsController.csv));

  router.get('/settings', asyncHandler(settings.get));
  router.patch('/settings', asyncHandler(settings.patch));

  return router;
}
