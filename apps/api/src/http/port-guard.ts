/**
 * Fail-fast port guard.
 *
 * On Windows two listeners can share a port when they bind different
 * addresses: a wildcard listener (0.0.0.0) happily co-exists with a specific
 * one (127.0.0.1) already held by another process, and every loopback request
 * then reaches the *older* process no matter what the new one logs. The API
 * also verifies nothing by this point, so a stale `tsx watch` keeps serving
 * with old config while the fresh boot claims to listen.
 *
 * `server.listen` itself already fails with EADDRINUSE for an identical
 * host:port (`exclusive: true` is a cluster option, not a kernel guarantee),
 * so this guard only needs to catch the cross-address case: before listening,
 * probe the exact address and — when a wildcard is about to be bound — the
 * loopback specifics too, with short-lived servers that close again.
 */

import net from 'node:net';
import { spawnSync } from 'node:child_process';

/** Probe one host:port with a short-lived listener; resolves if free. */
function probe(port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.unref();
    server.listen({ port, host }, () => {
      server.close(() => resolve());
    });
  });
}

/** The process currently holding a LISTEN socket on the port, if detectable. */
function ownerPid(port: number): number | undefined {
  if (process.platform === 'win32') {
    const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    for (const line of (result.stdout ?? '').split(/\r?\n/)) {
      // e.g. "  TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    17692"
      const columns = line.trim().split(/\s+/);
      if (columns[0] !== 'TCP' || columns[3] !== 'LISTENING') continue;
      if (columns[1]?.endsWith(`:${port}`)) {
        const pid = Number(columns[4]);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
    }
    return undefined;
  }
  const lsof = spawnSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  const pid = Number((lsof.stdout ?? '').trim().split(/\s+/)[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** The command that dislodges the owner, for the platform we are on. */
function killHint(pid: number): string {
  return process.platform === 'win32'
    ? `Stop-Process -Id ${pid} -Force`
    : `kill ${pid}`;
}

/**
 * Verify the API's port is actually bindable before anything boots, so a
 * second instance dies in seconds with a name and a kill command instead of
 * co-binding or asserting on state served by an impostor.
 */
export async function assertPortBindable(port: number, host: string): Promise<void> {
  // A wildcard bind also serves every specific address, so a specific holder
  // on loopback would shadow traffic; probe those up front.
  const wildcard = host === '' || host === '0.0.0.0' || host === '::';
  const hosts = wildcard ? [host, '127.0.0.1', '::1'] : [host];

  for (const candidate of hosts) {
    try {
      await probe(port, candidate);
    } catch {
      const held = ownerPid(port);
      throw new Error(
        `port ${port} is already taken on ${candidate || 'all interfaces'}` +
          (held !== undefined ? ` -- held by PID ${held}. ${killHint(held)} to release it, or set PORT to a free port.` : ' -- another process is listening; find it with your platform\'s socket tools.'),
      );
    }
  }
}
