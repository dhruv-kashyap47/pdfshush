/**
 * The polling budget, separated so the parity and stdio tests can shrink it.
 *
 * The queue's own job timeout default is 120s; the poll budget tracks that
 * plus slack for queueing rather than exceeding it willingly.
 */
export const POLL_INTERVAL_MS = Number(process.env.PDFSHUSH_POLL_INTERVAL_MS ?? 400);
export const POLL_TIMEOUT_MS = Number(process.env.PDFSHUSH_POLL_TIMEOUT_MS ?? 240_000);
