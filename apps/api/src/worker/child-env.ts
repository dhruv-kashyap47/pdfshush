/**
 * The environment a sandboxed job child is allowed to see.
 *
 * BullMQ forks the processor with the parent's environment by default, so a
 * parser bug that yields code execution inside a PDF job would inherit every
 * secret the API process holds -- the Mongo username/password/URI, the Google
 * client secret, the managed-AI key, the quota `PEPPER`. Passing `env` to
 * `fork()` replaces the child's environment at the OS level: this object is what
 * `/proc/self/environ` shows, not merely what `process.env` reports, so the
 * variables are gone rather than hidden.
 *
 * It is an allowlist, not a denylist, so a secret added to the API's environment
 * next month stays invisible to children until someone adds it here on purpose.
 * The price is that a processor which genuinely needs a new variable must be
 * given it deliberately -- which is the point.
 */

/**
 * Variables that carry no authority and that ordinary Node or library code may
 * legitimately consult: where the temp directory is, how to find a binary on
 * Windows, the locale. Nothing here can reach a service or a credential.
 */
const PASSTHROUGH = [
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'LANG',
  'LC_ALL',
] as const;

export interface ChildEnvOptions {
  /** Directory the processor reads inputs from and writes results to. */
  workDir: string;
  /** Reported to libraries that branch on `NODE_ENV`. */
  nodeEnv?: string;
}

export function childEnv(options: ChildEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of PASSTHROUGH) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  // The one variable the processor actually requires (see `processor.ts`).
  env.WORK_DIR = options.workDir;
  if (options.nodeEnv !== undefined) env.NODE_ENV = options.nodeEnv;
  return env;
}
