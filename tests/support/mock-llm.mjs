/**
 * A local, dependency-free mock of an OpenAI-compatible chat-completions
 * endpoint that streams Server-Sent Events. It exists so the AI end-to-end test
 * can exercise the real provider stack (BYOK → `streamForProvider`) with no API
 * key and no network egress.
 *
 * The mock is deterministic and driven by the request itself:
 *  - chat (no edit tools): answer with one short grounded sentence.
 *  - edit (tools include `markup_text`): read page 1, then highlight a fixed
 *    phrase that the test fixture contains, then summarise.
 *  - edit asking to "replace": read page 1, then rewrite that phrase with
 *    `replace_text`, so the genuine in-place path is exercised.
 *
 * It deliberately implements only the slice of the protocol the app consumes
 * (content deltas, streamed tool calls, a finish reason, `[DONE]`, CORS),
 * because the point is to prove the client, not to be a gateway.
 */

import http from 'node:http';

/** The phrase the edit scenarios act on; the test fixtures are built to contain it. */
export const MOCK_MARK_PHRASE = 'Quarterly Report';

/** What the replace scenario rewrites the phrase to. */
export const MOCK_REPLACE_PHRASE = 'Annual Summary';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    // `Authorization` is not covered by the `*` wildcard and must be listed.
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
}

function sseStart(res) {
  res.writeHead(200, {
    ...corsHeaders(),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function textChunk(text) {
  return { choices: [{ delta: { content: text }, finish_reason: null }] };
}

function toolChunk(index, id, name, args) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            { index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: null,
      },
    ],
  };
}

function finishChunk(reason) {
  return { choices: [{ delta: {}, finish_reason: reason }] };
}

function endStream(res) {
  sse(res, { choices: [], usage: { prompt_tokens: 42, completion_tokens: 12 } });
  res.write('data: [DONE]\n\n');
  res.end();
}

/** The text of a message, whichever shape the client sent it in. */
function textOf(message) {
  if (typeof message?.text === 'string') return message.text;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join(' ');
  }
  return '';
}

/** Streams the scripted answer for one request body. */
function respond(res, body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolName = (tool) => tool?.function?.name ?? tool?.name;
  const hasEditTools = tools.some((tool) => toolName(tool) === 'markup_text');
  const hasReplaceTool = tools.some((tool) => toolName(tool) === 'replace_text');
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const toolTurns = messages.filter((message) => message?.role === 'tool').length;
  // The scenario is chosen by the instruction, not by chance: asking to
  // "replace" exercises the genuine in-place rewrite, anything else the overlay
  // highlight path.
  const wantsReplace =
    hasReplaceTool &&
    messages.some(
      (message) => message?.role === 'user' && /\breplace\b/i.test(textOf(message)),
    );

  sseStart(res);

  if (!hasEditTools) {
    sse(res, textChunk('The document is a '));
    sse(res, textChunk(`${MOCK_MARK_PHRASE}. [page 1]`));
    sse(res, finishChunk('stop'));
    endStream(res);
    return;
  }

  if (toolTurns === 0) {
    sse(res, textChunk('Let me read page 1.'));
    sse(res, toolChunk(0, 'call_read', 'read_pages', { start: 1, end: 1 }));
    sse(res, finishChunk('tool_calls'));
    endStream(res);
    return;
  }

  if (toolTurns === 1) {
    if (wantsReplace) {
      sse(
        res,
        toolChunk(0, 'call_replace', 'replace_text', {
          page: 1,
          find: MOCK_MARK_PHRASE,
          replace: MOCK_REPLACE_PHRASE,
          all: true,
        }),
      );
    } else {
      sse(
        res,
        toolChunk(0, 'call_mark', 'markup_text', {
          page: 1,
          text: MOCK_MARK_PHRASE,
          type: 'highlight',
          all: true,
        }),
      );
    }
    sse(res, finishChunk('tool_calls'));
    endStream(res);
    return;
  }

  sse(
    res,
    textChunk(
      wantsReplace
        ? `Replaced “${MOCK_MARK_PHRASE}” with “${MOCK_REPLACE_PHRASE}”.`
        : `Highlighted “${MOCK_MARK_PHRASE}”.`,
    ),
  );
  sse(res, finishChunk('stop'));
  endStream(res);
}

/**
 * Starts the mock on `port` and returns `{ url, baseUrl, close }`.
 * `baseUrl` is the value to store in the app's AI settings.
 */
export function startMockLlm({ port = 8799 } = {}) {
  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    if (request.method !== 'POST' || !request.url?.includes('/chat/completions')) {
      response.writeHead(404, { ...corsHeaders(), 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        body = {};
      }
      respond(response, body);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
