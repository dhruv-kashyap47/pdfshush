/**
 * OpenAPI 3.1 document for `/api/v1`.
 *
 * Generated at request time from the same zod schemas the route validates with,
 * so the spec cannot drift from what the server accepts (the §25.3 gate pins
 * the slug set instead of hoping). The document is intentionally small: four
 * paths, one security scheme, and inline JSON Schemas that carry no examples
 * sharper users would paste blindly.
 */

import { z } from 'zod';
import { MAX_UPLOAD_FILES, SERVER_SLUGS } from '../../jobs/payload.js';
import {
  apiCreateJobSchema,
  apiJobCreatedSchema,
  apiJobStateSchema,
  apiJobResultListingSchema,
  API_KEY_SCOPES,
} from './schemas.js';
import { NODE_JOBS } from '@pdfshush/pdf-core/node';

export interface OpenApiLimits {
  tasksPerMinute: number;
  tasksPerDay: number;
  bytesPerDay: number;
  readsPerMinute: number;
  maxUploadBytes: number;
  maxInlineFileBytes: number;
  retentionMs: number;
  accountTasksPerDay?: number;
  accountBytesPerDay?: number;
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  // OpenAPI 3.1 is JSON Schema 2020-12; generating in that dialect means
  // validators stop warning about mundane things like `exclusiveMinimum`.
  return z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
}

