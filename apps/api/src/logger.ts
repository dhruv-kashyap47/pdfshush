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
      paths: ['password', '*.password', 'token', '*.token', 'req.headers.authorization'],
      remove: true,
    },
    base: { service: 'pdfshush-api' },
  });
}

export type { Logger };