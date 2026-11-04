/** Waits until a URL answers 2xx/3xx, for starting `vite preview` in CI. */
const url = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 60_000);
if (!url) {
  console.error('usage: node scripts/wait-for-url.mjs <url> [timeoutMs]');
  process.exit(2);
}
const deadline = Date.now() + timeoutMs;
let lastError = 'no response';
while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (response.ok || (response.status >= 300 && response.status < 400)) process.exit(0);
    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error(`[wait-for-url] ${url} did not answer in ${timeoutMs} ms: ${lastError}`);
process.exit(1);
