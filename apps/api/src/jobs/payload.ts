/**
 * Job payload contract between the API and the workers (§25.3/§25.4).
 *
 * The contract now lives in `@pdfshush/api-contracts` so the OpenAPI
 * document, the docs page and the MCP package read the same zod the API
 * validates with; this module stays as the api-internal import path. The
 * payload carries **paths, never bytes**: PDF data never enters Redis, so
 * queue depth costs kilobytes regardless of file size, and the TTL janitor
 * has exactly one place to sweep.
 */

export * from '@pdfshush/api-contracts';
