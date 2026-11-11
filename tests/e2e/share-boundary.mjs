/**
 * Second-party access walkthrough (session 5).
 *
 * Replaces the share walkthrough that the SHARE scope could not exercise: a
 * share feature does not exist (see docs/pdf-audit/SHARE-SPEC.md), so the same
 * sequence is driven through the only capability that does -- a job's own
 * `jobId` + `x-job-token`:
 *
 *   upload -> process -> download with the token in a clean session
 *          -> no token / wrong token / token from another job: denied
 *          -> token in the query string: denied
 *          -> traversal in the file name: not found
 *
 * Run the preflight first (the npm script does):
 *   pnpm test:e2e:share
 */

const BASE = process.env.API_BASE_URL ?? 'http://localhost:8080';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/** A minimal, spec-valid two-page PDF with one text line per page. */
function buildPdf(label) {
  const content = (page) =>
    `BT /F1 18 Tf 60 700 Td (${label} page ${page}) Tj ET`;
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>';
  objects[4] = `<< /Length ${content(1).length} >>\nstream\n${content(1)}\nendstream`;
  objects[5] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>';
  objects[6] = `<< /Length ${content(2).length} >>\nstream\n${content(2)}\nendstream`;
  objects[7] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let num = 1; num < objects.length; num += 1) {
    offsets[num] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let num = 1; num < objects.length; num += 1) {
    pdf += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function createJob(slug, files) {
  const form = new FormData();
  form.append('slug', slug);
  for (const file of files) {
    form.append('file', new Blob([file.data], { type: 'application/pdf' }), file.name);
  }
  const response = await fetch(`${BASE}/api/jobs`, { method: 'POST', body: form });
  const payload = await response.json();
  if (response.status !== 202) {
    throw new Error(`create failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitFor(jobId, token, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/api/jobs/${jobId}`, {
      headers: { 'x-job-token': token },
    });
    if (response.status !== 200) throw new Error(`poll failed: ${response.status}`);
    const state = await response.json();
    if (state.status === 'completed') return state;
    if (state.status === 'failed') throw new Error(`job failed: ${JSON.stringify(state)}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`job ${jobId} did not finish in time`);
}

async function main() {
  const pdf = buildPdf('SHARE-BOUNDARY');
  console.log('upload -> process');
  const created = await createJob('merge', [
    { name: 'one.pdf', data: pdf },
    { name: 'two.pdf', data: pdf },
  ]);
  check('a created job returns a job id and a 64-hex token', /^[0-9a-f]{32}$/.test(created.jobId) && /^[0-9a-f]{64}$/.test(created.token));

  const state = await waitFor(created.jobId, created.token);
  check('the job reaches completed with a result file', Array.isArray(state.files) && state.files.length > 0);
  const name = state.files[0].name;

  // A "clean session" here means exactly what it means for a second party:
  // no cookie, no session, no token carried over from the creating request.
  console.log('download in a clean session');
  const url = `${BASE}/api/jobs/${created.jobId}/files/${encodeURIComponent(name)}`;

  const anonymous = await fetch(url);
  check('the result URL without the token is refused', anonymous.status === 403, `status ${anonymous.status}`);
  check(
    'the refusal body does not contain document bytes',
    !(await anonymous.text()).includes('%PDF'),
  );

  const withToken = await fetch(url, { headers: { 'x-job-token': created.token } });
  const body = Buffer.from(await withToken.arrayBuffer());
  check('the token holder can download the result', withToken.status === 200, `status ${withToken.status}`);
  check('the download is a PDF', body.subarray(0, 5).toString('latin1') === '%PDF-');
  check('the download is labelled application/pdf', withToken.headers.get('content-type') === 'application/pdf');
  check(
    'the download is an attachment with its filename',
    (withToken.headers.get('content-disposition') ?? '').startsWith(`attachment; filename="${name}"`),
    withToken.headers.get('content-disposition') ?? '',
  );
  check(
    'the download cannot be stored by a shared cache',
    (withToken.headers.get('cache-control') ?? '').includes('no-store') &&
      (withToken.headers.get('vary') ?? '').includes('x-job-token'),
    withToken.headers.get('cache-control') ?? '',
  );
  check(
    'no referrer leaves the API',
    withToken.headers.get('referrer-policy') === 'no-referrer',
    withToken.headers.get('referrer-policy') ?? '',
  );

  console.log('denied paths');
  const wrong = await fetch(url, { headers: { 'x-job-token': '0'.repeat(64) } });
  check('a wrong token is refused', wrong.status === 403, `status ${wrong.status}`);

  const queryToken = await fetch(`${url}?token=${created.token}`);
  check('a token in the query string is refused', queryToken.status === 403, `status ${queryToken.status}`);

  const second = await createJob('merge', [
    { name: 'three.pdf', data: pdf },
    { name: 'four.pdf', data: pdf },
  ]);
  const crossJob = await fetch(url, { headers: { 'x-job-token': second.token } });
  check('a token from another job is refused (IDOR)', crossJob.status === 403, `status ${crossJob.status}`);
  // Clean up the probe job through its own capability.
  await fetch(`${BASE}/api/jobs/${second.jobId}`, {
    method: 'DELETE',
    headers: { 'x-job-token': second.token },
  });

  const traversal = await fetch(
    `${BASE}/api/jobs/${created.jobId}/files/${encodeURIComponent('../../input/one.pdf')}`,
    { headers: { 'x-job-token': created.token } },
  );
  check('a traversal in the file name is not found', traversal.status === 404, `status ${traversal.status}`);

  const unknown = await fetch(`${BASE}/api/jobs/${'f'.repeat(32)}`, {
    headers: { 'x-job-token': created.token },
  });
  check(
    'an unknown job with a valid-format token is refused, not enumerated',
    unknown.status === 403,
    `status ${unknown.status}`,
  );

  const missing = await fetch(`${BASE}/api/jobs/${created.jobId}/files/not-there.pdf`, {
    headers: { 'x-job-token': created.token },
  });
  check('a missing result is 404 result_not_found', missing.status === 404, `status ${missing.status}`);

  // The result exists until its TTL, and a finished job cannot be revoked
  // through DELETE: recorded as PDF-SHARE-002 (needs decision), so the
  // walkthrough pins the current contract instead of pretending otherwise.
  const revoke = await fetch(`${BASE}/api/jobs/${created.jobId}`, {
    method: 'DELETE',
    headers: { 'x-job-token': created.token },
  });
  check(
    'revoking a finished result is still refused (PDF-SHARE-002 open)',
    revoke.status === 409,
    `status ${revoke.status}`,
  );

  console.log(failures === 0 ? '\n=== share boundary: ok ===' : `\n=== share boundary: ${failures} failure(s) ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('share boundary walkthrough failed:', error);
  process.exit(1);
});
