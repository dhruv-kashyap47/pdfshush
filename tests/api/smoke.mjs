/**
 * API integration smoke test (Phase 3).
 *
 * Unlike the browser suite this runs against the *real* stack -- Express,
 * Redis, BullMQ and the sandboxed worker inside Docker -- because that is the
 * only way to verify the parts unit tests cannot reach: that a job queued in
 * one process is executed by another, survives the round trip through Redis, and
 * comes back as bytes on disk.
 *
 *   docker compose up -d --build
 *   node tests/api/smoke.mjs
 *
 * With accounts configured and `PSH_SMOKE_MONGODB_URI` set to the stack's own
 * Mongo URI, section 6 additionally walks the public `/api/v1` surface end to
 * end: it seeds an account + session directly into Mongo (the only auth truth
 * that needs no Google round trip), mints a key through the real dashboard
 * route, then submits, polls, downloads and revokes through the key.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:8080';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Hand-built spec-valid PDF, no dependencies (same trick as the browser
 * suite): the server must parse what a third-party generator produced, not
 * only what our own library wrote.
 */
function buildPdf(pageCount, label) {
  const objects = [];
  const pageObjNums = [];
  const kids = [];
  for (let i = 0; i < pageCount; i += 1) {
    pageObjNums.push(3 + i * 2);
    kids.push(`${3 + i * 2} 0 R`);
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  pageObjNums.forEach((num, index) => {
    const contentNum = num + 1;
    const text = `BT /F1 18 Tf 72 700 Td (${label} page ${index + 1}) Tj ET`;
    objects[num] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${pageObjNums.length * 2 + 3} 0 R >> >> /Contents ${contentNum} 0 R >>`;
    objects[contentNum] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  });
  const fontNum = pageObjNums.length * 2 + 3;
  objects[fontNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let num = 1; num < objects.length; num += 1) {
    if (!objects[num]) continue;
    offsets[num] = pdf.length;
    pdf += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let num = 1; num < objects.length; num += 1) {
    pdf += offsets[num]
      ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n`
      : '0000000000 65535 f \n';
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Page count from raw bytes -- pdf-lib saves with object streams disabled. */
function countPages(bytes) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

function multipart(fields, files) {
  const boundary = `----pdfshush${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`),
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
          'Content-Type: application/pdf\r\n\r\n',
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function postJob(fields, files) {
  const { body, contentType } = multipart(fields, files);
  const response = await fetch(`${BASE}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  return { status: response.status, json: await response.json().catch(() => undefined) };
}

async function waitForJob(jobId, token, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/api/jobs/${jobId}`, {
      headers: { 'x-job-token': token },
    });
    if (!response.ok) return { error: `status ${response.status}` };
    last = await response.json();
    if (last.status === 'completed' || last.status === 'failed') return last;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return last ?? { error: 'timeout' };
}

/**
 * Waits until the anonymous per-minute window is empty again, so the suite is
 * deterministic no matter how recently it (or the hardening gate) ran.
 */
async function waitForFreshQuotaWindow() {
  const quota = await fetch(`${BASE}/api/quota`).then((r) => r.json());
  const used = quota.tasksPerMinute?.used ?? 0;
  if (used === 0) return;
  const waitMs = 62_000;
  console.log(`  (quota window has ${used}/6 used — waiting ${waitMs / 1000}s)`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

/**
 * Submits a job, waiting out the anonymous rate limit if this is a re-run.
 * The limit itself is asserted separately; here it would only make the suite
 * flaky when two runs land inside the same minute.
 */
async function submitJobWithBudget(fields, files) {
  let result = await postJob(fields, files);
  if (result.status === 429) {
    console.log('  (rate limited — waiting 62s for the window to reset)');
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    result = await postJob(fields, files);
  }
  return result;
}

async function main() {
  console.log(`API smoke test against ${BASE}\n`);
  await waitForFreshQuotaWindow();
  const work = await mkdtemp(path.join(tmpdir(), 'pdfshush-api-smoke-'));

  console.log('1. Health');
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check('api is up', health.status === 'ok', JSON.stringify(health.queue));
  check('queue is reachable from the api process', typeof health.queue.waiting === 'number');
  check(
    'work directory usage is reported',
    typeof health.workDir.jobDirs === 'number',
    `${health.workDir.jobDirs} dirs`,
  );

  console.log('\n2. Real job through Redis into the sandboxed worker');
  const one = buildPdf(2, 'alpha');
  const two = buildPdf(1, 'beta');
  check('fixtures are valid PDFs', one.subarray(0, 5).toString() === '%PDF-');
  const created = await submitJobWithBudget({ slug: 'merge', options: '{}' }, [
    { name: 'one.pdf', data: one },
    { name: 'two.pdf', data: two },
  ]);
  check('upload accepted', created.status === 202, `status ${created.status}`);
  const { jobId, token } = created.json ?? {};
  check('job id and ownership token issued', Boolean(jobId && token));

  const finished = await waitForJob(jobId, token);
  check('job completed', finished.status === 'completed', JSON.stringify(finished.error ?? finished.progress ?? ''));
  check('page count travelled with the result', finished.pageCount === 3, `${finished.pageCount} pages`);
  check('one output file', finished.files?.length === 1, JSON.stringify(finished.files));

  if (finished.files?.[0]) {
    const resultName = finished.files[0].name;
    const download = await fetch(`${BASE}/api/jobs/${jobId}/files/${resultName}`, {
      headers: { 'x-job-token': token },
    });
    const bytes = Buffer.from(await download.arrayBuffer());
    check('download is a PDF', bytes.subarray(0, 5).toString() === '%PDF-', `${bytes.length}B`);
    check('downloaded size matches the reported size', bytes.length === finished.files[0].bytes);
    const reread = countPages(bytes);
    check('downloaded PDF really has the merged pages', reread === 3, `${reread} pages`);
  }

  console.log('\n3. Ownership and validation');
  check('state without a token is refused', (await fetch(`${BASE}/api/jobs/${jobId}`)).status === 403);
  check(
    'state with a wrong token is refused',
    (await fetch(`${BASE}/api/jobs/${jobId}`, { headers: { 'x-job-token': 'deadbeef' } })).status === 403,
  );
  check('malformed job id is refused', (await fetch(`${BASE}/api/jobs/nope`, { headers: { 'x-job-token': 'x' } })).status === 400);
  const badSlug = await postJob({ slug: 'compress-pdf' }, [{ name: 'one.pdf', data: one }]);
  check('unknown slug is refused', badSlug.status === 400, `status ${badSlug.status}`);
  const badType = await postJob({ slug: 'merge' }, [{ name: 'payload.png', data: Buffer.from('not a pdf') }]);
  check('non-PDF upload is refused', badType.status === 400, `status ${badType.status}`);

  console.log('\n4. Anonymous quota (6 per minute by default)');
  let refused = 0;
  for (let i = 0; i < 8; i += 1) {
    const attempt = await postJob({ slug: 'inspect' }, [{ name: 'one.pdf', data: one }]);
    if (attempt.status === 429) refused += 1;
  }
  check('burst is rate limited after the per-minute ceiling', refused > 0, `${refused}/8 refused`);
  const quota = await fetch(`${BASE}/api/quota`).then((r) => r.json());
  check('quota endpoint reports the budget', quota.tasksPerMinute?.limit === 6, JSON.stringify(quota.tasksPerMinute));

  console.log('\n5. Work directory bookkeeping');
  const after = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check('finished job directories are accounted for', after.workDir.jobDirs >= 1, `${after.workDir.jobDirs} dirs`);
  check('outputs are on disk, not in Redis', after.workDir.bytes > 0, `${after.workDir.bytes}B on disk`);

  console.log('\n6. Public REST API (/api/v1)');
  await checkPublicApi();

  await rm(work, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Section 6: the public key surface, against the real stack.
 *
 * Keys belong to accounts, and a session is the only thing that may mint one.
 * Rather than inventing a signing back door for tests, the harness writes the
 * account + session it needs straight into the same Mongo the stack uses --
 * nothing about the HTTP surface is bypassed: the key is still minted through
 * the CSRF-checked dashboard route.
 */
async function checkPublicApi() {
  const authProbe = await fetch(`${BASE}/api/account/api-keys`);
  if (authProbe.status === 503) {
    check(
      'v1 self-reports as disabled where accounts are off',
      (await fetch(`${BASE}/api/v1/tools`)).status === 503,
    );
    check(
      'the OpenAPI spec stays readable without keys',
      (await fetch(`${BASE}/api/v1/openapi.json`)).status === 200,
    );
    return;
  }
  const mongoUri = process.env.PSH_SMOKE_MONGODB_URI;
  if (!mongoUri) {
    console.log(
      '  [SKIP] accounts are enabled; set PSH_SMOKE_MONGODB_URI (and optional PSH_SMOKE_MONGODB_DB) to exercise key → submit → poll → download end to end.',
    );
    return;
  }

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(process.env.PSH_SMOKE_MONGODB_DB ?? 'pdfshush');
    let account = await db.collection('accounts').findOne({ _id: 'smoke-v1-account' });
    if (!account) {
      const now = new Date();
      await db.collection('accounts').insertOne({
        _id: 'smoke-v1-account',
        googleSub: 'smoke-v1-subject',
        email: 'smoke@example.com',
        emailVerified: true,
        name: 'Smoke v1',
        picture: null,
        createdAt: now,
        lastLoginAt: now,
      });
      account = await db.collection('accounts').findOne({ _id: 'smoke-v1-account' });
    }
    check('smoke account exists in the auth store of record', Boolean(account));

    // Session tokens are stored as SHA-256, same rule the AuthStore follows.
    const sessionToken = randomBytes(32).toString('hex');
    const stamp = new Date();
    await db.collection('sessions').insertOne({
      _id: createHash('sha256').update(sessionToken).digest('hex'),
      accountId: account._id,
      createdAt: stamp,
      expiresAt: new Date(stamp.getTime() + 3_600_000),
    });
    const authHeaders = {
      cookie: `pdfshush_session=${sessionToken}; pdfshush_csrf=smoke-csrf`,
      'x-csrf-token': 'smoke-csrf',
    };

    const mint = await fetch(`${BASE}/api/account/api-keys`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'smoke-e2e',
        scopes: ['jobs:write', 'jobs:read', 'results:read'],
      }),
    });
    check('dashboard mints a key', mint.status === 201, `status ${mint.status}`);
    const minted = await mint.json().catch(() => ({}));
    const key = minted.token;
    check('key uses the pshk_ scheme', typeof key === 'string' && key.startsWith('pshk_'));

    // Public spec first, then the authenticated flow.
    check('spec is public', (await fetch(`${BASE}/api/v1/openapi.json`)).status === 200);
    check('v1 without a key is refused', (await fetch(`${BASE}/api/v1/tools`)).status === 401);

    const authed = { 'x-api-key': key };
    const tools = await fetch(`${BASE}/api/v1/tools`, { headers: authed }).then((r) => r.json());
    check(
      'catalog answers over the key and names runnable slugs',
      Array.isArray(tools.tools) && tools.tools.length > 0,
      `${tools.tools?.length} slugs`,
    );

    // Inline JSON: no multipart, straight into the same queue the web uses.
    const submitted = await fetch(`${BASE}/api/v1/jobs`, {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'merge',
        files: [
          { name: 'a.pdf', data: buildPdf(2, 'api').toString('base64') },
          { name: 'b.pdf', data: buildPdf(1, 'api').toString('base64') },
        ],
      }),
    });
    check('inline JSON submission accepted', submitted.status === 202, `status ${submitted.status}`);
    const { jobId: v1JobId, statusUrl } = await submitted.json().catch(() => ({}));
    check('job id + statusUrl issued', Boolean(v1JobId) && statusUrl === `/api/v1/jobs/${v1JobId}`);

    let v1State = {};
    for (let i = 0; i < 120; i += 1) {
      v1State = await fetch(`${BASE}/api/v1/jobs/${v1JobId}`, { headers: authed }).then((r) =>
        r.json(),
      );
      if (v1State.status === 'completed' || v1State.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    check(
      'v1 job completes through the real worker',
      v1State.status === 'completed',
      JSON.stringify(v1State.error ?? ''),
    );
    check('merge produced one output', v1State.files?.length === 1);
    check('page count travelled (2+1)', v1State.pageCount === 3);

    const download = await fetch(`${BASE}/api/v1/jobs/${v1JobId}/result`, { headers: authed });
    const bytes = Buffer.from(await download.arrayBuffer());
    check('v1 result downloads as a PDF', bytes.subarray(0, 5).toString() === '%PDF-', `${bytes.length}B`);
    check('v1 downloaded PDF really has the merged pages', countPages(bytes) === 3);

    // A read-only key must not be able to spend quota it does not carry.
    const reader = await fetch(`${BASE}/api/account/api-keys`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'smoke-reader', scopes: ['jobs:read'] }),
    });
    const readerBody = await reader.json().catch(() => ({}));
    check(
      'read-only key cannot submit',
      (
        await fetch(`${BASE}/api/v1/jobs`, {
          method: 'POST',
          headers: {
            'x-api-key': readerBody.token ?? '',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            slug: 'inspect',
            files: [{ name: 'a.pdf', data: buildPdf(1, 'api').toString('base64') }],
          }),
        })
      ).status === 403,
    );

    // Revoke, then the byte-identical invalid verdict.
    const revoke = await fetch(`${BASE}/api/account/api-keys/${minted.key.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    check('revoke answers 204', revoke.status === 204);
    check(
      'revoked key is refused exactly like a never-seen one',
      (await fetch(`${BASE}/api/v1/tools`, { headers: authed })).status === 401,
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('API smoke test failed to run:', error);
  process.exit(1);
});