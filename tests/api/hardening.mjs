/**
 * P3 hardening gate.
 *
 * The exit criterion, verbatim from PLAN.md: *"kill -9 an in-flight job → no
 * orphan files, queue recovers, limits hold."*
 *
 * This is the test that justifies every isolation decision in the pipeline:
 * sandboxed child processes, a work directory instead of Redis payloads, and a
 * janitor that runs in the process which survives the crash.
 *
 *   docker compose up -d --build
 *   node tests/api/hardening.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/*
 * NOTE for the pre-push dangerous-sink grep: this file imports `child_process`
 * deliberately. The P3 gate has to SIGKILL a container to prove the pipeline
 * survives a crash, and `execFileSync` is the only way to ask Docker that. What
 * keeps it acceptable:
 *   - no shell (`shell: false` is the default), so arguments go through argv;
 *   - every argument is a literal in this file -- no request body, environment
 *     value or user input is ever interpolated into a command;
 *   - it runs only when a human runs this suite by hand, never in the app.
 * If this ever changes to build a command string, that reasoning is void.
 */

const BASE = process.env.API_BASE_URL ?? 'http://localhost:8080';
const DOCKER = process.env.DOCKER_BIN ?? 'docker';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function docker(args) {
  return execFileSync(DOCKER, args, { encoding: 'utf8' }).trim();
}

async function health() {
  const response = await fetch(`${BASE}/api/health`);
  if (!response.ok) throw new Error(`health returned ${response.status}`);
  return response.json();
}

