import { Router } from 'express';
import { investigationsController as c } from '../controllers/investigations.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export function investigationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/', asyncHandler(c.create));
  router.get('/', asyncHandler(c.list));
  router.get('/:id', asyncHandler(c.get));
  router.patch('/:id', asyncHandler(c.update));
  router.delete('/:id', asyncHandler(c.remove));
  router.get('/:id/messages', asyncHandler(c.messages));

  return router;
}
