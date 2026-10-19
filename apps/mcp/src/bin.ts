/**
 * `pdfshush-mcp` binary: reads the environment, guards the base URL, and
 * serves stdio until the client disconnects. Failures (missing key, unsafe
 * or malformed URL) exit non-zero with the *reason*, because a silently
 * dead stdio server is a config bug the user has to discover anyway.
 */

import { ConfigError, loadConfig } from './config.js';
import { serveStdio } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  // stderr is the diagnostic channel for stdio servers; stdout is protocol.
  process.stderr.write(
    `pdfshush-mcp: serving /api/v1 at ${config.baseUrl.toString()} (key ${config.apiKey.slice(0, 9)}…)\n`,
  );
  await serveStdio(config);
}

main().catch((err) => {
  process.stderr.write(
    `pdfshush-mcp: ${err instanceof ConfigError ? err.message : (err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ''}` : String(err))}\n`,
  );
  process.exit(1);
});
