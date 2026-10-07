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
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

  await rm(work, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('API smoke test failed to run:', error);
  process.exit(1);
});