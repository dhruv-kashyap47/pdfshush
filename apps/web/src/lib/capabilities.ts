/**
 * What the deployment behind `/api` can actually do.
 *
 * The SPA ships in two shapes and, since the free Worker, a third. A feature
 * that exists in the code but not in the deployment must be *hidden*, not shown
 * and then refused — the old single `serverDeployed` boolean could not express
 * that. This module is the smallest thing that can.
 */

import { useEffect, useState } from 'react';
import { serverDeployed } from '@/lib/deployment';

export interface Capabilities {
  accounts: boolean;
  managedAi: boolean;
  serverJobs: boolean;
  workflows: boolean;
  publicApi: boolean;
  mcp: boolean;
}

/** The full self-hosted shape. Used until the deployment answers. */
const FULL: Capabilities = {
  accounts: true,
  managedAi: false,
  serverJobs: true,
  workflows: true,
  publicApi: true,
  mcp: true,
};

/** A frontend-only build has no API to ask, and supports none of it. */
const NONE: Capabilities = {
  accounts: false,
  managedAi: false,
  serverJobs: false,
  workflows: false,
  publicApi: false,
  mcp: false,
};

let cache: Promise<Capabilities> | null = null;

export function initialCapabilities(): Capabilities {
  return serverDeployed ? FULL : NONE;
}

export function loadCapabilities(): Promise<Capabilities> {
  if (!serverDeployed) return Promise.resolve(NONE);
  cache ??= (async () => {
    try {
      const response = await fetch('/api/capabilities', { credentials: 'same-origin' });
      if (!response.ok) {
        cache = null;
        return FULL;
      }
      const data = (await response.json()) as Partial<Capabilities>;
      return { ...FULL, ...data };
    } catch {
      // A transient outage must not hide features that may work next time.
      cache = null;
      return FULL;
    }
  })();
  return cache;
}

export function useCapabilities(): Capabilities {
  const [capabilities, setCapabilities] = useState<Capabilities>(initialCapabilities);

  useEffect(() => {
    let active = true;
    void loadCapabilities().then((next) => {
      if (active) setCapabilities(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return capabilities;
}
