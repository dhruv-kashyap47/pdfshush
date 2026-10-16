/**
 * The child environment is the security boundary that keeps a parser bug from
 * becoming a credential leak: the processor runs in a forked child, so whatever
 * this function returns is the child's *entire* environment.
 *
 * It is tested here rather than through BullMQ because the property that matters
 * -- "an allowlist, so secrets are absent" -- is a pure function of the parent's
 * environment, and the fork that consumes it cannot be observed cheaply.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { childEnv } from '../src/worker/child-env.js';
import { sandboxOptions } from '../src/worker/host.js';

const PROBE = 'PDFSHUSH_CHILD_ENV_PROBE';
/** Every secret-shaped variable the API process is known to hold. */
const SECRETS = [
  'PEPPER',
  'MONGODB_URI',
  'MONGODB_USERNAME',
  'MONGODB_PASSWORD',
  'GOOGLE_CLIENT_SECRET',
  'AI_MANAGED_API_KEY',
  'REDIS_URL',
  'NODE_OPTIONS',
];

describe('childEnv', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of [...SECRETS, PROBE, 'PATH']) {
      saved.set(name, process.env[name]);
    }
    process.env[PROBE] = 'should-not-be-forwarded';
    for (const name of SECRETS) process.env[name] = `${name}-value`;
  });

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('gives the child the work dir it needs', () => {
    expect(childEnv({ workDir: '/srv/work' }).WORK_DIR).toBe('/srv/work');
  });

  it('forwards no secret the API process holds', () => {
    const env = childEnv({ workDir: '/srv/work' });
    for (const name of SECRETS) expect(env[name], `${name} must not reach the child`).toBeUndefined();
  });

  it('is an allowlist: an unrecognised variable is dropped', () => {
    expect(childEnv({ workDir: '/srv/work' })[PROBE]).toBeUndefined();
  });

  it('keeps the harmless variables the runtime expects', () => {
    process.env.PATH = 'C:\\fake\\bin';
    expect(childEnv({ workDir: '/srv/work' }).PATH).toBe('C:\\fake\\bin');
  });

  it('reports NODE_ENV only when asked', () => {
    expect(childEnv({ workDir: '/srv/work', nodeEnv: 'production' }).NODE_ENV).toBe('production');
    expect(childEnv({ workDir: '/srv/work' }).NODE_ENV).toBeUndefined();
  });
});

/**
 * `childEnv` is only worth anything if the worker host actually hands it to
 * BullMQ. This guards that wiring: the option object is the one BullMQ spreads
 * into `fork()`, so asserting it here is asserting what the child receives.
 */
describe('sandboxOptions', () => {
  it('gives the fork the allowlisted env, not the parent environment', () => {
    process.env.PEPPER = 'pepper-value';
    try {
      const options = sandboxOptions(
        {
          env: 'production',
          workerConcurrency: 2,
          workerChildMaxOldSpaceMb: 512,
          maxJobWorkingSetBytes: 1_000_000,
        },
        '/srv/work',
      );
      expect(options.workerForkOptions.env?.WORK_DIR).toBe('/srv/work');
      expect(options.workerForkOptions.env?.NODE_ENV).toBe('production');
      expect(options.workerForkOptions.env?.PEPPER).toBeUndefined();
    } finally {
      delete process.env.PEPPER;
    }
  });

  it('forwards the admission ceiling, since the child cannot read config', () => {
    const options = sandboxOptions(
      {
        env: 'production',
        workerConcurrency: 1,
        workerChildMaxOldSpaceMb: 512,
        maxJobWorkingSetBytes: 123_456,
      },
      '/srv/work',
    );
    expect(options.workerForkOptions.env?.MAX_JOB_WORKING_SET_BYTES).toBe('123456');
  });

  it('caps the child heap and replaces the inherited execArgv', () => {
    const options = sandboxOptions(
      {
        env: 'development',
        workerConcurrency: 1,
        workerChildMaxOldSpaceMb: 768,
        maxJobWorkingSetBytes: 1,
      },
      '/srv/work',
    );
    expect(options.workerForkOptions.execArgv).toEqual(['--max-old-space-size=768']);
  });
});
