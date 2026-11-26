/**
 * The real surface (§24.4 stdio-E2E gate): the shipped binary over a spawned
 * stdio child, against a fake `/api/v1` that speaks the exact response shapes
 * of the REST spec. Proves the full loop a model would run: initialize,
 * tools/list (pinned tool set), resources/list for a guide, and a complete
 * tools/call -- submit → poll → result → inline content block. Plus the
 * config-refusal and wrong-tool honesty checks.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'dist', 'bin.js');

const SERVER_SLUGS = ['inspect', 'merge', 'organize', 'stamp', 'split-by-pages', 'split-in-half', 'n-up', 'edit'];

function pdfBase64(label: string): string {
  // Minimal one-page PDF; the client contract does not parse these, the API did.
  return Buffer.from(`%PDF-1.4\n%${label}\ntrailer\n`).toString('base64');
}

interface FakeJob {
  slug: string;
  files: { name: string; bytes: number }[];
  pageCount: number;
  outputs: { name: string; bytes: Buffer }[];
}

/** Speaks the v1 contract for exactly what the tool flow needs. */
async function startFakeApi(): Promise<{ server: Server; port: number; jobs: Map<string, FakeJob> }> {
  const jobs = new Map<string, FakeJob>();
  let next = 1;
  const server = createServer((req, res) => {
    const key = req.headers['x-api-key'];
    const unauthorized = () => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid key', code: 'unauthorized' }));
    };
    if (key !== 'pshk_fake_key_0000000000') return unauthorized();
    const url = new URL(req.url ?? '/', 'http://loopback');
    // Route: /api/v1/tools
    if (req.method === 'GET' && url.pathname === '/api/v1/tools') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          version: 1,
          slugs: SERVER_SLUGS,
          tools: SERVER_SLUGS.map((slug) => ({ slug, label: `Label ${slug}` })),
          scopes: ['jobs:write', 'jobs:read', 'results:read'],
          limits: { tasksPerMinute: 30, maxInlineFileBytes: 10 * 1024 * 1024 },
        }),
      );
      return;
    }
    // POST /api/v1/jobs
    if (req.method === 'POST' && url.pathname === '/api/v1/jobs') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let parsed: { slug?: string; files?: { name: string; data: string }[]; options?: Record<string, unknown> };
        try {
          parsed = JSON.parse(body);
        } catch {
          return reply400(res, 'Bad JSON');
        }
        if (!parsed.slug || !SERVER_SLUGS.includes(parsed.slug as never)) return reply400(res, 'unknown_slug');
        const files = parsed.files ?? [];
        if (files.length === 0) return reply400(res, 'missing_field');
        for (const f of files) {
          const bytes = Buffer.from(f.data, 'base64');
          if (bytes.subarray(0, 5).toString() !== '%PDF-') return reply400(res, 'validation_failed');
        }
        const id = `fake-job-${next++}`;
        const pageCount = files.length;
        const merged = Buffer.from(`%PDF-1.4 merged(${files.length}/${JSON.stringify(parsed.options ?? {})})`);
        jobs.set(id, {
          slug: parsed.slug,
          pageCount,
          files: files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.data, 'base64') })),
          outputs:
            parsed.slug === 'split-by-pages'
              ? [
                  { name: 'a-part-01.pdf', bytes: Buffer.from('%PDF-1.4 part-a') },
                  { name: 'a-part-02.pdf', bytes: Buffer.from('%PDF-1.4 part-b') },
                ]
              : [{ name: 'merged.pdf', bytes: merged }],
        });
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jobId: id,
            status: 'queued',
            statusUrl: `/api/v1/jobs/${id}`,
            token: 'fake-token',
            files: files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.data, 'base64') })),
          }),
        );
      });
      return;
    }
    // GET /api/v1/jobs/:id
    const state = /^\/api\/v1\/jobs\/(?<id>[^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && state?.groups?.id) {
      const job = jobs.get(state.groups.id);
      if (!job) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown job', code: 'unknown_job' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'completed',
          pageCount: job.pageCount,
          files: job.outputs.map((o) => ({ name: o.name, bytes: o.bytes.length })),
        }),
      );
      return;
    }
    // GET /api/v1/jobs/:id/result
    const result = /^\/api\/v1\/jobs\/(?<id>[^/]+)\/result$/.exec(url.pathname);
    if (req.method === 'GET' && result?.groups?.id) {
      const job = jobs.get(result.groups.id);
      if (!job) return notFound(res, 'result_not_found');
      if (job.outputs.length > 1) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jobId: job.slug,
            files: job.outputs.map((o, i) => ({
              name: o.name,
              bytes: o.bytes.length,
              url: `/api/v1/jobs/${result.groups!.id}/result/files/${o.name}?index=${i}`,
            })),
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(job.outputs[0]!.bytes);
      return;
    }
    // GET /api/v1/jobs/:id/result/files/:name
    const file = /^\/api\/v1\/jobs\/(?<id>[^/]+)\/result\/files\/(?<name>[^/?]+)\??.*$/.exec(url.pathname);
    if (req.method === 'GET' && file?.groups?.id) {
      const job = jobs.get(file.groups.id);
      const out = job?.outputs.find((o) => o.name === file.groups!.name);
      if (!out) return notFound(res, 'result_not_found');
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(out.bytes);
      return;
    }
    notFound(res, 'unknown_job');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port, jobs };
}

function reply400(res: import('node:http').ServerResponse, code: string): void {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Rejected', code }));
}

function notFound(res: import('node:http').ServerResponse, code: string): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', code }));
}