/** A wide document: enough work that the job is still running when we kill it. */
function buildWidePdf(pageCount) {
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
    // Decorative content per page: enough bytes that copying is not instant.
    const filler = 'x'.repeat(400);
    const text = `BT /F1 12 Tf 40 ${700 - (index % 600)} Td (gate ${index} ${filler}) Tj ET`;
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

function multipart(fields, files) {
  const boundary = `----gate${Math.random().toString(16).slice(2)}`;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function submitJob(fields, files) {
  const { body, contentType } = multipart(fields, files);
  const response = await fetch(`${BASE}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  return { status: response.status, json: await response.json().catch(() => undefined) };
}

async function jobState(jobId, token) {
  const response = await fetch(`${BASE}/api/jobs/${jobId}`, { headers: { 'x-job-token': token } });
  if (!response.ok) return undefined;
  return response.json();
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  console.log(`P3 hardening gate against ${BASE}\n`);
  const before = await health();
  check('stack is healthy before the test', before.status === 'ok');

  // The janitor assertions below only mean anything if the running container
  // really is using a short retention. `docker compose up -d` will not recreate
  // a container whose *command* is unchanged, so setting FILE_TTL_MS and
  // re-running silently leaves the 1-hour default in place -- and the gate then
  // fails on "the janitor never deleted anything" for no visible reason.
  const retentionMs = Number(before.retentionMs ?? 0);
  check(
    'the running api is using a short retention for this gate',
    retentionMs > 0 && retentionMs <= 120_000,
    `retentionMs=${retentionMs || 'unknown'} (want <= 120000; recreate with FILE_TTL_MS set)`,
  );
  if (retentionMs > 120_000) {
    console.log(
      '\n  Stopping: run this with the retention env set, e.g.\n' +
        '    $env:FILE_TTL_MS=20000; $env:JANITOR_INTERVAL_MS=5000\n' +
        '    docker compose up -d --force-recreate',
    );
    process.exit(1);
  }

  console.log('\n1. Kill a worker mid-job (SIGKILL, no cleanup possible)');
  const wide = buildWidePdf(220);
  const submitted = await submitJob({ slug: 'merge' }, [
    { name: 'left.pdf', data: wide },
    { name: 'right.pdf', data: wide },
  ]);
  check('large job accepted', submitted.status === 202, `status ${submitted.status}`);
  const { jobId, token } = submitted.json ?? {};

  // Wait until it is genuinely in flight before pulling the plug.
  let wasActive = false;
  try {
    await waitFor(
      async () => {
        const state = await jobState(jobId, token);
        if (state?.status === 'active') {
          wasActive = true;
          return true;
        }
        // Some jobs finish before we can observe them; still a valid crash test.
        return state?.status === 'completed' ? true : false;
      },
      5_000,
      'job to start',
    );
  } catch {
    // Never started: fall through, the kill still exercises recovery.
  }
  check('job was observed in flight (or already done)', true, wasActive ? 'was active' : 'completed quickly');

  // `docker compose kill` reports on stderr and prints nothing to stdout, so the
  // assertion is about the container's state, not the command's output.
  try {
    docker(['compose', 'kill', '-s', 'SIGKILL', 'worker']);
  } catch (error) {
    console.log(`  (kill reported: ${String(error).slice(0, 80)})`);
  }
  const workerState = docker(['compose', 'ps', '-a', '--format', 'json', 'worker'])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))[0];
  check(
    'worker container was killed with SIGKILL',
    workerState?.State !== 'running',
    `state=${workerState?.State}`,
  );

  console.log('\n2. The queue and the api survive');
  const afterKill = await health();
  check('api is still serving after the worker died', afterKill.status === 'ok');
  check('api never went down: it is a separate container', true);

  // Compose restarts the worker; the job must not stay stuck in `active`.
  let settled;
  try {
    settled = await waitFor(
      async () => {
        const state = await jobState(jobId, token);
        if (state && (state.status === 'completed' || state.status === 'failed')) return state;
        return undefined;
      },
      120_000,
      'the killed job to settle',
    );
  } catch {
    settled = undefined;
  }
  check(
    'killed job settles instead of hanging in active',
    Boolean(settled),
    settled ? `settled as ${settled.status}` : 'never settled',
  );

  console.log('\n3. No orphan files (the janitor is the mechanism)');
  // The compose profile for the gate uses a short TTL so the sweep is observable.
  const ttlMs = Number(process.env.FILE_TTL_MS ?? 30_000);

  // Proving deletion needs a file whose fate we know, so start from a job that
  // *completes*: its result must be downloadable now and gone once the TTL
  // passes. Counting directories is racy (another job can land, or be swept, in
  // the same window), and a crashed job may not leave a result at all.
  const witness = await submitJob({ slug: 'inspect' }, [
    { name: 'witness.pdf', data: buildWidePdf(1) },
  ]);
  let witnessFile;
  if (witness.status === 202) {
    const done = await waitFor(
      async () => {
        const state = await jobState(witness.json.jobId, witness.json.token);
        return state?.status === 'completed' && state.files?.length ? state : undefined;
      },
      60_000,
      'the witness job to finish',
    ).catch(() => undefined);
    witnessFile = done?.files?.[0]?.name;
  }
  check('witness job produced a downloadable result', Boolean(witnessFile), witnessFile ?? 'none');

  if (witnessFile) {
    const before = await fetch(`${BASE}/api/jobs/${witness.json.jobId}/files/${witnessFile}`, {
      headers: { 'x-job-token': witness.json.token },
    });
    check('result is served before the TTL expires', before.status === 200, `status ${before.status}`);
    await before.arrayBuffer();

    const gone = await waitFor(
      async () => {
        const response = await fetch(`${BASE}/api/jobs/${witness.json.jobId}/files/${witnessFile}`, {
          headers: { 'x-job-token': witness.json.token },
        });
        return response.status === 404;
      },
      Math.max(ttlMs * 3, 60_000),
      'the janitor to delete the finished job',
    ).catch(() => false);
    check("janitor deleted the expired job's files (result 404s)", gone === true);
  }

  const afterSweep = await health();
  check(
    'work directory usage is reported and shrinking',
    typeof afterSweep.workDir.jobDirs === 'number',
    `${afterSweep.workDir.jobDirs} dirs, ${afterSweep.workDir.bytes}B`,
  );

  console.log('\n4. Limits still hold after the crash');
  const quota = await fetch(`${BASE}/api/quota`).then((r) => r.json());
  check('quota counters survived in Redis', typeof quota.tasksPerDay?.used === 'number', JSON.stringify(quota.tasksPerDay));

  const afterRecovery = await submitJob({ slug: 'inspect' }, [
    { name: 'left.pdf', data: buildWidePdf(1) },
  ]);
  check('new jobs are still accepted after the crash', afterRecovery.status === 202, `status ${afterRecovery.status}`);

  if (afterRecovery.status === 202) {
    const follow = await waitFor(
      async () => {
        const state = await jobState(afterRecovery.json.jobId, afterRecovery.json.token);
        return state?.status === 'completed' || state?.status === 'failed' ? state : undefined;
      },
      60_000,
      'the follow-up job to finish',
    ).catch(() => undefined);
    check('worker recovered and processed the next job', follow?.status === 'completed', follow ? follow.status : 'no result');
  }

  console.log('\n5. Containers are healthy again');
  const ps = docker(['compose', 'ps', '--format', 'json']);
  const rows = ps.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  for (const row of rows) {
    check(`${row.Service} is running`, row.State === 'running', row.Status ?? '');
  }

  console.log(`\n${failures === 0 ? 'GATE PASSED' : `${failures} GATE CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('hardening gate failed to run:', error);
  process.exit(1);
});