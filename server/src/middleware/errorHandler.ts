import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../config/logger.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

/**
 * Centralized error handler. Known errors return a safe message; anything
 * unexpected is logged server-side and reported to the client generically so
 * internals (stack traces, filesystem paths, query text) are never exposed.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  // Multer (upload) errors: size and shape limits are client errors with safe messages.
  if (err?.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      error: { code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_REJECTED', message: tooBig ? 'The file is larger than the allowed size.' : 'The upload was rejected.' },
    });
    return;
  }

  // body-parser errors carry a status and a "type" such as entity.too.large
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status && status >= 400 && status < 500 && typeof err?.type === 'string') {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Malformed or oversized request' } });
    return;
  }

  logger.error({ err: { name: err?.name, message: err?.message, stack: err?.stack }, url: req.url }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
};