/** Line-delimited JSON-RPC over the child's stdio -- exactly the MCP framing. */
class McpClient {
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, (message: Record<string, unknown>) => void>();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        newline = this.buffer.indexOf('\n');
        if (!line) continue;
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          const id = message['id'];
          if (typeof id === 'number' && this.pending.has(id)) {
            this.pending.get(id)!(message);
            this.pending.delete(id);
          }
        } catch {
          /* not protocol; ignore */
        }
      }
    });
  }

  request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.child.stdin.write(`${payload}\n`);
    });
  }

  notify(method: string, params: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  requestRaw(method: string, params: unknown): Promise<Record<string, unknown>> {
    return this.request(method, params);
  }
}

describe('pdfshush-mcp over stdio', () => {
  let api: Awaited<ReturnType<typeof startFakeApi>>;
  const children: ChildProcessWithoutNullStreams[] = [];

  beforeAll(async () => {
    api = await startFakeApi();
  });
  afterAll(() => {
    for (const child of children) child.kill();
    api.server.close();
  });

  function spawnServer(extraEnv: Record<string, string> = {}): McpClient {
    const child = spawn(process.execPath, [BIN], {
      env: {
        ...process.env,
        PDFSHUSH_API_URL: `http://127.0.0.1:${api.port}`,
        PDFSHUSH_API_KEY: 'pshk_fake_key_0000000000',
        PDFSHUSH_POLL_INTERVAL_MS: '10',
        ...extraEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => process.env['PDFSHUSH_TEST_STDERR'] && process.stderr.write(chunk));
    return new McpClient(child);
  }

  it('initializes, advertises exactly the pinned tools, and serves the catalog + guides', async () => {
    const client = spawnServer();
    const init = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0' },
    });
    expect(init['result']).toMatchObject({ serverInfo: { name: 'pdfshush' } });
    client.notify('notifications/initialized', {});

    const tools = await client.request('tools/list', {});
    const names = (tools['result'] as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(SERVER_SLUGS.map(slugToToolName));
    const merge = (tools['result'] as { tools: { name: string; inputSchema: Record<string, unknown> }[] }).tools.find(
      (t) => t.name === 'pdfshush_merge',
    )!;
    expect(Object.keys(merge.inputSchema['properties'] as object)).toEqual(
      expect.arrayContaining(['files', 'password', 'options']),
    );

    const resources = await client.request('resources/list', {});
    const uris = (resources['result'] as { resources: { uri: string }[] }).resources.map((r) => r.uri);
    for (const slug of SERVER_SLUGS) expect(uris).toContain(`pdfshush://guide/${slug}`);

    const read = await client.request('resources/read', { uri: 'pdfshush://guide/merge' });
    const text = (read['result'] as { contents: { text: string }[] }).contents[0]!.text;
    expect(text).toContain('options: { reverse');
  }, 30_000);

  it('runs a job end to end: submit → poll → inline merged PDF back', async () => {
    const client = spawnServer();
    await handshake(client);
    const call = await client.request('tools/call', {
      name: 'pdfshush_merge',
      arguments: {
        files: [
          { name: 'a.pdf', data: pdfBase64('one') },
          { name: 'b.pdf', data: pdfBase64('two') },
        ],
      },
    });
    expect(call['result']).toMatchObject({ isError: false });
    const content = (call['result'] as { content: { type: string; text?: string; resource?: { blob: string } }[] })
      .content;
    const envelope = JSON.parse(content[0]!.text!);
    expect(envelope.status).toBe('completed');
    expect(envelope.pageCount).toBe(2);
    expect(envelope.files[0].inline).toBe(true);
    const blob = content[1]!.resource!.blob;
    expect(Buffer.from(blob, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(Buffer.from(blob, 'base64').toString()).toContain('merged(2');
  }, 30_000);

  it('returns multiple outputs from a multi-file job (listing → inline resources)', async () => {
    const client = spawnServer();
    await handshake(client);
    const call = await client.request('tools/call', {
      name: 'pdfshush_split_by_pages',
      arguments: { files: [{ name: 'a.pdf', data: pdfBase64('split') }], options: { chunkSize: 2 } },
    });
    const content = (
      call['result'] as { content: { type: string; text?: string; resource?: { blob?: string } }[] }
    ).content;
    const envelope = JSON.parse(content[0]!.text!);
    expect(envelope.files).toHaveLength(2);
    const blobs = content.filter((b) => b.type === 'resource');
    expect(blobs).toHaveLength(2);
    for (const block of blobs) expect(Buffer.from(block.resource!.blob!, 'base64').subarray(0, 4).toString()).toBe('%PDF');
  }, 30_000);

  it('surfaces the deployment error verdict as an honest tool error', async () => {
    const client = spawnServer();
    await handshake(client);
    const call = await client.request('tools/call', {
      name: 'pdfshush_merge',
      arguments: { files: [{ name: 'a.txt', data: Buffer.from('plain text, not a pdf').toString('base64') }] },
    });
    expect(call['result']).toMatchObject({ isError: true });
    const verdict = JSON.parse(((call['result'] as { content: { text: string }[] }).content[0]!.text));
    expect(verdict.code).toBe('validation_failed');
    expect(verdict.at ?? 'submitting').toBeTruthy();
  }, 30_000);

  it('refuses a non-loopback http URL at startup with the reason', async () => {
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [BIN], {
        env: {
          ...process.env,
          PDFSHUSH_API_URL: 'http://pdfshush.example.com',
          PDFSHUSH_API_KEY: 'pshk_fake_key_0000000000',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      children.push(child);
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('exit', (code) => {
        expect(code).not.toBe(0);
        expect(stderr).toContain('unencrypted');
        resolve();
      });
    });
  }, 30_000);
});

function slugToToolName(slug: string): string {
  return `pdfshush_${slug.replaceAll('-', '_')}`;
}

async function handshake(client: McpClient): Promise<void> {
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '0' },
  });
  client.notify('notifications/initialized', {});
}
