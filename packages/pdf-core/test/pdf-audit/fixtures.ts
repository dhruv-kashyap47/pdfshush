/**
 * Fixture reader for the audit repros.
 *
 * `pdf-core` compiles with `"types": []`, so tests cannot import `node:fs`.
 * `process.getBuiltinModule` is the same escape hatch the real-corpus test uses
 * (`test/corpus/real.ts:144`). Paths are resolved from the package root, which
 * is vitest's working directory.
 */

interface FsLike {
  readFileSync(path: string): Uint8Array;
}

function nodeFs(): FsLike {
  const proc = (
    globalThis as unknown as { process: { getBuiltinModule(name: string): unknown } }
  ).process;
  return proc.getBuiltinModule('node:fs') as FsLike;
}

const FIXTURE_DIR = '../../tests/fixtures/pdf-audit';

/** Reads one committed audit fixture. See `docs/pdf-audit/FIXTURES.md`. */
export function readAuditFixture(name: string): Uint8Array {
  return new Uint8Array(nodeFs().readFileSync(`${FIXTURE_DIR}/${name}`));
}