export function buildOpenApiDocument(limits: OpenApiLimits): Record<string, unknown> {
  const tools = SERVER_SLUGS.map((slug) => {
    const definition = NODE_JOBS[slug];
    return {
      slug,
      ...(definition ? { label: definition.label } : {}),
    };
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'PDFShush Public API',
      version: '1.0.0',
      description:
        'Programmatic access to the server-runnable PDF tools over the same pipeline the web app ' +
        'uses. Authenticate every request (except this document) with the `x-api-key` header ' +
        "carrying a key that starts with `pshk_`. Keys are created on the account dashboard and " +
        'are shown in full exactly once.',
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/api/v1/tools': {
        get: {
          summary: 'Tool catalog',
          description:
            'The slugs this deployment can run, with the quota tier each key carries. Requires a ' +
            'valid key; no specific scope. Any slug NOT listed here runs in the browser only and ' +
            'cannot be submitted to the server.',
          responses: {
            '200': { description: 'Catalog' },
            '401': errorResponse('Invalid or missing API key.'),
          },
        },
      },
      '/api/v1/jobs': {
        post: {
          summary: 'Submit a job',
          description:
            'Starts a PDF tool job. Two body forms are accepted: `application/json` with inline ' +
            'base64 files, or `multipart/form-data` for streamed uploads up to the request byte ' +
            'ceiling. The response is `202` with a `jobId` to poll.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: jsonSchema(apiCreateJobSchema) as object },
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['slug', 'files'],
                  properties: {
                    slug: { enum: [...SERVER_SLUGS] },
                    password: { type: 'string' },
                    options: { type: 'object' },
                    files: {
                      type: 'array',
                      maxItems: MAX_UPLOAD_FILES,
                      items: { type: 'string', format: 'binary' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '202': { description: 'Job accepted', content: { 'application/json': { schema: jsonSchema(apiJobCreatedSchema) as object } } },
            '400': errorResponse('Invalid job request.'),
            '401': errorResponse('Invalid or missing API key.'),
            '403': errorResponse('The key lacks the `jobs:write` scope.'),
            '413': errorResponse('Upload exceeds a size ceiling.'),
            '429': errorResponse('Quota or rate limit exceeded; see `Retry-After`.'),
          },
        },
      },
      '/api/v1/jobs/{id}': {
        get: {
          summary: 'Job status',
          description:
            'Poll this until `status` is `completed` or `failed`. Job state and any output files ' +
            'survive for the file-retention window after completion; afterwards the job reads ' +
            '`404`. Available once the queue has pruned old entries, an expired job is ' +
            'indistinguishable from an unknown id.',
          parameters: [jobIdParameter],
          responses: {
            '200': { description: 'Current state', content: { 'application/json': { schema: jsonSchema(apiJobStateSchema) as object } } },
            '401': errorResponse('Invalid or missing API key.'),
            '403': errorResponse('The key lacks the `jobs:read` scope, or the job belongs to another account.'),
            '404': errorResponse('Unknown or expired job.'),
            '429': errorResponse('Too many status reads from this key; see `Retry-After`.'),
          },
        },
      },
      '/api/v1/jobs/{id}/result': {
        get: {
          summary: 'Job result',
          description:
            'Download the completed job output. When the job produced exactly one file, the ' +
            'response body is that file. When it produced several, the body is JSON listing each ' +
            'file and the per-file URL to download it from. Results are durable only for the ' +
            `retention window (~${Math.round(limits.retentionMs / 60_000)} minutes).`,
          parameters: [jobIdParameter],
          responses: {
            '200': {
              description: 'The single output file, or a JSON listing for multiple outputs.',
              content: {
                'application/pdf': { schema: { type: 'string', format: 'binary' } },
                'application/json': { schema: jsonSchema(apiJobResultListingSchema) as object },
                'application/zip': { schema: { type: 'string', format: 'binary' } },
              },
            },
            '401': errorResponse('Invalid or missing API key.'),
            '403': errorResponse('The key lacks the `results:read` scope, or the job belongs to another account.'),
            '404': errorResponse('No result file exists for this job (never completed, or expired).'),
          },
        },
      },
      '/api/v1/jobs/{id}/result/files/{name}': {
        get: {
          summary: 'One result file',
          description: 'Download a single named output file from a completed job.',
          parameters: [jobIdParameter, { name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'The file.' },
            '401': errorResponse('Invalid or missing API key.'),
            '403': errorResponse('The key lacks the `results:read` scope.'),
            '404': errorResponse('Unknown file for this job, or the result has expired.'),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'A `pshk_…` API key, created on the account dashboard.',
        },
      },
      schemas: {
        Scope: { type: 'string', enum: [...API_KEY_SCOPES] },
        Tool: {
          type: 'object',
          properties: {
            slug: { type: 'string', enum: [...SERVER_SLUGS] },
            label: { type: 'string' },
          },
        },
        Catalog: {
          type: 'object',
          properties: {
            version: { type: 'integer', const: 1 },
            slugs: { type: 'array', items: { type: 'string', enum: [...SERVER_SLUGS] } },
            tools: { type: 'array', items: { $ref: '#/components/schemas/Tool' } },
            scopes: { type: 'array', items: { $ref: '#/components/schemas/Scope' } },
            limits: {
              type: 'object',
              properties: {
                tasksPerMinute: { type: 'integer', const: limits.tasksPerMinute },
                tasksPerDay: { type: 'integer', const: limits.tasksPerDay },
                bytesPerDay: { type: 'integer', const: limits.bytesPerDay },
                readsPerMinute: { type: 'integer', const: limits.readsPerMinute },
                maxUploadBytes: { type: 'integer', const: limits.maxUploadBytes },
                maxInlineFileBytes: { type: 'integer', const: limits.maxInlineFileBytes },
                accountTasksPerDay: { type: 'integer', const: limits.accountTasksPerDay ?? 0 },
                accountBytesPerDay: { type: 'integer', const: limits.accountBytesPerDay ?? 0 },
                resultRetentionMs: { type: 'integer', const: limits.retentionMs },
              },
            },
          },
        },
      },
    },
    'x-tool-labels': tools.reduce<Record<string, string>>((map, tool) => {
      const label = (tool as { label?: string }).label;
      if (label) map[tool.slug] = label;
      return map;
    }, {}),
  };
}

const jobIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

function errorResponse(message: string): object {
  return {
    description: message,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
          required: ['error', 'code'],
        },
      },
    },
  };
}
