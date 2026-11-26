/**
 * The managed-AI request gate, at the HTTP boundary.
 *
 * These tests never reach a provider: every case is refused before metering or
 * streaming. They exist because the prompt ceiling used to inspect only
 * `message.text`, leaving nested tool calls/results and oversized bodies as a
 * cheap way to make the Worker buffer and forward a huge request.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { TestD1 } from './support/db.js';
import { ORIGIN, executionContext, testEnv } from './support/env.js';

let db: TestD1;
let env: ReturnType<typeof testEnv>;

beforeEach(() => {
  db = new TestD1();
  env = testEnv(db, {
    AI_MANAGED_API_KEY: 'managed_test_key',
    AI_MANAGED_MODEL: 'openrouter/free',
  });
});

async function post(
  body: unknown,
  init: { headers?: Record<string, string>; raw?: boolean } = {},
): Promise<Response> {
  return app.fetch(
    new Request(`${ORIGIN}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...init.headers },
      body: init.raw ? (body as string) : JSON.stringify(body),
    }),
    env as never,
    executionContext as never,
  );
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('managed AI request limits', () => {
  it('counts nested tool results toward the prompt ceiling', async () => {
    const response = await post({
      system: '',
      messages: [
        {
          role: 'tool',
          results: [{ id: '1', name: 'read_pages', output: 'x'.repeat(310_000) }],
        },
      ],
      tools: [],
    });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).code).toBe('validation');
  });

  it('counts nested tool-call arguments toward the prompt ceiling', async () => {
    const response = await post({
      system: '',
      messages: [
        {
          role: 'assistant',
          text: '',
          toolCalls: [
            {
              id: '1',
              name: 'insert_text',
              input: { page: 1, text: 'y'.repeat(310_000) },
            },
          ],
        },
      ],
      tools: [],
    });

    expect(response.status).toBe(400);
  });

  it('counts tool schemas toward the prompt ceiling', async () => {
    const response = await post({
      system: '',
      messages: [{ role: 'user', text: 'hello' }],
      tools: [
        {
          name: 'huge_tool',
          description: 'test',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string', description: 'z'.repeat(310_000) } },
          },
        },
      ],
    });

    expect(response.status).toBe(400);
  });

  it('refuses an oversized body from its content-length before parsing', async () => {
    const response = await post(
      { system: '', messages: [{ role: 'user', text: 'hello' }], tools: [] },
      { headers: { 'content-length': String(3 * 1024 * 1024) } },
    );

    expect(response.status).toBe(413);
    expect((await bodyOf(response)).code).toBe('body_too_large');
  });

  it('refuses malformed JSON with a validation error, not a crash', async () => {
    const response = await post('{"system":', { raw: true });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).code).toBe('validation');
  });
});
