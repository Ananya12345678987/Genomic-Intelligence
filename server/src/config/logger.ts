import pino from 'pino';

/**
 * Paths that must never appear in logs. Genomic reports and credentials are
 * sensitive, so request bodies, cookies and auth headers are redacted wholesale.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body',
  '*.password',
  '*.passwordHash',
  '*.apiKey',
  '*.AI_API_KEY',
  '*.NCBI_API_KEY',
  '*.SESSION_SECRET',
  '*.reportText',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'cgi-server' },
});
