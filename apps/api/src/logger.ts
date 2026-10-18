/**
 * Structured logging (pino).
 *
 * One JSON stream to stdout for the API and workers. Passwords, tokens and
 * client IPs never reach it: log shapes are built explicitly at call sites, and
 * quota subjects are hashed before they get here.
 */

import { pino, type Logger } from 'pino';

export function createLogger(config: { logLevel: string; isProduction?: boolean }): Logger {
  return pino({
    level: config.logLevel,
    // Pretty output only in development; production stays one JSON per line so
    // a log shipper can parse it.
    ...(config.isProduction ? {} : { transport: undefined }),
    redact: {
      // Every credential the surface can carry: session/job/request tokens, the
      // public-API bearer key (D8), and the cookie header -- cookies rename
      // themselves ("pdfshush_session=…"), so the header is redacted wholesale
      // rather than per-cookie.
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'apiKey',
        '*.apiKey',
        'x-job-token',
        '*.x-job-token',
        'cookie',
        '*.cookie',
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.headers["x-job-token"]',
      ],
      remove: true,
    },
    base: { service: 'pdfshush-api' },
  });
}

export type { Logger };